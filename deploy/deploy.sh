#!/usr/bin/env bash
# Roda na instância, via SSM Run Command. Uso: deploy.sh <prod|dev|lab> <tag> [apps]
# Regera os envs a partir do Parameter Store, sobe só os serviços do ambiente e, se tudo subiu, grava a tag.
# apps: quais imagens mudaram, "web", "api", "web api" ou "" (padrão sem o argumento: web). O workflow
# marca as duas imagens com a tag mesmo quando só uma foi construída, então "" só troca a tag e o Caddy.
set -euo pipefail
# Everything written here holds secrets; nothing on the instance but root and the daemon reads it.
umask 077
ENV_NAME="$1"; TAG="$2"; APPS="${3-web}"
case "$ENV_NAME" in prod|dev|lab) ;; *) echo "deploy: unknown environment '$ENV_NAME' (prod|dev|lab)" >&2; exit 1 ;; esac
command -v jq >/dev/null || { echo "deploy: jq is missing (bootstrap.sh installs it)" >&2; exit 1; }
cd /opt/argon
# Prod and dev deploy from different concurrency groups, so two of them can land at once — and both
# rewrite .env, restart Caddy and prune images. The lock serializes them; the second one waits.
exec 9>.deploy.lock
flock -n 9 || { echo "deploy: another deploy is running, waiting for it"; flock 9; }
# logs/ is bind-mounted into Caddy; lab.log is how lab-idle-stop.sh knows the lab is still in use.
mkdir -p env logs
chmod 700 env
touch .env
grep -q '^ECR=' .env || echo "ECR=$(aws sts get-caller-identity --query Account --output text).dkr.ecr.sa-east-1.amazonaws.com" >> .env
for k in PROD_TAG DEV_TAG LAB_TAG; do grep -q "^$k=" .env || echo "$k=" >> .env; done
# .env keeps the tag that is running. The new one is exported for this run only — the shell wins over
# .env in Compose — and is persisted at the end, once every container is up. A deploy that dies
# halfway leaves .env pointing at the image that still works, which is what a rollback wants.
KEY="$(echo "$ENV_NAME" | tr a-z A-Z)_TAG"
export "$KEY=$TAG"
# Parâmetros /argon/<env>/NOME viram NOME="valor" no env do ambiente, com o valor entre aspas no
# formato JSON: Compose lê "\n", "\"" e "\\" dentro de aspas duplas, então um valor com #, tab ou
# aspas chega inteiro. Ele também expande `$nome` dentro do arquivo, e `$$` é o único jeito de
# manter um $ literal (uma senha, um hash bcrypt). provision-db.sh desfaz os dois ao ler.
params_to_env() {
  aws ssm get-parameters-by-path --path "$1" --with-decryption --region sa-east-1 --output json \
    | jq -r '.Parameters[] | "\(.Name | sub(".*/"; ""))=\(.Value | @json | gsub("\\$"; "$$"))"' > "$2"
}
params_to_env "/argon/$ENV_NAME/" "env/$ENV_NAME.env"
# Quem publica sabe onde está publicando: a API lê isto para saber quanto uma rodada pode custar
# (apps/api/src/pipeline/profile.ts). Escrito aqui, e não no Parameter Store, para não poder discordar.
echo "ARGON_ENV=$ENV_NAME" >> "env/$ENV_NAME.env"
# The site only needs to find the API: the model and mail keys never enter its container.
grep -E '^(API_URL|INTERNAL_API_SECRET|ARGON_ENV)=' "env/$ENV_NAME.env" > "env/$ENV_NAME.web.env"
# The Postgres container reads its superuser password the same way. It is only consumed by initdb,
# on the first boot of an empty volume: changing the parameter later does not change the password.
params_to_env "/argon/postgres/" "env/postgres.env"
grep -q '^POSTGRES_PASSWORD=' env/postgres.env || { echo "deploy: /argon/postgres/POSTGRES_PASSWORD is missing" >&2; exit 1; }
# Caddy's basic_auth for the Studio and the non-production API hosts, and the operator session
# cookie. All three are required: Caddy refuses to load a basic_auth with an empty hash, which would
# take every site down with it.
params_to_env "/argon/caddy/" "env/caddy.env"
for k in STUDIO_AUTH_USER STUDIO_AUTH_HASH OPERATOR_SESSION; do
  grep -qE "^$k=\".+\"$" env/caddy.env || { echo "deploy: /argon/caddy/$k is missing (see deploy/README.md, Acesso do operador)" >&2; exit 1; }
