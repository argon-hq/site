# Deploy

Uma instância EC2 (sa-east-1) com Docker Compose: Caddy na frente, um container do site e um da API por ambiente. Imagens no ECR, segredos no Parameter Store, logs no CloudWatch. Detalhes no documento Stack.

- `bootstrap.sh`: user data da instância.
- `compose.yml`, `Caddyfile`: ficam em `/opt/argon` na instância; o workflow de deploy os envia a cada execução.
- `deploy.sh <prod|dev|lab> <tag> [apps]`: puxa as imagens, regera `env/<env>.env` a partir de `/argon/<env>/*` no Parameter Store e sobe o ambiente.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`. Parâmetros: `aws ssm put-parameter --name /argon/dev/NOME --type SecureString --value ...`. A API espera `DATABASE_URL`, `ANTHROPIC_API_KEY` e `INTERNAL_API_SECRET`.

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
