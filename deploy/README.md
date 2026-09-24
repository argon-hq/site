# Deploy

Uma instância EC2 (sa-east-1) com Docker Compose: Caddy na frente, um container do site e um da API por ambiente, e um Postgres para todos eles. Imagens no ECR, segredos no Parameter Store, logs no CloudWatch. Detalhes no documento Stack.

- `bootstrap.sh`: user data da instância. Instala Docker, o Compose (versão e checksum fixos), `jq`,
  o swap, as atualizações automáticas e os timers. Idempotente: rode de novo para aplicar uma mudança
  nele à instância existente.
- `compose.yml`, `Caddyfile`: ficam em `/opt/argon` na instância; o workflow de deploy os envia a cada execução.
- `deploy.sh <prod|dev|lab> <tag> [apps]`: puxa as imagens, regera os envs a partir do Parameter Store, sobe o Postgres, reconcilia o banco do ambiente, sobe o resto e, só então, grava a tag em `.env`.
- `provision-db.sh <env>`: cria papel, banco e extensão do ambiente no Postgres local. Idempotente, roda a cada deploy.
- `backup-db.sh`: dump de todos os bancos para o S3. Chamado pelo timer `argon-backup`.
- `lab-idle-stop.sh [minutos]`: para o lab depois de um tempo sem requisição. Chamado pelo timer `argon-lab-idle`.
- `restore-drill.sh`: restaura o último dump de prod em `argon_lab`, conta os assinantes e esvazia o lab de novo. Chamado pelo timer `argon-restore-drill`, mensal.
- `reset-lab.sh [argon_lab|argon_dev]`: apaga e recria um banco descartável, vazio. Recusa qualquer outro nome.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`.

## O workflow

Push em `dev` ou `main` constrói as imagens no runner, envia os arquivos desta pasta para a
instância e roda o `deploy.sh` por SSM. O workflow espera o comando terminar de verdade — até
10 minutos, com `--timeout-seconds 1800` no SSM — e só então lê o resultado. Antes, o `aws ssm wait`
desistia em ~100 s: deploys normais ficavam vermelhos enquanto rodavam e liberavam o grupo de
concorrência com o `deploy.sh` ainda no meio.

Ao fim, um `curl` em `https://api.<ambiente>/health` de fora: o container responder por dentro não
prova que Caddy, DNS e certificado estão de pé. Se qualquer passo falhar, o workflow publica no
tópico SNS de alertas (segredo `AWS_ALERTS_TOPIC_ARN`); sem o segredo, só registra que não avisou.

Na instância, o `deploy.sh` recusa ambiente que não seja `prod`, `dev` ou `lab` e segura um `flock`
em `/opt/argon/.deploy.lock`: prod e dev têm grupos de concorrência separados no GitHub, então dois
deploys podem chegar juntos, e os dois mexem no `.env`, no Caddy e no prune. O segundo espera. O
`up -d --wait` só devolve "ok" quando todo container passou no healthcheck — `/health` na API, que
também confere o banco, e `/` no site; um container em crash loop derruba o deploy em vez de
fingir sucesso.

### Configuração manual no GitHub

O repositório não expressa isto; confira em Settings do repositório `argon-hq/site`:

- Environment `prod` com *Required reviewers* (ao menos uma pessoa) e *Deployment branches*
  limitado a `main`. O workflow recusa `branch` preenchida fora do lab, mas só a proteção do
  environment impede um dispatch de `prod` a partir de outra branch.
- Segredo `AWS_ALERTS_TOPIC_ARN` com o ARN do tópico SNS de alertas da conta.

```bash
# environment prod: reviewer obrigatório e branch limitada a main
REVIEWER_ID=$(gh api users/<login> --jq .id)
gh api --method PUT repos/argon-hq/site/environments/prod --input - <<EOF
{"reviewers":[{"type":"User","id":$REVIEWER_ID}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api --method POST repos/argon-hq/site/environments/prod/deployment-branch-policies \
  -f name=main -f type=branch
# tópico de alertas
gh secret set AWS_ALERTS_TOPIC_ARN --repo argon-hq/site --body "arn:aws:sns:sa-east-1:382597877834:<topico>"
```

