# Deploy

Tudo na conta AWS 382597877834, em `sa-east-1`, sem servidor próprio. Por ambiente (`lab`, `dev`,
`prod`):

- **API**: a imagem `argon/api` (ECR) em duas funções Lambda, `argon-<env>-api` e `argon-<env>-jobs`
  (`aws/lambda.tf`). A de API responde HTTP atrás de um CloudFront, em `api.argonbusiness.com`,
  `api.dev.` e `api.lab.` (`aws/api_cdn.tf`). A de jobs não tem URL: o EventBridge Scheduler a invoca
  com `{"job": "<nome>"}` (`apps/api/src/pipeline/jobs.controller.ts`).
- **Site**: arquivos estáticos do `next build` (`output: "export"`) num bucket S3, uma pasta por
  ambiente, servidos por um CloudFront em `argonbusiness.com`, `dev.` e `lab.` (`aws/site_cdn.tf`). O
  navegador chama a API direto, com CORS.
- **Banco**: uma branch do projeto `argon` no Neon (Postgres 16).

Configuração no Parameter Store (`/argon/<env>/`), lida pelas funções ao subir; logs no CloudWatch
(`/argon/<env>/api`); DNS na Cloudflare. Tudo o que é AWS está em Terraform, em [`aws/`](aws/README.md).
Detalhes no documento Stack.

Até 04/11/2026 tudo rodava numa instância EC2 com Docker Compose (Caddy, um container do site e um
da API por ambiente, timers do systemd). Ela saiu com os scripts desta pasta.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`; `lab` é publicado à mão ("Lab").

## O workflow

Push em `dev` ou `main` roda `.github/workflows/deploy.yml`, um deploy por ambiente de cada vez (o
seguinte espera no grupo de concorrência), num runner arm64. Em ordem:

1. **Imagem da API.** O build só acontece quando os commits tocaram `apps/api` ou os arquivos do
   workspace que a imagem copia (`pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`,
   `turbo.json`). A imagem sai com duas tags: a do commit (12 caracteres do SHA) e a do ambiente
   (`prod`, `dev`, `lab`). Sem mudança, a imagem que o ambiente roda recebe a tag do commit por uma
   cópia de manifesto dentro do ECR, sem pull: a tag de todo deploy identifica uma imagem, que é o
   que o rollback espera. Dispatch, primeiro push e ambiente sem imagem constroem sempre. O build usa
   `buildx` com cache de camadas no cache do Actions, e o `pnpm install` do Dockerfile monta o store
   do pnpm como cache: só o que mudou é baixado de novo.
2. **Arquivos públicos.** `apps/web/public` vai para o bucket público, no prefixo do ambiente, pelo
   root `aws/public-assets` (`aws/README.md`, "Arquivos públicos"). Vem antes das funções: os
   e-mails da API que está para entrar buscam as imagens lá.
3. **Funções Lambda.** A de jobs passa para a imagem nova primeiro e roda o job `migrate`
   (`prisma migrate deploy`, `apps/api/src/pipeline/migrate.ts`); só se ele responder
   `{"done":true}` a de API passa para a mesma imagem. Migration com erro para o deploy ali, com a
   API onde estava: nenhum código roda contra um schema mais velho que ele. Função que não existe é
   pulada.
4. **Site.** Construído com as origens do ambiente (`WEB_ORIGIN` e `API_ORIGIN`, lidas do Parameter
   Store e gravadas nos arquivos), sincronizado com `--delete` para `s3://argon-site-<conta>/<env>/`
   e com a distribuição invalidada (`/*`). A imagem de Open Graph não tem extensão e é regravada como
   `image/png`, para o preview de link. Ambiente sem distribuição é pulado.
5. **Smoke.** Um `curl` em `https://api.<ambiente>/health`, de fora: a função responder não prova que
   CloudFront, DNS, certificado e banco estão de pé. `/health` consulta o banco; `/health/live`, não.

Se qualquer passo falhar, o workflow publica no tópico SNS de alertas (segredo
`AWS_ALERTS_TOPIC_ARN`); sem o segredo, só registra que não avisou.

