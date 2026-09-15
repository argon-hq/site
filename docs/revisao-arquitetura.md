# Revisão da arquitetura — newsletter Argon

Revisão crítica dos diagramas de arquitetura (fluxo do usuário, cadastro, pipeline editorial,
banco de dados e stack), cruzada com o estado do repositório e com as decisões do time.

Data: 2026-09-15. Estado do código: site em Next.js 16 com cadastro **simulado** (sem backend,
tickets REB-74 e REB-75), tela de confirmação e preview de edição prontos.

O esquema de banco proposto está em [`esquema.sql`](esquema.sql).

## 1. Decisões registradas

| Tema | Decisão |
| --- | --- |
| Cadência | Uma edição por dia, segunda a sábado, às 7h (America/Sao_Paulo). Segunda cobre 48h. |
| Tamanho | 4 a 6 notícias por edição, ordenadas por score de relevância. |
| Idioma | Só português por enquanto. |
| Confirmação | Link válido por 48h. Pendentes expirados removidos por job periódico. |
| "E-mail já cadastrado" | Comportamento dinâmico conforme o status (§3.3). |
| Cancelamento | Fluxo de descadastro **entra na arquitetura** (§3.4). |
| Formulário | Tratado "da forma correta": honeypot no servidor, limites, sem enumeração (§3.2). |
| Log de envio | **Revertido**: haverá registro por assinante e edição (§7). |
| Direção | O pipeline é **AI-driven**: Ingestor, Selecionador, Redator e Revisor (incluindo revisão visual) são agentes. **Construtor HTML é determinístico** (template). |
| Modelo LLM | Gemini vs Claude em teste, sem veredito. |
| Revisor | Até 3 tentativas. Falhou: alerta por e-mail ao responsável. Sem revisão humana. |
| Horário do pipeline | A medir antes de definir. |
| Execução | Mastra como módulo dentro do Next.js, na Vercel. |
| Bounce | A decidir (proposta em §7.2). |
| "Acessar plataforma" | Placeholder. |
| Resend / Supabase | Falta veredito final do time. |

## 2. Resumo: o que mais importa

1. **Na Vercel, o agendador nativo do Mastra não funciona e o motor padrão de workflow roda
   tudo em uma única invocação.** A documentação do Mastra é explícita: em plataformas FaaS
   o scheduler não dá o segundo tick, e declarar `schedule` num workflow troca o motor para
   o "evented", que trava em serverless (issue aberta). O card "criar agendadores" precisa
   ser Vercel Cron ou Inngest, nunca o scheduler do Mastra. E a orquestração precisa ser
   durável por etapas. Detalhe e opções em §5.
2. **Descadastro e log de envio entram.** Estão desenhados em §3.4 e §7 e no esquema.
3. **O formulário é um vetor de abuso.** Limites por IP e por e-mail e verificação do honeypot
   no servidor antes de qualquer envio (§3.2).
4. **Agentes onde o time quer agentes, mas com ferramentas determinísticas e validação em
   código.** Ingestor, Selecionador, Redator e Revisor (com visão) são agentes; o Construtor
   HTML é template. O que muda é que I/O, regras duras e checagens mecânicas ficam em
   ferramentas e validadores, e o LLM decide sobre elas (§4).
5. **O esquema do diagrama não guarda token, consentimento auditável nem relação
   edição–notícia.** Resolvido em `esquema.sql` (§6).

## 3. Fluxo de cadastro

### 3.1 Token de confirmação

- Token aleatório de 32 bytes no link. No banco fica só o **hash** (SHA-256) e a expiração.
  Vazamento do banco não permite confirmar e-mails alheios.
- Uso único: confirmar apaga o hash. Clique repetido cai em "link expirado".
- Reenvio gera token novo e invalida o anterior.
- A tela de "link expirado" já conhece o e-mail (vem no link como referência opaca, não em
  texto). Deve oferecer "reenviar" ali, em vez de devolver ao formulário em branco como o
  diagrama mostra hoje.