## Caddy

Todo site importa o snippet `(secure)`: HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
`Permissions-Policy`, `Referrer-Policy` (só se o app não mandou uma) e corpo de requisição limitado
a 1 MB. Os hosts de prod gravam o log de acesso em JSON no stdout, que o driver `awslogs` leva para
o grupo `/argon/caddy`, com retenção de 30 dias como os outros.

### Acesso do operador

O Studio (`/studio`, `/mastra`) nos hosts de dev e lab e os hosts `api.dev` e `api.lab` inteiros
pedem usuário e senha (`basic_auth`) antes de chegar à API. O segredo interno continua valendo
atrás disso; a senha só tira essas superfícies do alcance de quem varre a internet. Duas rotas dos
hosts de API ficam abertas porque quem as chama não tem como mandar senha: `GET /health` (o smoke
do deploy) e `POST /subscriber/unsubscribe/one-click` (o cliente de e-mail, RFC 8058). Prod não
muda: o site é público e a API de prod só tem o segredo interno, como antes.

As credenciais vivem em `/argon/caddy/` no Parameter Store e viram `env/caddy.env` no deploy. **As
duas são obrigatórias**: sem `STUDIO_AUTH_HASH` o Caddy se recusa a carregar o `basic_auth` e
derrubaria todos os sites junto, então o `deploy.sh` para antes, com a mensagem dizendo o que falta.

```bash
HASH=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext '<senha>')
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/caddy/STUDIO_AUTH_USER --type String --overwrite --value 'argon'
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/caddy/STUDIO_AUTH_HASH --type SecureString --overwrite --value "$HASH"
```

No Studio, o navegador pede a senha uma vez por host; o `x-internal-secret` continua guardado no
próprio Studio. Para o `curl`: `curl -u argon https://api.dev.argon.eduardofockink.com/...`.

### Lab parado

Os hosts do lab distinguem o 502 de proxy sem destino — o lab parado pelo `lab-idle-stop.sh`, que
vira o 503 "O lab está parado" — de qualquer outro erro, que sai com o código original. Um
container em crash loop aparece como o que é, não como um convite a publicar de novo.

## Variáveis

Cada parâmetro `/argon/<env>/NOME` vira `NOME="valor"` em `env/<env>.env`, que a API lê inteiro. O
site lê `env/<env>.web.env`, um recorte com só `API_URL`, `INTERNAL_API_SECRET` e `ARGON_ENV`: as
chaves de modelo e de e-mail nunca entram no container do site. Os arquivos ficam em `env/` com
`700` no diretório e `600` nos arquivos, só root. Todo ambiente espera estas oito, e aceita uma
nona:

| Variável | Quem lê | Tipo |
| --- | --- | --- |
| `DATABASE_URL` | API | SecureString |
| `ANTHROPIC_API_KEY` | API | SecureString |
| `RESEND_API_KEY` | API | SecureString |
| `INTERNAL_API_SECRET` | site e API | SecureString |
| `API_URL` | site | String |
| `WEB_ORIGIN`, `API_ORIGIN` | API | String |
| `MAIL_TRANSPORT` | API | String |
| `SCHEDULER_ENABLED` | API | String, opcional |

`API_URL` alcança a API pela rede do compose: `http://api-<env>:3001`. `WEB_ORIGIN` e `API_ORIGIN`
são absolutos e entram nos links de todo e-mail — o site serve a página de descadastro, a API o
endpoint de um clique. `MAIL_TRANSPORT=resend` exige `RESEND_API_KEY`: sem ela a API não sobe.

`SCHEDULER_ENABLED` é o relógio interno. Sem ela o ambiente não tem relógio nenhum e a geração fica
a um `POST /pipeline/run` de distância; com `true`, ele gera a edição sozinho às 5h30, de segunda a
sábado. Hoje só `dev` a tem.

