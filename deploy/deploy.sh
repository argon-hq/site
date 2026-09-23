#!/usr/bin/env bash
# Roda na instância, via SSM Run Command. Uso: deploy.sh <prod|dev|lab> <tag> [apps]
# Atualiza a tag do ambiente, regera o env a partir do Parameter Store e sobe só os serviços do ambiente.
# apps: quais imagens foram construídas, "web" ou "web api" (padrão: web).
set -euo pipefail
ENV_NAME="$1"; TAG="$2"; APPS="${3:-web}"
cd /opt/argon
mkdir -p env
touch .env
grep -q '^ECR=' .env || echo "ECR=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.sa-east-1.amazonaws.com" >> .env
for k in PROD_TAG DEV_TAG LAB_TAG; do grep -q "^$k=" .env || echo "$k=" >> .env; done
KEY="$(echo "$ENV_NAME" | tr a-z A-Z)_TAG"
grep -q "^$KEY=" .env && sed -i "s|^$KEY=.*|$KEY=$TAG|" .env || echo "$KEY=$TAG" >> .env
# Parâmetros /argon/<env>/NOME viram NOME=valor no env do ambiente.
params_to_env() {
  aws ssm get-parameters-by-path --path "$1" --with-decryption --region sa-east-1 \
    --query 'Parameters[].[Name,Value]' --output text | awk -F'\t' '{sub(".*/","",$1); print $1"="$2}' > "$2"
}
params_to_env "/argon/$ENV_NAME/" "env/$ENV_NAME.env"
# Quem publica sabe onde está publicando: a API lê isto para saber quanto uma rodada pode custar
# (apps/api/src/pipeline/profile.ts). Escrito aqui, e não no Parameter Store, para não poder discordar.
echo "ARGON_ENV=$ENV_NAME" >> "env/$ENV_NAME.env"
# The Postgres container reads its superuser password the same way. It is only consumed by initdb,
# on the first boot of an empty volume: changing the parameter later does not change the password.
params_to_env "/argon/postgres/" "env/postgres.env"
grep -q '^POSTGRES_PASSWORD=' env/postgres.env || { echo "deploy: /argon/postgres/POSTGRES_PASSWORD is missing" >&2; exit 1; }
aws ecr get-login-password --region sa-east-1 | docker login --username AWS --password-stdin "$(grep '^ECR=' .env | cut -d= -f2)"
SERVICES=""; for a in $APPS; do SERVICES="$SERVICES $a-$ENV_NAME"; done
docker compose pull $SERVICES
# The database comes up before anything that talks to it, and the role and schema of this
# environment are reconciled while it is the only thing running.
docker compose up -d --wait postgres
./provision-db.sh "$ENV_NAME"
# Migrations rodam a partir da imagem nova da API, antes de ela subir, quando a imagem traz o Prisma.
case " $APPS " in *" api "*)
  docker compose run --rm --no-deps "api-$ENV_NAME" sh -c 'if [ -f prisma.config.ts ]; then exec ./node_modules/.bin/prisma migrate deploy; else echo "no migrations in this image"; fi' ;;
esac
docker compose up -d caddy $SERVICES
# The Caddyfile is a bind mount: a changed file needs an explicit reload, or new hosts never get certificates.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
# Retenção de 30 dias nos logs do ambiente; o grupo é criado pelo driver awslogs no primeiro start.
sleep 5; for g in $(for a in $APPS; do echo "/argon/$ENV_NAME/$a"; done) /argon/postgres; do
  aws logs put-retention-policy --region sa-east-1 --log-group-name "$g" --retention-in-days 30 || true
done
docker image prune -f >/dev/null
echo "deploy $ENV_NAME $TAG ok"
