# Deploy

Uma instância EC2 (sa-east-1) com Docker Compose: Caddy na frente, um container do site e um da API por ambiente. O banco de cada ambiente é uma branch no Neon. Imagens no ECR, segredos no Parameter Store, logs no CloudWatch. Detalhes no documento Stack.

- `bootstrap.sh`: user data da instância. Instala Docker, o Compose (versão e checksum fixos), `jq`,
  o swap, as atualizações automáticas e os timers. Idempotente: rode de novo para aplicar uma mudança
  nele à instância existente.
- `compose.yml`, `Caddyfile`: ficam em `/opt/argon` na instância; o workflow de deploy os envia a cada execução.
- `deploy.sh <prod|dev|lab> <tag> [apps]`: puxa as imagens, regera os envs a partir do Parameter Store, roda as migrations, sobe os serviços e, só então, grava a tag em `.env`.
- `backup-db.sh`: dump do banco de prod (Neon) para o S3. Chamado pelo timer `argon-backup`.
- `lab-idle-stop.sh [minutos]`: para o lab depois de um tempo sem requisição. Chamado pelo timer `argon-lab-idle`.
- `restore-drill.sh`: restaura o último dump de prod num Postgres descartável, conta os assinantes e apaga o container. Chamado pelo timer `argon-restore-drill`, mensal.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`.

## O workflow

Push em `dev` ou `main` constrói as imagens no runner, envia os arquivos desta pasta para a
instância e roda o `deploy.sh` por SSM. O workflow espera o comando terminar de verdade — até
10 minutos, com `--timeout-seconds 1800` no SSM — e só então lê o resultado. Antes, o `aws ssm wait`
desistia em ~100 s: deploys normais ficavam vermelhos enquanto rodavam e liberavam o grupo de
concorrência com o `deploy.sh` ainda no meio.

Um push só constrói o app que os commits tocaram — `apps/<app>` ou os arquivos do workspace que
toda imagem copia (`pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`). O outro
app recebe a tag do commit por uma cópia de manifesto dentro do ECR, sem pull: a tag de todo deploy
identifica as duas imagens, que é o que o rollback e o `.env` da instância esperam. Dispatch, primeiro
push e app sem imagem no ambiente constroem os dois. O build usa `buildx` com cache de camadas no
cache do Actions, um escopo por app, e o `pnpm install` dos Dockerfiles monta o store do pnpm como
cache: só o que mudou é baixado de novo.

Os arquivos desta pasta vão para a instância por S3 — `s3://$AWS_DEPLOY_BUCKET/deploy/<tag>/`,
sincronizados em `/opt/argon` antes do `deploy.sh` — quando a variável `AWS_DEPLOY_BUCKET` existe
no repositório. Sem ela, vão inline no comando do SSM, em base64, como antes; isso funciona, mas
o comando cresce com cada script. O bucket de backup serve (prefixo `deploy/`), e é o que a seção
abaixo assume; um bucket próprio também. Uma regra de ciclo de vida de 30 dias no prefixo evita
acumular.

Ao fim, um `curl` em `https://api.<ambiente>/health` de fora: o container responder por dentro não
prova que Caddy, DNS e certificado estão de pé. Se qualquer passo falhar, o workflow publica no
tópico SNS de alertas (segredo `AWS_ALERTS_TOPIC_ARN`); sem o segredo, só registra que não avisou.

Na instância, o `deploy.sh` recusa ambiente que não seja `prod`, `dev` ou `lab` e segura um `flock`
em `/opt/argon/.deploy.lock`: prod e dev têm grupos de concorrência separados no GitHub, então dois
deploys podem chegar juntos, e os dois mexem no `.env`, no Caddy e no prune. O segundo espera. O
`up -d --wait` só devolve "ok" quando todo container passou no healthcheck — `/health/live` na API e
`/` no site; um container em crash loop derruba o deploy em vez de fingir sucesso. O healthcheck da
API não consulta o banco: a cada 30 s, uma consulta impediria o Neon de desligar a computação. Quem
confere o banco é o `curl` em `/health` do fim do deploy.