`NODE_ENV` e `PORT` não entram. Já vêm nas imagens, e um `PORT` no arquivo derrubaria o container —
o site escuta 3000, a API 3001.

O valor vai entre aspas no formato JSON (`jq @json`), então `#`, tab, aspas e quebra de linha chegam
inteiros ao container. Compose expande `$nome` dentro do arquivo mesmo entre aspas; o `deploy.sh`
dobra cada `$` (`$$`), que é como o Compose lê um `$` literal — importa para senhas e para o hash
bcrypt do Caddy. O `provision-db.sh` desfaz as duas coisas ao ler a `DATABASE_URL`.

```bash
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/dev/<NOME> --type SecureString --overwrite --value '<valor>'
```

O perfil importa: `argon-new` é a conta do deploy (382597877834); o `default` aponta para a conta
do DNS. O valor só chega aos containers no deploy seguinte, que é quem regera `env/<env>.env`.

## Rollback

Cada deploy publica as imagens com a tag do commit (12 caracteres do SHA) e o `deploy.sh` só grava
essa tag em `/opt/argon/.env` depois que todo container passou no healthcheck. Um deploy que morre
no meio deixa o `.env` apontando para a imagem que ainda funciona.

Voltar para uma tag anterior é rodar o workflow com o input `tag`: o build é pulado, as duas imagens
dessa tag são publicadas de novo e o resto do deploy é o de sempre, migrations incluídas. A tag
precisa existir no ECR — a política de ciclo de vida guarda as dez últimas por repositório — e a
tag de cada deploy identifica as duas imagens, mesmo quando só uma delas foi construída.

```bash
# a tag que está no ar e as anteriores
gh run list --workflow deploy.yml --branch main --limit 5
# prod volta para <sha>; para dev, --ref dev -f env=dev
gh workflow run deploy.yml --ref main -f env=prod -f tag=<sha>
```

Sem o GitHub, direto na instância, com os arquivos de deploy que já estão em `/opt/argon`:

```bash
aws ssm send-command --profile argon-new --region sa-east-1 --instance-ids i-00296133cc8e8093d \
  --document-name AWS-RunShellScript --comment "rollback prod <sha>" \
  --parameters 'commands=["cd /opt/argon && ./deploy.sh prod <sha> \"web api\""]'
```

Migrations não voltam: o `prisma migrate deploy` da imagem antiga não desfaz o que a nova aplicou.
Para o rollback ser sempre possível, toda migration precisa ser compatível com a versão anterior do
código — expandir primeiro (coluna nova, tabela nova), contrair depois (apagar a antiga), em
deploys separados.

## Recursos criados (17/09/2026, conta 382597877834, sa-east-1)

| Recurso | Id |
| --- | --- |
| Instância EC2 | `i-00296133cc8e8093d` (t4g.small, 16 GB, IP elástico 54.94.89.230) |
| Security groups | `sg-0768581b67b050a67` (web), `sg-003868d936307df4b` (db) |
| Banco | Container `postgres` no compose, volume `db-data`. Senha do superusuário em `/argon/postgres/POSTGRES_PASSWORD` |
| Backup | Bucket S3 `ARGON_BACKUP_BUCKET` em `/opt/argon/.env`, timer `argon-backup` |
| ECR | `argon/web`, `argon/api` |
| Papel do GitHub | `argon-github-deploy` (OIDC, repositório argon-hq/site) |
| DNS | `argon.eduardofockink.com`, `dev.argon.eduardofockink.com`, `lab.argon.eduardofockink.com`, `api.argon.eduardofockink.com`, `api.dev.argon.eduardofockink.com`, `api.lab.argon.eduardofockink.com` (zona na conta 663702377780, provisória até a ARG-68) |
| Segredos no GitHub | `AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID`, `AWS_ALERTS_TOPIC_ARN` |
| Orçamento | `argon-mensal`, US$ 30, avisos em 80% e 100% |

Acesso à instância: `aws ssm start-session --target i-00296133cc8e8093d`. Sem SSH.