A imagem da API sai da build com uma poda do que o runtime nunca executa (`apps/api/Dockerfile`,
estágio `deps`); o `prisma migrate deploy` do deploy é o teste dela.

### Configuração manual no GitHub

O repositório não expressa isto; confira em Settings do repositório `argon-hq/site`:

- Environment `prod` com _Required reviewers_ (ao menos uma pessoa) e _Deployment branches_
  limitado a `main`. O workflow recusa `branch` preenchida fora do lab, mas só a proteção do
  environment impede um dispatch de `prod` a partir de outra branch.
- Segredo `AWS_DEPLOY_ROLE_ARN` com o papel `argon-github-deploy` (output `deploy_role_arn`).
- Segredo `AWS_ALERTS_TOPIC_ARN` com o ARN do tópico SNS de alertas da conta (output
  `alerts_topic_arn`).

`AWS_INSTANCE_ID` e a variável `AWS_DEPLOY_BUCKET`, da instância, foram apagados em 04/11/2026.

As actions dos dois workflows são fixadas pelo SHA do commit, com a versão em comentário; o
Dependabot (`.github/dependabot.yml`) abre PRs semanais para actions, a imagem do Dockerfile da API
e pacotes npm (minor e patch agrupados; majors de `next` e `react` ficam de fora). Esses PRs vêm em
inglês, do robô — a exceção às Diretrizes.

```bash
# environment prod: reviewer obrigatório e branch limitada a main
REVIEWER_ID=$(gh api users/<login> --jq .id)
gh api --method PUT repos/argon-hq/site/environments/prod --input - <<EOF
{"reviewers":[{"type":"User","id":$REVIEWER_ID}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api --method POST repos/argon-hq/site/environments/prod/deployment-branch-policies \
  -f name=main -f type=branch
# papel do deploy e tópico de alertas
gh secret set AWS_DEPLOY_ROLE_ARN --repo argon-hq/site --body "arn:aws:iam::382597877834:role/argon-github-deploy"
gh secret set AWS_ALERTS_TOPIC_ARN --repo argon-hq/site --body "arn:aws:sns:sa-east-1:382597877834:<topico>"
```

### ECR

Um repositório, `argon/api` (`aws/ecr.tf`). O ciclo de vida guarda as dez últimas imagens — o
rollback por tag depende de a tag ainda existir — e nunca expira as que têm a tag de um ambiente:
uma função Lambda fixa a imagem que roda, e apagá-la quebra a função.

## Funções

As duas funções de cada ambiente rodam a mesma imagem, arm64, com 1024 MB: `argon-<env>-api` com
30 s de timeout, `argon-<env>-jobs` com 900 s, o teto da Lambda. O Lambda Web Adapter da imagem
transforma cada invocação numa requisição ao servidor Nest na porta 3001, e o
`dist/lambda/main.js` lê `/argon/<env>/` do Parameter Store antes de o app carregar
(`apps/api/src/lambda/`). O adaptador espera `/health/live`, que não toca no banco, antes da primeira
invocação.

A URL da função de API é aberta, mas só o CloudFront passa: ele manda o segredo `x-origin-verify`
(gerado no Terraform, guardado no estado e no ambiente da função), e a API recusa o que chega sem
ele, exceto `/health/live`. O endereço do visitante é o `CloudFront-Viewer-Address`, que os limites
de taxa contam (`apps/api/src/net/cloudfront.ts`). Nada é cacheado na distribuição da API.

### Agendamentos

O EventBridge Scheduler (`aws/lambda.tf`), no horário de `America/Sao_Paulo`, sem nova tentativa:
um job que falhou já avisou os donos, e rodar de novo é decisão de uma pessoa. A invocação
assíncrona também não repete (`maximum_retry_attempts = 0`): um envio cortado pelo timeout não
recomeça sozinho.

