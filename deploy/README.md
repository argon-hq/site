# Deploy

Uma instância EC2 (sa-east-1) com Docker Compose: Caddy na frente, um container do site por ambiente. Imagens no ECR, segredos no Parameter Store, logs no CloudWatch. Detalhes no documento Stack.

- `bootstrap.sh`: user data da instância.
- `compose.yml`, `Caddyfile`: ficam em `/opt/argon` na instância; o workflow de deploy os envia a cada execução.
- `deploy.sh <prod|dev> <tag>`: puxa a imagem, regera `env/<env>.env` a partir de `/argon/<env>/*` no Parameter Store e sobe o ambiente.

Ambientes: `dev` recebe push da branch `dev`; `prod`, da `main`. Parâmetros: `aws ssm put-parameter --name /argon/dev/NOME --type SecureString --value ...`.

## Recursos criados (17/09/2026, conta 663702377780, sa-east-1)

| Recurso | Id |
| --- | --- |
| Instância EC2 | `i-0e0a6837d272825b5` (t4g.small, 16 GB, IP elástico 18.229.9.175) |
| Security groups | `sg-09eca8d98812d2060` (web), `sg-0aa9f2b7d616826e5` (db) |
| Papel da instância | `argon-ec2` |
| RDS | `argon` (db.t4g.micro, PostgreSQL 16, privado). Senha master em `/argon/rds/master_password` |
| ECR | `argon/web` |
| Papel do GitHub | `argon-github-deploy` (OIDC, repositório argon-hq/site) |
| DNS | `argon.eduardofockink.com`, `dev.argon.eduardofockink.com` (zona /hostedzone/Z04309432CIUSPC9AXQAR) |
| Segredos no GitHub | `AWS_DEPLOY_ROLE_ARN`, `AWS_INSTANCE_ID` |

Acesso à instância: `aws ssm start-session --target i-0e0a6837d272825b5`. Sem SSH.
