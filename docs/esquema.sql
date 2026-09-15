-- Esquema da newsletter Argon (PostgreSQL 15+, Supabase). Detalhes em revisao-arquitetura.md §6.
-- Identificadores em inglês; timestamps em UTC; RLS ligado sem políticas (só a chave de serviço acessa).
-- Tabelas do Mastra ficam no schema `mastra`, fora deste arquivo.

create extension if not exists "pgcrypto";
create extension if not exists "vector";
create extension if not exists "pg_cron";

-- Tipos -----------------------------------------------------------------------

create type subscriber_status as enum ('pending', 'confirmed', 'cancelled', 'bounced');
create type cancellation_reason as enum ('user', 'complaint', 'bounce', 'manual');
create type source_type as enum ('feed', 'page', 'query');   -- query: API de dado (ex.: SELIC no SGS)
create type article_category as enum ('business', 'entrepreneurship', 'technology', 'economy', 'politics');
create type edition_status as enum ('generating', 'ready', 'sending', 'sent', 'failed', 'skipped');
create type delivery_status as enum ('pending', 'sent', 'delivered', 'soft_bounce', 'hard_bounce', 'complaint', 'failed');
create type pipeline_step as enum ('ingest', 'select', 'write', 'build', 'review', 'deliver');
create type run_status as enum ('started', 'completed', 'failed', 'skipped');

-- Assinante ---------------------------------------------------------------------

create table subscriber (
  id                        uuid primary key default gen_random_uuid(),
  email                     text not null,                 -- minúsculas, sem espaços
  status                    subscriber_status not null default 'pending',

  token_hash                text,                          -- confirmação: só o hash
  token_expires_at          timestamptz,
  unsubscribe_token_hash    text,                          -- permanente, gerado na confirmação

  confirmation_sends        smallint not null default 0,   -- zerado por job diário
  last_confirmation_sent_at timestamptz,

  consent_at                timestamptz,                   -- prova de consentimento (LGPD)
  consent_ip                inet,
  consent_user_agent        text,
  policy_version            text,

  signed_up_at              timestamptz not null default now(),
  confirmed_at              timestamptz,
  cancelled_at              timestamptz,
  cancellation_reason       cancellation_reason,

  soft_bounces              smallint not null default 0,
  updated_at                timestamptz not null default now(),

  constraint subscriber_email_unique unique (email),
  constraint subscriber_email_normalized check (email = lower(btrim(email))),
  constraint subscriber_confirmed_has_consent check (
    status <> 'confirmed' or (consent_at is not null and unsubscribe_token_hash is not null)
  ),
  constraint subscriber_cancelled_has_reason check (
    status <> 'cancelled' or (cancelled_at is not null and cancellation_reason is not null)
  ),
  constraint subscriber_pending_has_token check (
    status <> 'pending' or (token_hash is not null and token_expires_at is not null)
  )
);

create index subscriber_status_idx on subscriber (status);
create index subscriber_token_hash_idx on subscriber (token_hash) where token_hash is not null;
create index subscriber_unsubscribe_token_idx on subscriber (unsubscribe_token_hash) where unsubscribe_token_hash is not null;
create index subscriber_pending_expires_idx on subscriber (token_expires_at) where status = 'pending';
create index subscriber_cancelled_at_idx on subscriber (cancelled_at) where status = 'cancelled';

-- Fonte -------------------------------------------------------------------------
-- Feed, página ou consulta a API. SELIC é `query`: o agente compara o valor com a
-- última notícia da fonte e só cria outra se mudou. Domínio permitido é o da url.

create table source (
  id                 text primary key,                     -- slug: 'forbes-br', 'selic'
  name               text not null,
  type               source_type not null default 'feed',
  url                text not null,
  default_category   article_category,
  store_text         boolean not null default true,        -- false para paywall
  instructions       text,                                 -- orientação ao agente
  active             boolean not null default true,
  last_fetched_at    timestamptz,
  last_error         text,
  created_at         timestamptz not null default now()
);

-- Notícia -----------------------------------------------------------------------
-- Sai em no máximo uma edição (dedup garante): 1:N por edition_id. Ordem é o score.

create table article (
  id                 uuid primary key default gen_random_uuid(),
  source_id          text not null references source (id),
  edition_id         uuid,                                 -- FK após `edition`
  canonical_url      text not null,                        -- identidade e link

  original_title     text not null,
  extracted_text     text,                                 -- limpo em 30 dias
  published_at       timestamptz,
  category           article_category,
  tags               text[] not null default '{}',
  embedding          vector(1536),                         -- dimensão do modelo escolhido

  score              numeric(5, 2),                        -- definido na seleção, imutável
  score_details      jsonb,                                -- {impact, recency, source, rationale}

  headline           text,
  body               text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint article_canonical_url_unique unique (canonical_url),
  constraint article_body_length check (body is null or char_length(body) <= 190),
  constraint article_in_edition_complete check (
    edition_id is null or (score is not null and headline is not null and body is not null)
  )
);