Imagens na instância: ao fim de cada deploy ficam só a tag que cada ambiente está rodando (as três
do `.env`, então um lab parado pela ociosidade mantém a dele) e a tag que o ambiente recém-publicado
rodava antes, para um rollback sem esperar o pull. Todo o resto das imagens `argon/*` é removido;
o caddy e a imagem do Postgres, de onde o backup roda o `pg_dump`, nunca são candidatas. É um conjunto, não uma janela de tempo: guardar "as de hoje"
deixava dez deploys num dia estacionarem 7 GB de imagens da API num disco de 16 GB, que foi o que
o encheu em 23/09. A imagem da API sai da build com uma poda do que o runtime nunca executa
(`apps/api/Dockerfile`, estágio `deps`); o `prisma migrate deploy` do deploy é o teste dela.

### Configuração manual no GitHub

O repositório não expressa isto; confira em Settings do repositório `argon-hq/site`:

- Environment `prod` com _Required reviewers_ (ao menos uma pessoa) e _Deployment branches_
  limitado a `main`. O workflow recusa `branch` preenchida fora do lab, mas só a proteção do
  environment impede um dispatch de `prod` a partir de outra branch.
- Segredo `AWS_ALERTS_TOPIC_ARN` com o ARN do tópico SNS de alertas da conta.
- Variável `AWS_DEPLOY_BUCKET` com o bucket por onde os arquivos de deploy passam. O papel do
  GitHub (`argon-github-deploy`) precisa de `s3:PutObject` em `deploy/*` nele, e o papel da
  instância de `s3:GetObject` e `s3:ListBucket`.

As actions dos dois workflows são fixadas pelo SHA do commit, com a versão em comentário; o
Dependabot (`.github/dependabot.yml`) abre PRs semanais para actions, imagens dos Dockerfiles e do
compose e pacotes npm (minor e patch agrupados; majors de `next` e `react` ficam de fora). Esses
PRs vêm em inglês, do robô — a exceção às Diretrizes.

```bash
# environment prod: reviewer obrigatório e branch limitada a main
REVIEWER_ID=$(gh api users/<login> --jq .id)
gh api --method PUT repos/argon-hq/site/environments/prod --input - <<EOF
{"reviewers":[{"type":"User","id":$REVIEWER_ID}],
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api --method POST repos/argon-hq/site/environments/prod/deployment-branch-policies \
  -f name=main -f type=branch
# tópico de alertas e bucket dos arquivos de deploy
gh secret set AWS_ALERTS_TOPIC_ARN --repo argon-hq/site --body "arn:aws:sns:sa-east-1:382597877834:<topico>"
gh variable set AWS_DEPLOY_BUCKET --repo argon-hq/site --body "<bucket>"
```

### ECR

Os dois repositórios precisam de varredura ao subir e de uma regra que segure só as dez últimas
imagens — o rollback por tag depende de a tag ainda existir, e o disco do ECR também custa:

```bash
for r in argon/web argon/api; do
  aws ecr put-image-scanning-configuration --profile argon-new --region sa-east-1 \
    --repository-name $r --image-scanning-configuration scanOnPush=true
  aws ecr put-lifecycle-policy --profile argon-new --region sa-east-1 --repository-name $r \
    --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep the last 10","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'
done
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
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/caddy/OPERATOR_SESSION --type SecureString --overwrite --value "$(openssl rand -hex 32)"
```