### 3.2 Formulário e anti-abuso

O ponto central: **o formulário faz o sistema mandar e-mail para qualquer endereço que
alguém digitar**. Sem controle, vira ferramenta de bombardeio e destrói a reputação do
domínio. Ordem de verificação no servidor, antes de tocar no banco ou no Resend:

1. Honeypot preenchido: responder sucesso e descartar. Nunca revelar que foi detectado.
2. Validação e normalização do e-mail (a mesma função já existente em `lib/email.ts`).
3. Limite por IP: 5 submissões por hora. Limite por e-mail: 1 reenvio a cada 10 minutos, 3 por
   dia. Implementado com a tabela `evento_cadastro` do esquema (contagem por janela) ou, se
   preferirem não tocar no banco para isso, Upstash Redis ou o Firewall da Vercel.
4. Consentimento marcado e versão da política registrada.
5. Só então a ação da tabela em §3.3.

Resposta ao cliente sempre igual, independente do que aconteceu por trás: "enviamos um link
para X". Isso fecha a enumeração de base (saber se um e-mail está cadastrado é dado pessoal).

Server Action ou Route Handler: qualquer um. O que importa é que a lógica fique em um módulo
de domínio (`packages/newsletter` ou similar) chamado pela rota, testável sem HTTP.

### 3.3 "E-mail já cadastrado": comportamento por status

| Status atual | Ação |
| --- | --- |
| inexistente | cria `pendente`, envia confirmação |
| `pendente` | gera token novo, reenvia (respeitando limite) |
| `confirmado` | envia e-mail "você já está inscrito" com link de descadastro; nada muda |
| `cancelado` | volta a `pendente`, envia confirmação; reativar exige novo consentimento |
| `bounce` | volta a `pendente` e tenta; se bater bounce de novo, mantém `bounce` |

### 3.4 Descadastro

Fluxo novo, com quatro entradas que convergem no mesmo lugar:

1. **Link no rodapé de toda edição.** URL com `token_descadastro`, permanente por assinante,
   gerado na confirmação. Sem login. Um clique cancela e mostra a página de confirmação com
   "foi engano? reativar", que reenvia o e-mail de confirmação (reativar exige novo
   consentimento).
