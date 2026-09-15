-- Esquema proposto para a newsletter Argon (PostgreSQL 15+, Supabase).
-- Fonte de verdade do modelo de dados descrito em revisao-arquitetura.md, §6.
--
-- Convenções:
--   - nomes em português, snake_case, singular
--   - timestamps sempre com fuso (timestamptz), armazenados em UTC
--   - RLS ligado em todas as tabelas, sem políticas: acesso só pela chave de serviço
--   - as tabelas do Mastra (@mastra/pg) ficam no schema `mastra`, fora deste arquivo
--
-- Sete tabelas: assinante, fonte, noticia, edicao, envio, execucao_pipeline, configuracao.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "vector";     -- pgvector, dedup por similaridade
create extension if not exists "pg_cron";    -- jobs periódicos (ver fim do arquivo)

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type status_assinante as enum ('pendente', 'confirmado', 'cancelado', 'bounce');
create type motivo_cancelamento as enum ('usuario', 'reclamacao', 'bounce', 'manual');
create type tipo_fonte as enum ('feed', 'pagina', 'consulta');   -- consulta: API de dado (ex.: SELIC no SGS)
create type categoria_noticia as enum (
  'business', 'empreendedorismo', 'tecnologia', 'economia', 'politica'
);
create type status_edicao as enum (
  'gerando', 'pronta', 'enviando', 'enviada', 'falhou', 'pulada'
);
create type status_envio as enum (
  'pendente', 'enviado', 'entregue', 'bounce_soft', 'bounce_hard', 'reclamacao', 'falhou'
);
create type etapa_pipeline as enum (
  'ingerir', 'selecionar', 'redigir', 'construir', 'revisar', 'enviar'
);
create type status_execucao as enum ('iniciada', 'concluida', 'falhou', 'pulada');

-- ---------------------------------------------------------------------------
-- Assinante
-- ---------------------------------------------------------------------------

create table assinante (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null,                 -- normalizado: minúsculas, sem espaços
  status                    status_assinante not null default 'pendente',

  -- confirmação (double opt-in). Só o hash do token vai ao banco.
  token_hash                text,
  token_expira_em           timestamptz,

  -- descadastro: token permanente, gerado na confirmação, só o hash no banco
  token_descadastro_hash    text,

  -- limite de reenvio por e-mail (o limite por IP fica no Firewall da Vercel)
  envios_confirmacao        smallint not null default 0,   -- zerado todo dia pelo job
  ultimo_envio_confirmacao_em timestamptz,

  -- prova de consentimento (LGPD art. 8º §2º)
  consentimento_em          timestamptz,
  consentimento_ip          inet,
  consentimento_user_agent  text,
  politica_versao           text,

  -- ciclo de vida
  data_cadastro             timestamptz not null default now(),
  data_confirmacao          timestamptz,
  data_cancelamento         timestamptz,
  motivo_cancelamento       motivo_cancelamento,

  -- entregabilidade
  bounces_soft              smallint not null default 0,

  atualizado_em             timestamptz not null default now(),

  constraint assinante_email_unico unique (email),
  constraint assinante_email_normalizado check (email = lower(btrim(email))),
  constraint assinante_confirmado_tem_consentimento check (
    status <> 'confirmado' or (consentimento_em is not null and token_descadastro_hash is not null)
  ),
  constraint assinante_cancelado_tem_motivo check (
    status <> 'cancelado' or (data_cancelamento is not null and motivo_cancelamento is not null)
  ),
  constraint assinante_pendente_tem_token check (
    status <> 'pendente' or (token_hash is not null and token_expira_em is not null)
  )
);

create index assinante_status_idx on assinante (status);
create index assinante_token_hash_idx on assinante (token_hash) where token_hash is not null;
create index assinante_token_descadastro_idx on assinante (token_descadastro_hash)
  where token_descadastro_hash is not null;
create index assinante_pendente_expira_idx on assinante (token_expira_em) where status = 'pendente';
create index assinante_cancelado_data_idx on assinante (data_cancelamento) where status = 'cancelado';

-- ---------------------------------------------------------------------------
-- Fonte (ferramenta `listar_fontes` do Ingestor)
-- Feed, página ou consulta a uma API de dado. A SELIC é uma fonte `consulta`:
-- o agente lê o valor, compara com a última notícia gerada para a fonte e só
-- cria notícia nova se mudou. O domínio permitido para `ler_pagina` é o da url.
-- ---------------------------------------------------------------------------