No Studio a senha é pedida uma vez, ao abrir `/studio`, e a resposta grava um cookie de sessão
(`argon_operator`, trinta dias, `HttpOnly`, `Secure`, `SameSite=Strict`). Com o cookie, o Caddy deixa
passar as chamadas a `/mastra/...` e acrescenta ele mesmo o `x-internal-secret` do ambiente —
nada a configurar nas Settings do Studio. O navegador só reaproveitaria a senha do `basic_auth`
abaixo do caminho em que ela foi pedida, e cada chamada do Studio a um caminho novo viraria outro
pedido de senha; o cookie é o que resolve isso. O valor do cookie é um segredo próprio,
`/argon/caddy/OPERATOR_SESSION`; trocá-lo desloga todo mundo. A senha em claro fica em
`/argon/caddy/STUDIO_AUTH_PASSWORD`. Para o `curl`: `curl -u argon https://api.dev.argonbusiness.com/...`.

O `deploy.sh` grava em `env/caddy.env`, além dos três parâmetros de `/argon/caddy/`, o
`INTERNAL_API_SECRET` de dev e de lab (`DEV_INTERNAL_API_SECRET`, `LAB_INTERNAL_API_SECRET`), que é o
que o Caddy injeta.

### Lab parado

Os hosts do lab distinguem o 502 de proxy sem destino — o lab parado pelo `lab-idle-stop.sh`, que
vira o 503 "O lab está parado" — de qualquer outro erro, que sai com o código original. Um
container em crash loop aparece como o que é, não como um convite a publicar de novo.

## Variáveis

Cada parâmetro `/argon/<env>/NOME` vira `NOME="valor"` em `env/<env>.env`, que a API lê inteiro. O
site lê `env/<env>.web.env`, um recorte com só `API_URL`, `INTERNAL_API_SECRET` e `ARGON_ENV`: as
chaves de modelo e de e-mail nunca entram no container do site. Os arquivos ficam em `env/` com
`700` no diretório e `600` nos arquivos, só root. Todo ambiente espera estas dez, e aceita uma
décima primeira:

| Variável                   | Quem lê    | Tipo             |
| -------------------------- | ---------- | ---------------- |
| `DATABASE_URL`             | API        | SecureString     |
| `ANTHROPIC_API_KEY`        | API        | SecureString     |
| `RESEND_API_KEY`           | API        | SecureString     |
| `INTERNAL_API_SECRET`      | site e API | SecureString     |
| `API_URL`                  | site       | String           |
| `WEB_ORIGIN`, `API_ORIGIN` | API        | String           |
| `MAIL_TRANSPORT`           | API        | String           |
| `MAIL_FROM`                | API        | String           |
| `UNSUBSCRIBE_TOKEN_SECRET` | API        | SecureString     |
| `SCHEDULER_ENABLED`        | API        | String, opcional |

`UNSUBSCRIBE_TOKEN_SECRET` deriva o token de descadastro de cada assinante (`apps/api/src/subscriber/token.ts`):
pelo menos 32 caracteres, um por ambiente, e trocá-lo invalida todo link de descadastro já enviado.

`API_URL` alcança a API pela rede do compose: `http://api-<env>:3001`. `WEB_ORIGIN` e `API_ORIGIN`
são absolutos e entram nos links de todo e-mail — o site serve a página de descadastro, a API o
endpoint de um clique. `MAIL_TRANSPORT=resend` exige `RESEND_API_KEY`: sem ela a API não sobe.

`MAIL_FROM` é o endereço que assina todo e-mail, num domínio verificado no Resend para aquele
ambiente: `newsletter@argonbusiness.com` em prod, `newsletter@dev.argonbusiness.com` em dev e
lab. Sem ela a API não sobe. Nome e endereço postal do remetente ficam na tabela de configurações;
o link da política e o do site saem de `WEB_ORIGIN`.

As imagens do e-mail não têm parâmetro: a API as busca no bucket público, no prefixo do próprio
ambiente (`ARGON_ENV`, que o `deploy.sh` escreve), e o deploy copia `apps/web/public` para lá antes
de reiniciar os containers (`aws/README.md`, "Arquivos públicos"). `PUBLIC_ASSETS_ORIGIN` só entra
se um ambiente precisar apontar para outro lugar.