create index article_published_at_idx on article (published_at desc);
create index article_source_idx on article (source_id, created_at desc);
create index article_edition_idx on article (edition_id, score desc) where edition_id is not null;
create index article_embedding_idx on article using hnsw (embedding vector_cosine_ops);

-- Edição ------------------------------------------------------------------------
-- HTML e texto puro ficam gravados no envio: o arquivo e reenvios só leem.

create table edition (
  id             uuid primary key default gen_random_uuid(),
  date           date not null,
  status         edition_status not null default 'generating',
  title          text,                                     -- cabeçalho do e-mail
  subject        text,                                     -- assunto do e-mail
  html           text,                                     -- gerado pelo template na etapa build
  text           text,                                     -- versão texto puro
  sent_at        timestamptz,
  review_log     jsonb not null default '[]'::jsonb,       -- [{attempt, step, verdict, analysis}]
  token_cost     jsonb not null default '{}'::jsonb,       -- {step: {model, input, output}}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint edition_date_unique unique (date),
  constraint edition_subject_length check (subject is null or char_length(subject) <= 78),
  constraint edition_sent_complete check (
    status <> 'sent' or (sent_at is not null and title is not null and subject is not null
                         and html is not null and text is not null)
  )
);

alter table article add constraint article_edition_fk foreign key (edition_id) references edition (id);

-- Envio -------------------------------------------------------------------------
-- Uma linha por (edição, assinante), criada antes de chamar o Resend. Status só avança:
-- o webhook é idempotente sem guardar evento bruto.

create table delivery (
  id                 uuid primary key default gen_random_uuid(),
  edition_id         uuid not null references edition (id) on delete cascade,
  subscriber_id      uuid not null references subscriber (id) on delete cascade,
  batch              integer not null,                     -- idempotência no Resend: edition_id:batch
  status             delivery_status not null default 'pending',
  resend_email_id    text,
  sent_at            timestamptz,
  updated_at         timestamptz not null default now(),
  error              text,

  constraint delivery_unique unique (edition_id, subscriber_id)
);

create index delivery_edition_status_idx on delivery (edition_id, status);
create index delivery_resend_id_idx on delivery (resend_email_id) where resend_email_id is not null;

-- Execução do pipeline ----------------------------------------------------------

create table pipeline_run (
  id                  uuid primary key default gen_random_uuid(),
  edition_id          uuid references edition (id) on delete cascade,
  orchestrator_run_id text,                                -- Vercel Workflow / Inngest
  step                pipeline_step not null,
  item_ref            text,                                -- source_id, article_id ou batch
  status              run_status not null default 'started',
  attempt             smallint not null default 1,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  error               text,
  metrics             jsonb not null default '{}'::jsonb   -- {model, input_tokens, output_tokens, cost, duration_ms}
);

create index pipeline_run_edition_idx on pipeline_run (edition_id, step);
create index pipeline_run_started_idx on pipeline_run (started_at desc);

-- Configuração ------------------------------------------------------------------

create table setting (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

insert into setting (key, value) values
  ('sending_paused',          'false'),
  ('min_articles',            '4'),
  ('max_articles',            '6'),
  ('min_articles_with_alert', '3'),
  ('score_cutoff',            '3.0'),
  ('current_policy_version',  '"2026-09-15"'),
  ('owner_email',             '""');

-- Gatilhos ----------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriber_updated_at before update on subscriber for each row execute function set_updated_at();
create trigger article_updated_at    before update on article    for each row execute function set_updated_at();
create trigger edition_updated_at    before update on edition    for each row execute function set_updated_at();
create trigger delivery_updated_at   before update on delivery   for each row execute function set_updated_at();
create trigger setting_updated_at    before update on setting    for each row execute function set_updated_at();

-- RLS ---------------------------------------------------------------------------

alter table subscriber   enable row level security;
alter table source       enable row level security;
alter table article      enable row level security;
alter table edition      enable row level security;
alter table delivery     enable row level security;
alter table pipeline_run enable row level security;
alter table setting      enable row level security;

-- Jobs (pg_cron). Alternativa: Vercel Cron chamando uma rota com as mesmas instruções.

select cron.schedule('purge_expired_pending', '0 3 * * *',
  $$ delete from subscriber where status = 'pending' and token_expires_at < now() $$);

select cron.schedule('purge_old_cancelled', '10 3 * * *',
  $$ delete from subscriber where status = 'cancelled' and cancelled_at < now() - interval '6 months' $$);

select cron.schedule('purge_extracted_text', '20 3 * * *',
  $$ update article set extracted_text = null where extracted_text is not null and created_at < now() - interval '30 days' $$);

select cron.schedule('reset_confirmation_sends', '30 3 * * *',
  $$ update subscriber set confirmation_sends = 0 where confirmation_sends > 0 $$);