## Banco

Postgres 16 com pgvector, na própria instância, no lugar do RDS. O RDS custava US$ 29/mês — mais que a máquina que roda todos os containers — para servir um banco que só o desenvolvimento usa.

Um container para os três ambientes, cada um com seu papel e seu banco (`argon_prod`, `argon_dev`, `argon_lab`), como era no RDS. Sem porta publicada: só a rede do Compose alcança, e de um container para outro a autenticação é por senha (`scram-sha-256`).

`DATABASE_URL` no Parameter Store continua sendo a fonte única das credenciais. O `provision-db.sh` lê de lá e reconcilia o papel e o banco a cada deploy — um volume novo se reconstrói sozinho no deploy seguinte. Um ambiente cuja URL ainda aponte para um host de RDS é pulado, então dá para migrar um ambiente de cada vez.

O host é `postgres` e a conexão não usa TLS: ela não sai da rede do Compose, na mesma máquina.

```
postgresql://argon_dev:SENHA@postgres:5432/argon_dev
```

### Backup e restauração

O timer `argon-backup` roda `backup-db.sh` às 3h30 (America/Sao_Paulo), antes da geração das 5h30. Cada banco vira um dump no formato custom em `s3://$ARGON_BACKUP_BUCKET/postgres/<banco>/<data>.dump`. A retenção é regra de ciclo de vida no bucket, não lógica no script.

Um backup que falha avisa: a unit tem `OnFailure=argon-alert@%n.service`, que publica o nome da
unit no tópico SNS de alertas (`ARGON_ALERTS_TOPIC_ARN` em `/opt/argon/.env`). Um backup que nem
roda não tem como avisar, então o script publica a métrica `Argon/BackupOk = 1` ao terminar, e um
alarme no CloudWatch dispara quando ela some por 26 h (comandos em "Configuração manual na AWS").

Restaurar um banco à mão, por cima do que existe:

```bash
aws s3 cp s3://BUCKET/postgres/argon_dev/2026-09-23T06-30-00Z.dump - \
  | docker compose exec -T postgres sh -c 'cat > /tmp/r.dump'
docker compose exec -T postgres pg_restore -U postgres -d argon_dev --clean --if-exists /tmp/r.dump
```

#### Ensaio de restauração

Backup que ninguém restaurou é esperança. No dia 1 de cada mês, às 5h (America/Sao_Paulo), o timer
`argon-restore-drill` roda `restore-drill.sh`: esvazia `argon_lab` com o `reset-lab.sh`, restaura
nele o último dump de `argon_prod`, imprime `select count(*) from subscriber` no journal, esvazia o
lab de novo — o lab não fica com a lista de assinantes de prod — e publica `Argon/RestoreDrillOk`.
O lab fica parado até o próximo deploy, como depois do `lab-idle-stop.sh`. Falha vai para o SNS pela
mesma `argon-alert@`.

```bash
systemctl start argon-restore-drill.service && journalctl -u argon-restore-drill -n 5   # rodar agora
/opt/argon/reset-lab.sh argon_lab     # só esvaziar o lab (ou argon_dev); prod é recusado pelo nome
```

A extensão `vector` é criada pelo `provision-db.sh` como superusuário, e o restore pula as entradas
de extensão do dump: pgvector não é uma extensão *trusted*, então o `CREATE EXTENSION` do próprio
dump falharia rodando como `argon_lab`. O resto restaura como o papel do lab, que fica dono das
tabelas como uma migration deixaria.

## Instância

O `compose.yml` limita `api-dev` e `api-lab` a 512 MB e `web-dev` e `web-lab` a 256 MB: uma rodada
live num deles não pode levar a instância a matar o prod. `postgres`, `api-prod` e `web-prod` têm
`oom_score_adj: -800`, os últimos que o kernel escolheria. Os containers de Node sobem com `init`
(tini), para responder a `compose stop` sem esperar o kill. Todo `awslogs` é `non-blocking` com 4 MB
de buffer: CloudWatch fora do ar derruba linhas de log, não a API.