`SCHEDULER_ENABLED` é o relógio interno. Sem ela o ambiente não tem relógio nenhum e a geração fica
a um `POST /pipeline/run` de distância; com `true`, ele gera a edição sozinho às 5h30, de segunda a
sábado. Hoje só `dev` a tem.

`NODE_ENV` e `PORT` não entram. Já vêm nas imagens, e um `PORT` no arquivo derrubaria o container —
o site escuta 3000, a API 3001.

O valor vai entre aspas no formato JSON (`jq @json`), então `#`, tab, aspas e quebra de linha chegam
inteiros ao container. Compose expande `$nome` dentro do arquivo mesmo entre aspas; o `deploy.sh`
dobra cada `$` (`$$`), que é como o Compose lê um `$` literal — importa para senhas e para o hash
bcrypt do Caddy. Quem lê esses arquivos fora do Compose desfaz as duas coisas.

```bash
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/dev/<NOME> --type SecureString --overwrite --value '<valor>'
```

O perfil importa: `argon-new` é a conta do deploy (382597877834); o `default` aponta para a conta
do DNS. O valor só chega aos containers no deploy seguinte, que é quem regera `env/<env>.env`.

## Infraestrutura como código

Os recursos da conta estão descritos em Terraform em [`aws/`](aws/README.md): instância, IP,
security groups, papéis, ECR, bucket de backup, orçamento, grupos de log, alarmes e os nomes dos
parâmetros. A tabela abaixo continua valendo como resumo, mas a fonte passa a ser o código, e o
que ela lista sem estar lá (DNS na outra conta, a stack do Compose) o README de lá explica.

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

| Recurso            | Id                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instância EC2      | `i-00296133cc8e8093d` (t4g.small, 16 GB, IP elástico 54.94.89.230)                                                                                                                                                                                       |
| Security groups    | `sg-0768581b67b050a67` (web), `sg-003868d936307df4b` (db)                                                                                                                                                                                                |
| Banco              | Neon, projeto `argon` (`summer-resonance-47838945`, `aws-sa-east-1`), branches `main` (prod), `dev` e `lab`. URLs em `/argon/<env>/DATABASE_URL`                                                                                                        |
| Backup             | Bucket S3 `ARGON_BACKUP_BUCKET` em `/opt/argon/.env`, timer `argon-backup`                                                                                                                                                                               |
| ECR                | `argon/web`, `argon/api`                                                                                                                                                                                                                                 |
| Papel do GitHub    | `argon-github-deploy` (OIDC, repositório argon-hq/site)                                                                                                                                                                                                  |
| DNS                | `argonbusiness.com` (e `www`), `dev.`, `lab.`, `api.`, `api.dev.`, `api.lab.`, zona na Cloudflare, sem proxy                                                                                                                                             |
| Segredos no GitHub | `AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID`, `AWS_ALERTS_TOPIC_ARN`                                                                                                                                                                                         |
| Orçamento          | `argon-mensal`, US$ 30, avisos em 80% e 100%                                                                                                                                                                                                             |

Acesso à instância: `aws ssm start-session --target i-00296133cc8e8093d`. Sem SSH.

## Banco

Desde 04/11/2026, cada ambiente usa uma branch do projeto `argon` no Neon (Postgres 16, `aws-sa-east-1`,
plano Free): `main` para prod, `dev` e `lab`. A computação de cada branch desliga sozinha depois de
5 minutos sem consulta, e por isso o healthcheck da API usa `/health/live`, que não toca no banco.

`/argon/<env>/DATABASE_URL` aponta para a URL **direta** da branch, sem o pooler: o pipeline trava a
edição do dia com um advisory lock de sessão (`apps/api/src/pipeline/lock.ts`), e o pooler do Neon
trabalha por transação. As URLs com e sem pooler de cada branch também ficam em
`/argon/neon/{PROD,DEV,LAB}_{DIRECT,POOLED}_URL`.