| Agendamento                  | Quando                 | Job                |
| ---------------------------- | ---------------------- | ------------------ |
| `argon-<env>-api-keep-warm`  | a cada 5 minutos       | `GET /health/live` |
| `argon-<env>-retention`      | 4h, todo dia           | `retention`        |
| `argon-<env>-edition`        | 5h30, segunda a sábado | `edition`          |
| `argon-<env>-send`           | 7h, segunda a sábado   | `send`             |
| `argon-<env>-watch`          | 8h, segunda a sábado   | `watch`            |
| `argon-<env>-sunday-edition` | 5h30, domingo          | `sunday-edition`   |
| `argon-<env>-sunday-send`    | 7h, domingo            | `sunday-send`      |
| `argon-prod-backup`          | 3h30, todo dia         | `backup`           |
| `argon-prod-restore-drill`   | 5h, dia 1 de cada mês  | `restore-drill`    |

O keep-warm existe nos três ambientes: uma partida a frio da função de API leva de 3,5 a 5 s, e o
primeiro assinante depois de uma hora quieta esperaria isso. Os jobs do dia são criados para todo
ambiente e só ficam ligados nos de `lambda_jobs_enabled` — hoje, só prod. Em dev e lab a geração
fica a um `POST /pipeline/run` de distância. O relógio interno da API (`SCHEDULER_ENABLED`) fica
desligado em todas as funções: os dois nunca rodam juntos.

Rodar um job à mão:

```bash
aws lambda invoke --profile argon-new --function-name argon-dev-jobs --region sa-east-1 \
  --payload '{"job":"watch"}' --cli-binary-format raw-in-base64-out /dev/stdout
```

## Site

Um bucket privado, `argon-site-382597877834`, com uma pasta por ambiente, lido só pelas
distribuições (OAC). Uma CloudFront Function (`aws/site_router.js`) escolhe a pasta do idioma pelo
cookie `locale`, mapeia o caminho da página para o `index.html` e redireciona `www` para o host
canônico. A CSP e o `Referrer-Policy` vêm de uma response headers policy, com os valores de
`apps/web/src/lib/security-headers.ts`. Caminho que não existe responde 404 com
`/pt-BR/page-not-found/`: a resposta de erro não passa pela função, então a página leva o texto dos
dois idiomas e mostra o do cookie (`apps/web/src/app/[locale]/page-not-found`).

## Variáveis

Cada parâmetro `/argon/<env>/NOME` vira a variável `NOME` da função, lida a cada partida a frio
(`apps/api/src/lambda/env.ts`). Todo ambiente espera estas nove, e a última da tabela é opcional:

| Variável                   | Quem lê               | Tipo         |
| -------------------------- | --------------------- | ------------ |
| `DATABASE_URL`             | API                   | SecureString |
| `ANTHROPIC_API_KEY`        | API                   | SecureString |
| `RESEND_API_KEY`           | API                   | SecureString |
| `INTERNAL_API_SECRET`      | API                   | SecureString |
| `UNSUBSCRIBE_TOKEN_SECRET` | API                   | SecureString |
| `WEB_ORIGIN`, `API_ORIGIN` | API e o build do site | String       |
| `MAIL_TRANSPORT`           | API                   | String       |
| `MAIL_FROM`                | API                   | String       |
| `RESEND_WEBHOOK_SECRET`    | API (opcional)        | SecureString |

O Terraform cria esses nomes (`aws/parameters.tf`), com um valor provisório que nunca mais mexe; os
valores são escritos à mão.

`INTERNAL_API_SECRET` protege as rotas do operador (pipeline, configurações, fontes); as do site são
públicas e não o usam.

`UNSUBSCRIBE_TOKEN_SECRET` deriva o token de descadastro de cada assinante (`apps/api/src/subscriber/token.ts`):
pelo menos 32 caracteres, um por ambiente, e trocá-lo invalida todo link de descadastro já enviado.

`WEB_ORIGIN` e `API_ORIGIN` são absolutos e entram nos links de todo e-mail — o site serve a página
de descadastro, a API o endpoint de um clique. O deploy também os lê para construir o site: a origem
da API vai para o bundle e para a CSP, a do site para o sitemap e a metadata. `WEB_ORIGIN` é ainda a
única origem que o CORS da API aceita. `MAIL_TRANSPORT=resend` exige `RESEND_API_KEY`: sem ela a
API não sobe.