2. **Cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post`** (RFC 8058) em toda edição.
   Gmail e Yahoo exigem para remetentes em massa. O endpoint recebe POST e cancela sem
   página intermediária.
3. **Reclamação de spam** (webhook `email.complained` do Resend): cancela com motivo
   `reclamacao`. Nunca reenviar para esse endereço sem novo cadastro explícito.
4. **Pedido manual** (e-mail ao encarregado): mesmo caminho, executado por quem atende.

Efeito: `status = cancelado`, `data_cancelamento`, `motivo_cancelamento`. O registro fica por
6 meses como prova de atendimento (§8) e depois é apagado pelo job periódico.

Página do site: `/newsletter/unsubscribe` (caminho em inglês, como as demais), tela cheia,
sem cabeçalho, mesmo padrão da confirmação.

### 3.5 Job de remoção

Uma vez por dia: apaga `pendente` com `token_expira_em` vencido e `cancelado` com
`data_cancelamento` há mais de 6 meses. Pode ser Vercel Cron (precisão de ±59 min no Hobby
não importa aqui) ou `pg_cron` no Supabase, sem função nenhuma.

## 4. Pipeline editorial: agentes com ferramentas e validação

O time quer o pipeline AI-driven de ponta a ponta. A crítica então não é "não use agente",
e sim **o que cada agente recebe como ferramenta e o que é verificado em código depois**.
Regra geral: I/O e regras duras viram ferramentas e validadores; o agente raciocina sobre
elas. Isso mantém a decisão no LLM sem deixar custo, latência e não determinismo onde não
agregam.

### 4.1 Ingestor (agente)

O agente decide quais fontes visitar, o que vale extrair e como normalizar. As ferramentas
fazem o trabalho mecânico:

| Ferramenta | Faz |
| --- | --- |
| `listar_fontes` | lê a tabela `fonte` (feed, categoria padrão, ativa, último acesso) |
| `ler_feed(fonte)` | busca RSS/Atom, devolve itens com título, link, data, resumo |
| `ler_pagina(url)` | busca HTML, extrai texto principal, respeita `robots.txt`, timeout 10s, só domínios da tabela `fonte` |
| `consultar_selic` | série 432 do SGS (Banco Central); compara com `indicador_valor` |
| `gravar_noticia` | upsert por `url_canonica`; rejeita duplicata |

Regras que ficam em código, não no prompt: allowlist de domínios, janela de 24h/48h,
respeito a `robots.txt`, tamanho máximo de texto extraído, e não guardar texto de fontes
com paywall ou termos restritivos (Gartner, Zero Hora: usar release ou resumo do feed).

SELIC: a ferramenta devolve `mudou: true/false`. Se mudou, o agente cria uma notícia
sintética com link para o comunicado do Copom. A decisão de destaque fica com o
Selecionador.

O que o agente ganha aqui: lidar com feed quebrado, página sem feed, título enganoso,
notícia duplicada com URL diferente. O que perde se as ferramentas não existirem: cada
execução reinventa o parser, com custo e erro variáveis.

### 4.2 Selecionador (agente)

- Deduplicação em duas camadas antes do agente ver a lista: URL canônica (exata, no banco)
  e similaridade por embedding (`pgvector`), inclusive contra edições anteriores. Na
  segunda-feira, com 48h, isso pesa.
- Score com **saída estruturada e rubrica**: impacto para quem empreende, atualidade,
  confiabilidade da fonte, cada um de 0 a 5, e justificativa. Score final e justificativa
  gravados em `noticia` para auditoria. Ordenar por score, desempatar por data.
- Regra de mínimo, em código: menos de 3 notícias acima do corte pula o dia e alerta;
  3 envia e alerta; 4 a 6 envia normal.

### 4.3 Redator (agente)

- Saída estruturada: `manchete`, `corpo` (até 190 caracteres), `link`. Nunca HTML.
- Validação em código: tamanho, link igual ao da fonte, campos presentes. Estourou, pede
  reescrita **do item**, não da edição.
- Restrição de fidelidade no prompt e verificada pelo Revisor: só fatos presentes no texto
  extraído.

### 4.4 Construtor HTML (determinístico)

Template preenchido com a saída estruturada do Redator (React Email ou equivalente), sem
LLM. Consequências boas: o HTML não varia de um dia para o outro além do conteúdo, o rodapé
com descadastro e endereço do remetente é garantido, e a revisão visual fica mais barata
(§4.5).

Requisitos do template:

- Layout em tabelas, CSS inline, largura de 600px, fontes seguras, tokens de cor da marca.
- Modo escuro tratado (meta `color-scheme` e cores que funcionam invertidas).
- Rodapé fixo: link de descadastro com token, endereço postal do remetente, link da
  política.
- Versão texto puro gerada do mesmo JSON.
- Tamanho abaixo de 100 KB (Gmail corta acima de 102 KB).
- Assunto vem do Redator como campo separado, limite de 60 caracteres.

Validação mecânica na saída, mesmo sendo template: HTML válido, sem `<script>`, sem CSS ou
imagem externa fora da allowlist, todos os links dos itens presentes. Se falhar aqui é bug
do template, não da edição: alerta e não tenta de novo.

### 4.5 Revisor (agente, com revisão visual)

Três checagens, como no diagrama, cada uma com insumo adequado:

- **Sintática (código, não LLM)**: validações do §4.3 e §4.4, mais links respondendo 200.
- **Semântica (agente)**: fidelidade ao texto-fonte de cada item, sem números ou nomes que
  não estão na fonte; tom; português; repetição entre itens; assunto condizente.
- **Visual (agente com visão)**: o HTML é renderizado em imagem a 600px e a 375px e enviado
  a um modelo com visão junto com uma lista de verificação. Com o template determinístico,
  o que varia por edição é o conteúdo dentro dele, então a lista foca nisso: manchete que
  quebra em três linhas ou fica órfã, corpo que estoura o bloco, título muito parecido
  entre itens, ordem visual coerente com o score, nada cortado. Layout, contraste e rodapé
  são responsabilidade do template e do teste manual abaixo.

Sobre a renderização: **Playwright não cabe numa função da Vercel** (limite de 250 MB de
bundle, sem Chromium). Opções: serviço de screenshot por API (Browserless, ScreenshotOne,
Urlbox) ou Vercel Sandbox rodando Chromium. Ambos têm custo por captura; a 26 edições por
mês e 2 capturas por tentativa, é irrelevante. A imagem deve ser guardada junto da execução
para o alerta e para auditoria.

Limite honesto da revisão visual por agente: ela vê Chromium, não Outlook nem o app do
Gmail. Recomendo um teste manual nos três clientes principais uma vez por versão do
esqueleto, e não por edição. O agente cobre a variação diária; o teste manual cobre o
template.

Loop de 3 tentativas, sempre por item: problema visual ou semântico em um item volta ao
Redator com a análise do Revisor, e o Construtor regenera o HTML (custo zero, é template).
Item que falha três vezes é descartado; a regra de mínimo do §4.2 decide se a edição sai. Alerta por e-mail com a análise do Revisor, o HTML e a imagem renderizada.

**Kill switch**: uma linha em `configuracao` (`envio_pausado`). O Distribuidor verifica antes
de enviar. É a única defesa quando o alerta chega às 6h50 e a edição está errada, já que
não há revisão humana no fluxo.

### 4.6 Distribuidor

Etapa curta e previsível, separada da geração (§5.4). Lê os `confirmado`, cria as linhas de
`envio`, manda em lotes de 100 com chave de idempotência determinística
(`edicao_id:lote_n`), atualiza `envio.resend_email_id`. Regras de entregabilidade em §7.

## 5. Mastra dentro do Next.js na Vercel

O time já rodou Mastra com Next.js na Vercel. Isso funciona bem para o caso típico: agente
respondendo a uma requisição, streaming, memória. O pipeline da newsletter é outro perfil:
**disparo por horário, execução longa, sem ninguém esperando a resposta**. O que a
documentação do Mastra e da Vercel dizem sobre isso:

### 5.1 O que está confirmado na documentação

| Ponto | Fonte |
| --- | --- |
| Integração oficial: `serverExternalPackages: ['@mastra/*']` no `next.config`; LibSQL não serve em serverless, usar Postgres (`@mastra/pg`) | Mastra, guia Next.js e deploy em web framework |
| O scheduler nativo do Mastra é um `setInterval` que consulta a tabela de schedules. "Em Vercel, Netlify, Lambda e Workers o processo morre após cada request, o tick loop não recebe o segundo tick e os schedules não disparam; nessas plataformas use `@mastra/inngest`" | Mastra, *Scheduled workflows* |
| Declarar `schedule` em `createWorkflow()` promove o workflow ao motor "evented", que publica eventos esperando um processador vivo. Em serverless, runs disparadas por HTTP travam até o `maxDuration` e devolvem 504. Issue #18807, aberta em julho de 2026; workaround é só declarar `schedule` quando uma variável de ambiente indica processo persistente | GitHub mastra-ai/mastra |
| Workers do Mastra (orquestração, scheduler, background tasks) pressupõem processo persistente e pub/sub distribuído (Redis Streams etc.) | Mastra, *Workers* |
| Motor padrão de workflow: `run.start()` executa e espera terminar dentro da mesma invocação. Não há execução em background nativa em serverless | Mastra, *Workflows overview* |
| `@mastra/inngest`: cada step vira um step do Inngest, com memoização (steps concluídos não reexecutam), retry e cron por workflow (`cron` cria função `workflow.<id>.cron`). Em Next.js, rota `/api/inngest` com `createServe(nextAdapter)` | Mastra, guia Inngest |
| Vercel: função de 300s (Hobby) ou 800s (Pro; 1800s em beta). Cron no Hobby é uma vez por dia com precisão de ±59 min; no Pro, por minuto | Vercel, *Functions limits* e *Cron usage* |
| Vercel Workflows (Workflow SDK): `'use workflow'` e `'use step'`; cada step é uma invocação isolada com retry; duração total da run sem limite; step limitado pelo `maxDuration` da função; replay da orquestração limitado a 240s; Hobby inclui 50 mil eventos/mês | Vercel, *Workflows* e *Pricing* |

### 5.2 Consequência direta para o diagrama

O card do Mastra diz "criar agendadores". **Na Vercel, isso não pode ser o scheduler do
Mastra.** E o card do Scheduler ("seg a sáb") precisa ser Vercel Cron no plano Pro (precisão
por minuto) ou o cron do Inngest. Hobby não serve: 7h pode virar 7h59.

O motor padrão do Mastra também não deve ser usado para a run inteira em produção, porque
uma falha na etapa 5 recomeça da etapa 1 na próxima tentativa e o tempo total precisa caber
em 800s no pior caso. Serve para desenvolvimento e para a medição inicial.

### 5.3 Três caminhos, com recomendação

**A. Vercel Cron + workflow do Mastra em uma função (motor padrão).** `maxDuration = 800`
na rota, `CRON_SECRET`, run inteira em uma invocação. Zero infraestrutura nova. Frágil: sem
durabilidade entre etapas, teto de 13 minutos, Pro obrigatório. Adequado para **medir** o
pipeline nas primeiras semanas, não para operar.

**B. Mastra + Inngest.** Mantém os workflows do Mastra (branches, loops, `suspend`) e ganha
durabilidade por step, retry, cron nativo e painel. É o caminho que o Mastra recomenda para
FaaS. Custo: mais um fornecedor (tem plano gratuito), mais uma rota, e a sincronização do
endpoint com o Inngest Cloud. Cada step continua limitado ao `maxDuration` da função, mas
a run não.

**C. Vercel Workflows + agentes do Mastra.** Orquestração com o Workflow SDK da Vercel
(`'use workflow'`), cada etapa um `'use step'` que chama um agente do Mastra. Durável, sem
limite de duração total, observabilidade no painel da Vercel, sem fornecedor extra. Custo:
os workflows do Mastra não são usados (só os agentes), e o SDK é mais novo que o Inngest.
Cron continua sendo o Vercel Cron chamando `start()`.

**Recomendação: C.** Encaixa em "Mastra como módulo do Next" e "Vercel", não adiciona
fornecedor, e o que o pipeline precisa do orquestrador (etapas, retry, estado) o Workflow
SDK dá. O Mastra fica onde é forte: agentes, ferramentas, saída estruturada, troca de modelo
por configuração, avaliação. Se o time preferir manter os workflows do Mastra por já
conhecê-los, B é igualmente sólido; A é só para medir.

### 5.4 Formato das etapas (vale para B e C)

Cada etapa lê e grava em `execucao_pipeline` e é idempotente: reexecutar não duplica
notícia, não regera o que já passou na revisão, não reenvia. Etapas propostas:

| Etapa | Cabe em 300s? | Observação |
| --- | --- | --- |
| `ingerir` | por fonte | uma sub-etapa por fonte, em paralelo |
| `selecionar` | sim | |
| `redigir` | por item | paralelo, 4 a 6 itens |
| `construir` | sim | template, sem LLM; milissegundos |
| `revisar` | sim | inclui captura de tela |
| `enviar` | por lote | 100 por chamada |

Geração e envio desacoplados: gerar cedo (ex.: 5h) com orçamento para retentativas; enviar
às 7h em etapa curta. A medição que o time quer fazer responde "quanto tempo a geração leva
no pior caso" e fixa o horário de início. Cron em UTC: `0 8 * * 1-6` para gerar às 5h,
`0 10 * * 1-6` para enviar às 7h.

### 5.5 Storage do Mastra

Usar `@mastra/pg` apontando para o Supabase, com a string de conexão **pooled** (Supavisor,
porta 6543) e, na Vercel, `attachDatabasePool` do pacote `@vercel/functions` para não
esgotar conexões entre invocações. Colocar as tabelas do Mastra em schema próprio
(`mastra`) para não misturar com o domínio. Sem Inngest e sem schedules, o Mastra guarda
ali memória (se usada), traces e avaliações.

### 5.6 Estrutura no monorepo

Mesmo rodando dentro do Next.js, o pipeline deve ficar em pacotes:

```
packages/
├── db/          # esquema, migrations, cliente tipado
├── pipeline/    # agentes, ferramentas, workflow, templates de e-mail
└── newsletter/  # cadastro, confirmação, descadastro (domínio)
apps/web/        # rotas, páginas, cron endpoints, webhook do Resend
```

Testar o pipeline sem subir o site e mudar de orquestrador sem reescrever os agentes.

## 6. Modelo de dados

Esquema completo em [`esquema.sql`](esquema.sql). O que mudou em relação ao diagrama e por quê:

| Diagrama | Proposta | Motivo |
| --- | --- | --- |
| `Assinante.consentimento (boolean)` | `consentimento_em`, `consentimento_ip`, `consentimento_user_agent`, `politica_versao` | prova de consentimento auditável (LGPD) |
| sem token | `token_hash`, `token_expira_em`, `token_descadastro_hash` | §3.1 e §3.4 |
| sem motivo de cancelamento | `motivo_cancelamento`, `data_cancelamento`, `bounces_soft` | §3.4 e §7.2 |
| `Edicao.noticias (Noticia[])` | tabela `edicao_noticia` com `ordem` | relação N:N não cabe em coluna |
| `Edicao` sem estado | `status`, `assunto`, `texto_plano`, `tentativas`, `log_revisao`, `custo_tokens` | orquestração e auditoria |
| `Noticia` sem origem | `fonte_id`, `url_canonica` única, `hash_conteudo`, `texto_extraido`, `embedding`, `score`, `score_detalhe` | dedup, seleção auditável |
| — | `envio` | idempotência e bounce (§7) |
| — | `execucao_pipeline` | estado das etapas, medição, alerta |
| — | `fonte`, `indicador_valor` | ferramentas do Ingestor (§4.1) |
| — | `evento_cadastro` | limites anti-abuso (§3.2) |
| — | `configuracao` | kill switch e parâmetros |

Notas:

- Migrations versionadas no repositório. Sem esquema editado à mão no painel.
- Acesso só pelo servidor com chave de serviço. RLS ligado em todas as tabelas sem
  políticas públicas, como rede de segurança.
- `texto_extraido` é insumo, não publicação. Limpar após 30 dias.
- Cliente tipado (Drizzle é a sugestão; o SQL é a fonte de verdade de qualquer forma).

## 7. Envio e entregabilidade

### 7.1 Tabela `envio`

Uma linha por (edição, assinante), criada **antes** de chamar o Resend, com status
`pendente`. O lote só inclui linhas `pendente`; reexecução da etapa não reenvia. O
`resend_email_id` liga o webhook de bounce ao assinante. A chave de idempotência do Resend
(24h de validade) é `edicao_id:lote_n`, o que cobre retry dentro da mesma execução.

### 7.2 Política de bounce (proposta)

| Evento (webhook) | Ação |
| --- | --- |
| `email.bounced` hard | `assinante.status = bounce` imediato |
| `email.bounced` soft | `bounces_soft + 1`; 3 consecutivos viram `bounce` |
| `email.complained` | `cancelado`, motivo `reclamacao`, nunca reenviar |
| `email.delivered` | zera `bounces_soft` |

Webhook com verificação de assinatura, idempotente por `resend_email_id + tipo`.

### 7.3 Entregabilidade é infraestrutura, não código do Distribuidor

- Subdomínio dedicado (ex.: `news.`), separado do transacional, com SPF, DKIM e DMARC
  (`p=quarantine` no mínimo).
- Aquecimento: começar com base pequena e crescer. Entra no plano de lançamento.
- Remetente e assunto consistentes, versão texto puro, sem encurtador, poucas imagens.
- Monitorar por edição: bounce abaixo de 2%, reclamação abaixo de 0,1% (Gmail corta em 0,3%).
- Plano gratuito do Resend: 100 e-mails por dia. Base acima disso exige plano pago no
  lançamento. Resend Broadcasts (plano de marketing, cobrado por contato) resolveria
  descadastro e supressão sozinho, mas com a tabela `envio` de volta ao desenho o ganho é
  menor; a API de lote dá controle total e cabe no plano transacional.

## 8. LGPD

Lista mínima, por urgência:

1. **Política de privacidade real antes de coletar.** A caixa de consentimento hoje aponta
   para placeholder.
2. **Registro de consentimento**: data, IP, user agent, versão da política. No esquema.
3. **Revogação tão fácil quanto a concessão**: §3.4.
4. **Retenção**: pendentes apagados após 48h; cancelados mantidos 6 meses como prova e
   apagados; `texto_extraido` limpo em 30 dias; IP de cadastro segue o registro.
5. **Direito de acesso e exclusão**: e-mail do encarregado na política e procedimento,
   ainda que manual, em até 15 dias.
6. **Transferência internacional**: Resend, Supabase e Vercel processam fora do Brasil.
   Região `sa-east-1` onde houver (Supabase e Vercel têm) e DPA assinado com cada um.
   Operadores citados na política.
7. **Abertura e clique**: dado comportamental. Desligar pixel de abertura por padrão; manter
   só clique se houver uso claro, e dizer na política.

## 9. Stack: pontos para o veredito

**Resend.** Adequado. Com a tabela `envio`, usar a API de lote com cabeçalhos de descadastro
próprios. Alternativas que valem uma tarde: Postmark (entregabilidade forte), SES (barato em
escala, mais trabalho).

**Supabase.** Adequado: Postgres, `pgvector` para dedup, `pg_cron` para o job de limpeza,
região em São Paulo. Sem Supabase Auth por enquanto.

**Vercel.** Plano Pro é pré-requisito do cron de 7h e do `maxDuration` de 800s (§5).

**Mastra.** Agentes, ferramentas, saída estruturada e troca de modelo por configuração. Não
usar scheduler nem workers na Vercel (§5.1). Orquestração: Vercel Workflows ou Inngest.

**Gemini vs Claude.** Definir o critério antes do teste: conjunto fixo de 30 notícias;
medir português, aderência ao limite de caracteres, fidelidade à fonte, qualidade da revisão
visual (precisa de modelo com visão), custo por edição e latência. Três execuções por
candidato para ver variação. `custo_tokens` em `execucao_pipeline` alimenta isso em
produção.

## 10. Próximos passos

1. Fechar: orquestrador (C ou B em §5.3), política de bounce, plano Pro da Vercel.
2. Política de privacidade e texto de consentimento (§8).
3. Aplicar `esquema.sql` como primeira migration em `packages/db`.
4. Cadastro real (REB-74/75) com token hasheado, limites, confirmação e descadastro
   (§3), sobre o esquema.
5. Protótipo do pipeline com o caminho A (§5.3) para medir duração por etapa e fixar
   horários; depois migrar para o orquestrador escolhido.
6. Conjunto de avaliação e decisão do modelo (§9).
7. Domínio de envio e aquecimento antes do lançamento (§7.3).

## Fontes consultadas

- Mastra: guia Next.js, deploy em web framework, *Scheduled workflows*, *Workers*, guia
  Inngest, *Storage overview*, *Error handling*
- GitHub mastra-ai/mastra, issue #18807
- Vercel: *Functions limits*, *Cron usage and pricing*, *Workflows*, *Workflow concepts*,
  *Workflow pricing and limits*
- Resend: *Send batch emails*, *Pricing*