Imagens fixadas no minor (`caddy:2.11-alpine`, `node:22.23-alpine` nos Dockerfiles); `pgvector:pg16`
fica no major de propósito, porque o diretório de dados só muda de major com `pg_upgrade` e o build
do pgvector viaja com a imagem. Subir de versão é um PR de uma linha.

O `bootstrap.sh` instala o Compose com versão e checksum fixos (`COMPOSE_VERSION` e os dois
`COMPOSE_SHA256_*`, de `checksums.txt` da release), liga o `dnf-automatic-install.timer` só para
atualizações de segurança (por volta das 3h, antes do backup), e um timer `argon-reboot` aos
domingos 9h que só reinicia se `dnf needs-restarting -r` disser que uma atualização pede
(domingo não tem edição). `vm.swappiness=10` em `/etc/sysctl.d/90-argon.conf`. As units que mexem
em container têm `After=` e `Requires=docker.service`.

Para aplicar uma mudança do `bootstrap.sh` à instância que já existe:

```bash
aws ssm send-command --profile argon-new --region sa-east-1 --instance-ids i-00296133cc8e8093d \
  --document-name AWS-RunShellScript --comment "bootstrap" \
  --parameters "$(jq -n --arg s "echo $(base64 -w0 deploy/bootstrap.sh) | base64 -d | bash" '{commands:[$s]}')"
```

### Configuração manual na AWS

O que os scripts esperam e não criam:

- `ARGON_ALERTS_TOPIC_ARN=arn:aws:sns:sa-east-1:382597877834:<topico>` em `/opt/argon/.env`, ao lado
  de `ARGON_BACKUP_BUCKET`.
- O papel da instância precisa de `sns:Publish` no tópico e `cloudwatch:PutMetricData`.
- Alarme por ausência de backup:

```bash
aws cloudwatch put-metric-alarm --profile argon-new --region sa-east-1 \
  --alarm-name argon-backup-missing --namespace Argon --metric-name BackupOk \
  --statistic Sum --period 93600 --evaluation-periods 1 --threshold 1 \
  --comparison-operator LessThanThreshold --treat-missing-data breaching \
  --alarm-actions arn:aws:sns:sa-east-1:382597877834:<topico>
```

## Lab

Ambiente para publicar uma branch em desenvolvimento sem esperar merge. É um só, sobrescrito a cada uso, com banco `argon_lab`, separado de dev.

Em Actions → Deploy → Run workflow: ambiente `lab` e o nome da branch a publicar. O compose, o Caddyfile e o deploy.sh vêm da branch em que o workflow roda (normalmente `dev`); o código vem da branch escolhida. Fica em `lab.argon.eduardofockink.com` e `api.lab.argon.eduardofockink.com`.

```bash
gh workflow run deploy.yml --ref dev -f env=lab -f branch=feat/ARG-94-db-schema-prisma
```

### Parada por inatividade

O lab é descartável e dividia ~320 MB de uma instância de 2 GB com prod e dev sem ninguém usando.
Agora ele para sozinho.

Os dois hosts do lab gravam em `logs/lab.log`, montado no Caddy. A data de modificação desse
arquivo é o último sinal de vida do ambiente — o `lab-idle-stop.sh`, a cada dez minutos, para
`web-lab` e `api-lab` se ela estiver mais velha que a janela de inatividade. O deploy toca o
arquivo, então um lab recém-publicado tem a janela inteira antes de poder ser parado.

A janela padrão é de 60 minutos; mude com `LAB_IDLE_MINUTES` em `/opt/argon/.env`. Com o lab
parado, os dois hosts respondem 503 com uma linha explicando como subir de novo — não um 502 seco.

Subir de novo é publicar a branch pelo workflow. Não há religamento automático por acesso: quem
abre o lab normalmente acabou de publicar nele.

```bash
systemctl list-timers argon-lab-idle     # quando roda de novo
/opt/argon/lab-idle-stop.sh 0            # para agora, sem esperar
```
