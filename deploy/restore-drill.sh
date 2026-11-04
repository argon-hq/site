#!/usr/bin/env bash
# Restores the latest production dump into a throwaway Postgres and counts the subscribers it
# brought back: a backup nobody has restored is a hope, not a backup. The server is a container that
# lives only for the drill, on no network, so the production subscriber list never lands anywhere
# that outlives it. Run by the argon-restore-drill timer, monthly. Usage: restore-drill.sh
set -euo pipefail
cd /opt/argon
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
BUCKET="${ARGON_BACKUP_BUCKET:-}"
[ -n "$BUCKET" ] || { echo "restore drill: ARGON_BACKUP_BUCKET is not set" >&2; exit 1; }
REGION=sa-east-1
SOURCE=argon_prod
NAME=argon-restore-drill

key=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "postgres/$SOURCE/" --region "$REGION" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)
[ -n "$key" ] && [ "$key" != None ] || { echo "restore drill: no dump under postgres/$SOURCE/" >&2; exit 1; }

# Same image as production's Postgres major. A leftover from a drill that died is removed first.
docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD=drill pgvector/pgvector:pg16 >/dev/null
pg() { docker exec -i "$NAME" "$@"; }
for _ in $(seq 30); do pg pg_isready -U postgres -q && break; sleep 1; done
pg createdb -U postgres drill

aws s3 cp "s3://$BUCKET/$key" - --region "$REGION" --only-show-errors | pg sh -c 'cat > /tmp/drill.dump'
# The dump comes from Neon, which owns objects with its own roles and grants to them: those roles do
# not exist here. --no-owner and --no-privileges restore everything as postgres, which is all a count
# needs. Extensions are created by the restore, as the superuser.
pg pg_restore -U postgres -d drill --no-owner --no-privileges --exit-on-error /tmp/drill.dump
count=$(pg psql -v ON_ERROR_STOP=1 -tAX -U postgres -d drill -c 'select count(*) from subscriber')
echo "restore drill: $key -> throwaway Postgres, $count subscribers"

aws cloudwatch put-metric-data --region "$REGION" --namespace Argon --metric-name RestoreDrillOk --value 1