create table fonte (
  id                 text primary key,             -- slug estável: 'forbes-br', 'selic'
  nome               text not null,
  tipo               tipo_fonte not null default 'feed',
  url                text not null,                -- feed, página ou endpoint da consulta
  categoria_padrao   categoria_noticia,
  guardar_texto      boolean not null default true,-- false para paywall/termos restritivos
  instrucoes         text,                         -- orientação específica para o agente
  ativa              boolean not null default true,
  ultimo_acesso_em   timestamptz,
  ultimo_erro        text,
  criado_em          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Notícia
-- Uma notícia sai em no máximo uma edição (a dedup garante), por isso a
-- relação é 1:N por `edicao_id`, sem tabela de junção nem array.
-- A ordem dentro da edição é o `score`, definido na seleção e imutável depois.
-- ---------------------------------------------------------------------------

create table noticia (
  id                 uuid primary key default gen_random_uuid(),
  fonte_id           text not null references fonte (id),
  edicao_id          uuid,                       -- FK declarada após `edicao`
  url_canonica       text not null,              -- identidade da notícia e link da edição

  -- insumos
  titulo_original    text not null,
  texto_extraido     text,                       -- limpar após 30 dias
  publicado_em       timestamptz,
  categoria          categoria_noticia,
  tags               text[] not null default '{}',
  embedding          vector(1536),               -- ajustar à dimensão do modelo escolhido

  -- seleção (Selecionador): score definido aqui e não recalculado
  score              numeric(5, 2),
  score_detalhe      jsonb,                      -- {impacto, atualidade, fonte, justificativa}

  -- redação (Redator, após revisão)
  manchete           text,
  corpo              text,

  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),

  constraint noticia_url_canonica_unica unique (url_canonica),
  constraint noticia_corpo_tamanho check (corpo is null or char_length(corpo) <= 190),
  constraint noticia_em_edicao_completa check (
    edicao_id is null or (score is not null and manchete is not null and corpo is not null)
  )
);

create index noticia_publicado_em_idx on noticia (publicado_em desc);
create index noticia_fonte_idx on noticia (fonte_id, criado_em desc);
create index noticia_edicao_idx on noticia (edicao_id, score desc) where edicao_id is not null;
create index noticia_embedding_idx on noticia
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Edição
-- HTML, texto puro e ordem não são guardados: o template reconstrói tudo a
-- partir das notícias com `edicao_id`, ordenadas por `score`.
-- ---------------------------------------------------------------------------

create table edicao (
  id             uuid primary key default gen_random_uuid(),
  data           date not null,                  -- uma por dia
  status         status_edicao not null default 'gerando',

  titulo         text,                           -- manchete da edição (cabeçalho do e-mail)
  assunto        text,                           -- linha de assunto do e-mail

  enviada_em     timestamptz,
  log_revisao    jsonb not null default '[]'::jsonb,  -- [{tentativa, etapa, veredito, analise}]
  custo_tokens   jsonb not null default '{}'::jsonb,  -- {etapa: {modelo, entrada, saida}}

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),

  constraint edicao_data_unica unique (data),
  constraint edicao_assunto_tamanho check (assunto is null or char_length(assunto) <= 78),
  constraint edicao_enviada_completa check (
    status <> 'enviada' or (enviada_em is not null and titulo is not null and assunto is not null)
  )
);

alter table noticia
  add constraint noticia_edicao_fk foreign key (edicao_id) references edicao (id);

-- ---------------------------------------------------------------------------
-- Envio: uma linha por (edição, assinante). Criada antes de chamar o Resend.
-- O webhook do Resend atualiza `status` por `resend_email_id`; as transições só
-- avançam, então processar o mesmo evento duas vezes não muda nada.
-- ---------------------------------------------------------------------------

create table envio (
  id                 uuid primary key default gen_random_uuid(),
  edicao_id          uuid not null references edicao (id) on delete cascade,
  assinante_id       uuid not null references assinante (id) on delete cascade,
  lote               integer not null,            -- chave de idempotência no Resend: edicao_id:lote
  status             status_envio not null default 'pendente',
  resend_email_id    text,
  enviado_em         timestamptz,
  atualizado_em      timestamptz not null default now(),
  erro               text,

  constraint envio_unico unique (edicao_id, assinante_id)
);

create index envio_edicao_status_idx on envio (edicao_id, status);
create index envio_resend_id_idx on envio (resend_email_id) where resend_email_id is not null;