`MAIL_FROM` é o endereço que assina todo e-mail, num domínio verificado no Resend para aquele
ambiente: `newsletter@argonbusiness.com` em prod, `newsletter@dev.argonbusiness.com` em dev e
lab. Sem ela a API não sobe. Nome e endereço postal do remetente ficam na tabela de configurações;
o link da política e o do site saem de `WEB_ORIGIN`.

`RESEND_WEBHOOK_SECRET` (SecureString, opcional) é o segredo de assinatura do webhook de entrega,
`POST /webhooks/resend` (`apps/api/README.md`, `src/webhooks/`): o `whsec_...` que o Resend mostra ao
cadastrar o endpoint `<API_ORIGIN>/webhooks/resend`, um por ambiente. Sem ele a rota não existe e
`sent` continua sendo o último status de uma entrega; com um valor fora desse formato a API não sobe.
Ainda não está no `aws/parameters.tf`: o parâmetro é criado à mão (`aws ssm put-parameter --type
SecureString`), porque o valor provisório `CHANGE-ME` do Terraform derrubaria a API.

As imagens do e-mail não têm parâmetro: a API as busca no bucket público, no prefixo do próprio
ambiente (`ARGON_ENV`), que o deploy preenche antes de mover as funções (`aws/README.md`, "Arquivos
públicos"). `PUBLIC_ASSETS_ORIGIN` só entra se um ambiente precisar apontar para outro lugar.

O que difere de função para função não está no Parameter Store: são as variáveis da própria função
(`aws/lambda.tf`), que vencem o que vier de lá.

| Variável                                                             | Valor                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ARGON_SSM_PATH`                                                     | `/argon/<env>/`                                                   |
| `ARGON_ENV`                                                          | o ambiente                                                        |
| `NODE_ENV`                                                           | `production`                                                      |
| `SCHEDULER_ENABLED`, `STUDIO_ENABLED`                                | `false`                                                           |
| `JOBS_ENABLED`                                                       | `true` só na função de jobs                                       |
| `ORIGIN_VERIFY_SECRET`                                               | só na função de API                                               |
| `BACKUP_BUCKET`                                                      | só na função de jobs de prod                                      |
| `AWS_LWA_PORT`, `AWS_LWA_READINESS_CHECK_PATH`, `AWS_LWA_ASYNC_INIT` | o adaptador: porta 3001, `/health/live`, inicialização assíncrona |

O Mastra Studio fica desligado em todo ambiente publicado: é ferramenta da máquina local
(`apps/api/README.md`, "Studio"). `PORT` não entra no Parameter Store: ele tiraria a API da porta
que o adaptador espera.

```bash
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/dev/<NOME> --type SecureString --overwrite --value '<valor>'
```

O perfil importa: `argon-new` é a conta do deploy (382597877834). As funções leem o valor ao subir,
e o keep-warm as mantém quentes: o valor novo só vale para todas depois do deploy seguinte, que troca
os ambientes de execução. `WEB_ORIGIN` e `API_ORIGIN` também estão gravados no site, que só muda no
deploy.

## Infraestrutura como código

Os recursos da conta estão descritos em Terraform em [`aws/`](aws/README.md): funções, agendamentos,
distribuições, certificados, buckets, papéis, ECR, orçamento, grupos de log, alarmes e os nomes dos
parâmetros. O que não está lá (DNS na Cloudflare, o Neon, os valores dos parâmetros) o README de lá
explica.

## Rollback

Cada deploy publica a imagem com a tag do commit (12 caracteres do SHA), e a função de API só passa
para ela depois de as migrations dela terem rodado. Um deploy que morre no meio deixa a função de API
na imagem que ainda funciona.

Voltar para uma tag anterior é rodar o workflow com o input `tag`: o build é pulado e as duas funções
passam para a imagem dessa tag, com o job `migrate` dela antes, como em todo deploy. Depois, a tag
do ambiente (`prod`, `dev`, `lab`) passa para essa imagem: é dela que sai o próximo push que não
mexe na API, e sem isso ele traria de volta a imagem que o rollback tirou do ar. A tag precisa
existir no ECR — o ciclo de vida guarda as dez últimas. O rollback só move a API: os arquivos
públicos e o site ficam como estão, porque o checkout não é o código daquela tag. Para voltar o site,
um revert na branch e um deploy.

```bash
# a tag que está no ar e as anteriores
gh run list --workflow deploy.yml --branch main --limit 5
# prod volta para <sha>; para dev, --ref dev -f env=dev
gh workflow run deploy.yml --ref main -f env=prod -f tag=<sha>
```

Sem o GitHub, o mesmo que o workflow faz, na mesma ordem:

```bash
export AWS_PROFILE=argon-new AWS_REGION=sa-east-1
IMAGE=382597877834.dkr.ecr.sa-east-1.amazonaws.com/argon/api:<sha>
aws lambda update-function-code --function-name argon-prod-jobs --image-uri "$IMAGE"
aws lambda wait function-updated --function-name argon-prod-jobs
aws lambda invoke --function-name argon-prod-jobs --payload '{"job":"migrate"}' \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 900 /dev/stdout   # espera {"done":true}
aws lambda update-function-code --function-name argon-prod-api --image-uri "$IMAGE"
# a tag prod passa a apontar para a imagem que voltou
aws ecr put-image --repository-name argon/api --image-tag prod --image-manifest \
  "$(aws ecr batch-get-image --repository-name argon/api --image-ids imageTag=<sha> \
    --query 'images[0].imageManifest' --output text)"
```

Migrations não voltam: o `prisma migrate deploy` da imagem antiga não desfaz o que a nova aplicou.
Para o rollback ser sempre possível, toda migration precisa ser compatível com a versão anterior do
código — expandir primeiro (coluna nova, tabela nova), contrair depois (apagar a antiga), em
deploys separados.

## Recursos (conta 382597877834, sa-east-1)

| Recurso            | Id                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Funções Lambda     | `argon-<env>-api`, `argon-<env>-jobs`; papéis `argon-lambda-<env>`; agendador `argon-scheduler`                                                  |
| CloudFront         | uma distribuição da API e uma do site por ambiente; certificados do ACM em `us-east-1`                                                           |
| Banco              | Neon, projeto `argon` (`summer-resonance-47838945`, `aws-sa-east-1`), branches `main` (prod), `dev` e `lab`. URLs em `/argon/<env>/DATABASE_URL` |
| Buckets            | `argon-site-382597877834` (site), `argon-public-382597877834` (arquivos públicos), `argon-db-backups-382597877834` (dumps)                       |
| ECR                | `argon/api`                                                                                                                                      |
| Papel do GitHub    | `argon-github-deploy` (OIDC, repositório argon-hq/site)                                                                                          |
| DNS                | `argonbusiness.com` (e `www`), `dev.`, `lab.`, `api.`, `api.dev.`, `api.lab.`, zona na Cloudflare, CNAME para cada CloudFront, sem proxy         |
| Segredos no GitHub | `AWS_DEPLOY_ROLE_ARN`, `AWS_ALERTS_TOPIC_ARN`                                                                                                    |
| Orçamento          | `argon-mensal`, US$ 30, avisos em 80% e 100%                                                                                                     |

## Banco

Desde 04/11/2026, cada ambiente usa uma branch do projeto `argon` no Neon (Postgres 16, `aws-sa-east-1`,
plano Free): `main` para prod, `dev` e `lab`. A computação de cada branch desliga sozinha depois de
5 minutos sem consulta, e por isso o adaptador da Lambda e o keep-warm usam `/health/live`, que não
toca no banco.

`/argon/<env>/DATABASE_URL` aponta para a URL **direta** da branch, sem o pooler: o pipeline trava a
edição do dia com um advisory lock de sessão (`apps/api/src/pipeline/lock.ts`), e o pooler do Neon
trabalha por transação. As URLs com e sem pooler de cada branch também ficam em
`/argon/neon/{PROD,DEV,LAB}_{DIRECT,POOLED}_URL`.

Até 04/11/2026 os três bancos ficavam num container `postgres` na instância EC2, que saiu depois.

### Backup e restauração

O job `backup` roda na função `argon-prod-jobs` às 3h30 (America/Sao_Paulo), antes da geração das
5h30 (`apps/api/src/pipeline/backup.ts`). Só prod tem backup: o banco dele está no Neon, que no plano
Free só restaura até 6 h para trás. O dump cobre o que isso não cobre — uma migration ou um `DELETE`
errado percebido no dia seguinte, e o projeto no Neon deixar de existir. Dev e lab não têm backup:
os dois se refazem a partir de prod ou do zero.

O job usa o mesmo `DATABASE_URL` da função, roda o `pg_dump` da imagem (`postgresql16-client`, a
versão do Neon) e grava o dump no formato custom em
`s3://argon-db-backups-382597877834/postgres/argon_prod/<data>.dump` — o prefixo de quando prod era o
banco local. O dump passa por `/tmp` antes: um `pg_dump` que morre no meio não sobe nada. A retenção
é regra de ciclo de vida no bucket (30 dias), não lógica no job. Só a função de jobs de prod conhece
o bucket (`BACKUP_BUCKET`) e só pode escrever e ler nesse prefixo.

Um backup que falha avisa os donos por e-mail, pelo mesmo alerta dos jobs. Um backup que nem roda
não tem como avisar, então o job publica a métrica `Argon/BackupOk = 1` ao terminar, e o alarme
`argon-backup-missing` dispara quando ela some por um dia (`aws/alarms.tf`).

Para voltar prod a um momento das últimas 6 h, o caminho é o _instant restore_ do Neon (console,
Branches → Restore), que não precisa de dump. Para voltar a um dump, por cima do que existe, com a
URL direta da branch em `URL`:

```bash
aws s3 cp s3://argon-db-backups-382597877834/postgres/argon_prod/2026-11-04T06-30-00Z.dump r.dump
docker run --rm -i -e URL pgvector/pgvector:pg16 \
  sh -c 'cat > /tmp/r.dump && pg_restore --clean --if-exists --no-owner --no-privileges -d "$URL" /tmp/r.dump' < r.dump
```

#### Ensaio de restauração

Backup que ninguém restaurou é esperança. No dia 1 de cada mês, às 5h (America/Sao_Paulo), o
agendamento `argon-prod-restore-drill` invoca a função `argon-prod-jobs` com
`{"job":"restore-drill"}` (`apps/api/src/pipeline/restore-drill.ts`). O job:

1. restaura o último dump de `postgres/argon_prod/` num banco próprio, `argon_restore_drill`, no
   mesmo branch de prod do Neon;
2. registra `select count(*) from subscriber` no log `/argon/prod/api`;
3. apaga o banco;
4. publica `Argon/RestoreDrillOk`.

A lista de assinantes não sai do servidor que já a guarda, e o ensaio restaura onde uma restauração
de verdade cairia. Falha manda e-mail aos donos pelo mesmo alerta dos jobs. O banco é apagado antes e
depois, então um ensaio que morreu no meio não trava o próximo.

```bash
aws lambda invoke --function-name argon-prod-jobs --region sa-east-1 \
  --payload '{"job":"restore-drill"}' --cli-binary-format raw-in-base64-out /dev/stdout   # rodar agora
```

O restore roda com `--no-owner` e `--no-privileges`: o dump dá os objetos e as permissões a papéis do
Neon, e o papel da aplicação recria tudo como seu. Para contar assinantes, basta. A função só lê e
lista `postgres/argon_prod/` no bucket (`deploy/aws/lambda.tf`).

## Lab

Ambiente para publicar uma branch em desenvolvimento sem esperar merge. É um só, sobrescrito a cada
uso, com a branch `lab` do Neon, separada de dev.

Em Actions → Deploy → Run workflow: ambiente `lab` e o nome da branch a publicar. O workflow e o
Terraform dos arquivos públicos vêm da branch em que ele roda (normalmente `dev`); o código da API e
do site vem da branch escolhida. Fica em `lab.argonbusiness.com` e `api.lab.argonbusiness.com`.

```bash
gh workflow run deploy.yml --ref dev -f env=lab -f branch=feat/ARGN-<n>-<descricao>
```

Parado, o lab quase não custa: a função só roda quando chamada e pelo keep-warm, e a branch do Neon
desliga sozinha. Os jobs do dia estão desligados nele, como em dev.
