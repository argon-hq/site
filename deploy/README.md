# Deploy

Uma instância EC2 (sa-east-1) com Docker Compose: Caddy na frente, um container do site e um da API por ambiente. Imagens no ECR, segredos no Parameter Store, logs no CloudWatch. Detalhes no documento Stack.

- `bootstrap.sh`: user data da instância.
- `compose.yml`, `Caddyfile`: ficam em `/opt/argon` na instância; o workflow de deploy os envia a cada execução.
- `deploy.sh <prod|dev|lab> <tag> [apps]`: puxa as imagens, regera `env/<env>.env` a partir de `/argon/<env>/*` no Parameter Store e sobe o ambiente.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`.

## Variáveis

Cada parâmetro `/argon/<env>/NOME` vira `NOME=valor` em `env/<env>.env` — **o mesmo arquivo para o
site e para a API** do ambiente. Todo ambiente espera estas oito:

| Variável | Quem lê | Tipo |
| --- | --- | --- |
| `DATABASE_URL` | API | SecureString |
| `ANTHROPIC_API_KEY` | API | SecureString |
| `RESEND_API_KEY` | API | SecureString |
| `INTERNAL_API_SECRET` | site e API | SecureString |
| `API_URL` | site | String |
| `WEB_ORIGIN`, `API_ORIGIN` | API | String |
| `MAIL_TRANSPORT` | API | String |

`API_URL` alcança a API pela rede do compose: `http://api-<env>:3001`. `WEB_ORIGIN` e `API_ORIGIN`
são absolutos e entram nos links de todo e-mail — o site serve a página de descadastro, a API o
endpoint de um clique. `MAIL_TRANSPORT=resend` exige `RESEND_API_KEY`: sem ela a API não sobe.

`NODE_ENV` e `PORT` não entram. Já vêm nas imagens, e como o `env_file` é compartilhado, um `PORT`
no arquivo derrubaria um dos dois containers — o site escuta 3000, a API 3001.

```bash
aws ssm put-parameter --profile argon-new --region sa-east-1 \
  --name /argon/dev/<NOME> --type SecureString --overwrite --value '<valor>'
```

O perfil importa: `argon-new` é a conta do deploy (382597877834); o `default` aponta para a conta
do DNS. O valor só chega aos containers no deploy seguinte, que é quem regera `env/<env>.env`.

## Recursos criados (17/09/2026, conta 382597877834, sa-east-1)

| Recurso | Id |
| --- | --- |
| Instância EC2 | `i-00296133cc8e8093d` (t4g.small, 16 GB, IP elástico 54.94.89.230) |
| Security groups | `sg-0768581b67b050a67` (web), `sg-003868d936307df4b` (db) |
| Papel da instância | `argon-ec2` |
| RDS | `argon` (db.t4g.micro, PostgreSQL 16, privado). Senha master em `/argon/rds/master_password` |
| ECR | `argon/web`, `argon/api` |
| Papel do GitHub | `argon-github-deploy` (OIDC, repositório argon-hq/site) |
| DNS | `argon.eduardofockink.com`, `dev.argon.eduardofockink.com`, `lab.argon.eduardofockink.com`, `api.argon.eduardofockink.com`, `api.dev.argon.eduardofockink.com`, `api.lab.argon.eduardofockink.com` (zona na conta 663702377780, provisória até a ARG-68) |
| Segredos no GitHub | `AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID` |
| Orçamento | `argon-mensal`, US$ 30, avisos em 80% e 100% |

Acesso à instância: `aws ssm start-session --target i-00296133cc8e8093d`. Sem SSH.

## Lab

Ambiente para publicar uma branch em desenvolvimento sem esperar merge. É um só, sobrescrito a cada uso, com banco `argon_lab` no mesmo RDS, separado de dev.

Em Actions → Deploy → Run workflow: ambiente `lab` e o nome da branch a publicar. O compose, o Caddyfile e o deploy.sh vêm da branch em que o workflow roda (normalmente `dev`); o código vem da branch escolhida. Fica em `lab.argon.eduardofockink.com` e `api.lab.argon.eduardofockink.com`.

```bash
gh workflow run deploy.yml --ref dev -f env=lab -f branch=feat/ARG-94-db-schema-prisma
```