-- ---------------------------------------------------------------------------
-- Execução do pipeline: estado por etapa, medição e alerta
-- ---------------------------------------------------------------------------

create table execucao_pipeline (
  id             uuid primary key default gen_random_uuid(),
  edicao_id      uuid references edicao (id) on delete cascade,
  run_id         text,                             -- id do orquestrador (Vercel Workflow / Inngest)
  etapa          etapa_pipeline not null,
  item_ref       text,                             -- fonte_id, noticia_id ou lote, quando por item
  status         status_execucao not null default 'iniciada',
  tentativa      smallint not null default 1,
  iniciado_em    timestamptz not null default now(),
  terminado_em   timestamptz,
  erro           text,
  metricas       jsonb not null default '{}'::jsonb  -- {modelo, tokens_entrada, tokens_saida, custo, duracao_ms}
);

create index execucao_pipeline_edicao_idx on execucao_pipeline (edicao_id, etapa);
create index execucao_pipeline_iniciado_idx on execucao_pipeline (iniciado_em desc);

-- ---------------------------------------------------------------------------
-- Configuração operacional (kill switch e parâmetros)
-- ---------------------------------------------------------------------------

create table configuracao (
  chave          text primary key,
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now()
);

insert into configuracao (chave, valor) values
  ('envio_pausado',           'false'),
  ('noticias_min',            '4'),
  ('noticias_max',            '6'),
  ('noticias_min_com_alerta', '3'),
  ('score_corte',             '3.0'),
  ('politica_versao_atual',   '"2026-09-15"'),
  ('email_responsavel',       '""');

-- ---------------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------------

create or replace function set_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger assinante_atualizado_em before update on assinante
  for each row execute function set_atualizado_em();
create trigger noticia_atualizado_em before update on noticia
  for each row execute function set_atualizado_em();
create trigger edicao_atualizado_em before update on edicao
  for each row execute function set_atualizado_em();
create trigger envio_atualizado_em before update on envio
  for each row execute function set_atualizado_em();
create trigger configuracao_atualizado_em before update on configuracao
  for each row execute function set_atualizado_em();

-- Notícia que saiu em edição enviada é imutável no que o e-mail mostra,
-- porque o HTML é reconstruído a partir dela.
create or replace function noticia_imutavel_apos_envio() returns trigger
language plpgsql as $$
begin
  if old.edicao_id is not null
     and exists (select 1 from edicao e where e.id = old.edicao_id and e.status = 'enviada')
     and (new.manchete is distinct from old.manchete
          or new.corpo is distinct from old.corpo
          or new.score is distinct from old.score
          or new.url_canonica is distinct from old.url_canonica
          or new.edicao_id is distinct from old.edicao_id) then
    raise exception 'noticia % pertence a edicao enviada e nao pode ser alterada', old.id;
  end if;
  return new;
end;
$$;

create trigger noticia_imutavel before update on noticia
  for each row execute function noticia_imutavel_apos_envio();

-- ---------------------------------------------------------------------------
-- RLS: ligado em tudo, sem políticas. Só a chave de serviço acessa.
-- ---------------------------------------------------------------------------

alter table assinante          enable row level security;
alter table fonte              enable row level security;
alter table noticia            enable row level security;
alter table edicao             enable row level security;
alter table envio              enable row level security;
alter table execucao_pipeline  enable row level security;
alter table configuracao       enable row level security;

-- ---------------------------------------------------------------------------
-- Jobs periódicos (pg_cron). Alternativa: Vercel Cron chamando uma rota que
-- executa as mesmas instruções.
-- ---------------------------------------------------------------------------

-- pendentes com link vencido
select cron.schedule(
  'limpar_pendentes_expirados',
  '0 3 * * *',
  $$ delete from assinante where status = 'pendente' and token_expira_em < now() $$
);

-- cancelados há mais de 6 meses (prova de atendimento cumprida)
select cron.schedule(
  'limpar_cancelados_antigos',
  '10 3 * * *',
  $$ delete from assinante where status = 'cancelado' and data_cancelamento < now() - interval '6 months' $$
);

-- texto extraído é insumo, não publicação
select cron.schedule(
  'limpar_texto_extraido',
  '20 3 * * *',
  $$ update noticia set texto_extraido = null where texto_extraido is not null and criado_em < now() - interval '30 days' $$
);

-- contador diário de reenvio de confirmação
select cron.schedule(
  'zerar_envios_confirmacao',
  '30 3 * * *',
  $$ update assinante set envios_confirmacao = 0 where envios_confirmacao > 0 $$
);