done
# Caddy adds each environment's internal secret to the Studio's calls under /mastra once the
# operator is logged in, so it needs the secret of dev and of lab, whichever environment is deploying.
for e in dev lab; do
  params_to_env "/argon/$e/" "env/.caddy-$e.tmp"
  grep '^INTERNAL_API_SECRET=' "env/.caddy-$e.tmp" | sed "s/^/$(echo "$e" | tr a-z A-Z)_/" >> env/caddy.env
  rm -f "env/.caddy-$e.tmp"
done
# `>` keeps the mode of a file that already exists: files from before the umask stay readable otherwise.
chmod 600 env/*.env
aws ecr get-login-password --region sa-east-1 | docker login --username AWS --password-stdin "$(grep '^ECR=' .env | cut -d= -f2)"
SERVICES=""; for a in $APPS; do SERVICES="$SERVICES $a-$ENV_NAME"; done
# No service list would mean every service, other environments' images included.
[ -z "$SERVICES" ] || docker compose pull $SERVICES
# The database comes up before anything that talks to it, and the role and schema of this
# environment are reconciled while it is the only thing running.
docker compose up -d --wait postgres
./provision-db.sh "$ENV_NAME"
# Migrations rodam a partir da imagem nova da API, antes de ela subir, quando a imagem traz o Prisma.
case " $APPS " in *" api "*)
  docker compose run --rm --no-deps "api-$ENV_NAME" sh -c 'if [ -f prisma.config.ts ]; then exec ./node_modules/.bin/prisma migrate deploy; else echo "no migrations in this image"; fi' ;;
esac
# A fresh lab deploy is activity: this gives it a full idle window before it can be stopped.
if [ "$ENV_NAME" = lab ]; then touch logs/lab.log; fi
# --wait turns a container in a crash loop into a failed deploy instead of an "ok" with a dead API.
# Caddy has no healthcheck, so for it this only means running; the timeout covers a cold API boot.
docker compose up -d --wait --wait-timeout 180 caddy $SERVICES
# The Caddyfile is a bind mount: a changed file needs an explicit reload, or new hosts never get certificates.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile
# Only now is this tag the one that is running. The one it replaces stays on disk (see the image
# cleanup below) so a rollback to it does not wait for a pull.
PREV_TAG="$(grep "^$KEY=" .env | cut -d= -f2)"
sed -i "s|^$KEY=.*|$KEY=$TAG|" .env
# Retenção de 30 dias nos logs do ambiente; o grupo é criado pelo driver awslogs no primeiro start.
sleep 5; for g in $(for a in $APPS; do echo "/argon/$ENV_NAME/$a"; done) /argon/postgres /argon/caddy; do
  aws logs put-retention-policy --region sa-east-1 --log-group-name "$g" --retention-in-days 30 || true
done
# Image retention is a set, not a time window. Every deploy tags an image with its commit, and the
# old ones once stayed forever and filled the 16 GB disk (43 images, 10 GB, "no space left on
# device"); pruning what was older than 24 h replaced that with a slower version of the same
# failure — ten deploys in a day park 7 GB of api images before any of them ages out. What stays:
# the tag each environment runs (.env, so an idle-stopped lab keeps its own) and the tag this
# environment ran before, for a rollback that does not wait on a pull. Only our ECR images are
# touched; caddy and postgres are never candidates.
keep=" $PREV_TAG $(grep -E '^(PROD|DEV|LAB)_TAG=' .env | cut -d= -f2 | tr '\n' ' ') "
docker images --format '{{.Repository}}:{{.Tag}}' --filter 'reference=*/argon/*' | while read -r image; do
  case "$keep" in *" ${image##*:} "*) ;; *) docker rmi "$image" >/dev/null 2>&1 || true ;; esac
done
docker image prune -f >/dev/null
echo "deploy $ENV_NAME $TAG ok"