Até 04/11/2026 os três bancos ficavam num container `postgres` nesta instância. O container foi
removido, mas o volume `argon_db-data` ficou, com os dados da véspera, até a EC2 sair.

### Backup e restauração

O timer `argon-backup` roda `backup-db.sh` às 3h30 (America/Sao_Paulo), antes da geração das 5h30.
Só prod tem backup: o banco dele está no Neon, que no plano Free só restaura até 6 h para trás. O
dump cobre o que isso não cobre — uma migration ou um `DELETE` errado percebido no dia seguinte, e o
projeto no Neon deixar de existir. Dev e lab não têm backup: os dois se refazem a partir de prod ou do
zero.

O script lê a URL do mesmo `/argon/prod/DATABASE_URL` que a API usa, roda o `pg_dump` da imagem do
Postgres 16 (a mesma versão do Neon) e grava o dump no formato custom em
`s3://$ARGON_BACKUP_BUCKET/postgres/argon_prod/<data>.dump` — o prefixo de quando prod era o banco
local. A retenção é regra de ciclo de vida no bucket, não lógica no script.

Um backup que falha avisa: a unit tem `OnFailure=argon-alert@%n.service`, que publica o nome da
unit no tópico SNS de alertas (`ARGON_ALERTS_TOPIC_ARN` em `/opt/argon/.env`). Um backup que nem
roda não tem como avisar, então o script publica a métrica `Argon/BackupOk = 1` ao terminar, e um
alarme no CloudWatch dispara quando ela some por 26 h (comandos em "Configuração manual na AWS").

Para voltar prod a um momento das últimas 6 h, o caminho é o _instant restore_ do Neon (console,
Branches → Restore), que não precisa de dump. Para voltar a um dump, por cima do que existe, com a
URL direta da branch em `URL`:

```bash
aws s3 cp s3://BUCKET/postgres/argon_prod/2026-11-04T06-30-00Z.dump r.dump
docker run --rm -i -e URL pgvector/pgvector:pg16 \
  sh -c 'cat > /tmp/r.dump && pg_restore --clean --if-exists --no-owner --no-privileges -d "$URL" /tmp/r.dump' < r.dump
```

#### Ensaio de restauração

Backup que ninguém restaurou é esperança. No dia 1 de cada mês, às 5h (America/Sao_Paulo), o timer
`argon-restore-drill` roda `restore-drill.sh`: sobe um Postgres 16 descartável, sem rede, restaura
nele o último dump de `argon_prod`, imprime `select count(*) from subscriber` no journal, apaga o
container — a lista de assinantes de prod não fica em lugar nenhum — e publica
`Argon/RestoreDrillOk`. Falha vai para o SNS pela mesma `argon-alert@`.

```bash
systemctl start argon-restore-drill.service && journalctl -u argon-restore-drill -n 5   # rodar agora
```

O restore roda como `postgres`, com `--no-owner` e `--no-privileges`: o dump vem do Neon, que dá
os objetos e as permissões a papéis que não existem no container. Para contar assinantes, basta.

A instância só lê `postgres/argon_prod/` no bucket (`deploy/aws/iam.tf`). Até 04/11/2026 ela não
podia nem listar o bucket, e o ensaio falhava sem nunca ter publicado a métrica.

## Instância

O `compose.yml` limita `api-dev` e `api-lab` a 512 MB e `web-dev` e `web-lab` a 256 MB: uma rodada
live num deles não pode levar a instância a matar o prod. `api-prod` e `web-prod` têm
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

Em Actions → Deploy → Run workflow: ambiente `lab` e o nome da branch a publicar. O compose, o Caddyfile e o deploy.sh vêm da branch em que o workflow roda (normalmente `dev`); o código vem da branch escolhida. Fica em `lab.argonbusiness.com` e `api.lab.argonbusiness.com`.

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
