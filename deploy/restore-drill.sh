#!/usr/bin/env bash
# Restores the latest production dump into argon_lab and counts the subscribers it brought back: a
# backup nobody has restored is a hope, not a backup. The lab is the only target, and it is emptied
# again at the end — it must not keep the production subscriber list. Run by the argon-restore-drill
# timer, monthly. Usage: restore-drill.sh
set -euo pipefail
cd /opt/argon
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
BUCKET="${ARGON_BACKUP_BUCKET:-}"
[ -n "$BUCKET" ] || { echo "restore drill: ARGON_BACKUP_BUCKET is not set" >&2; exit 1; }
REGION=sa-east-1
SOURCE=argon_prod
TARGET=argon_lab

key=$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "postgres/$SOURCE/" --region "$REGION" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' --output text)
[ -n "$key" ] && [ "$key" != None ] || { echo "restore drill: no dump under postgres/$SOURCE/" >&2; exit 1; }

# Start from the empty database provision-db.sh makes: role, database, extension, nothing else.
./reset-lab.sh "$TARGET"
pg() { docker compose exec -T postgres "$@"; }
aws s3 cp "s3://$BUCKET/$key" - --region "$REGION" --only-show-errors | pg sh -c 'cat > /tmp/drill.dump'
# pgvector is not a trusted extension, so the dump's own CREATE EXTENSION would fail as argon_lab;
# the reset already created it as the superuser. Everything else restores as the lab role, over the
# container's socket, so the tables end up owned by it — as a migration would have left them.
pg sh -c "pg_restore -l /tmp/drill.dump | grep -vE ' (EXTENSION|COMMENT - EXTENSION) ' > /tmp/drill.list"
pg pg_restore -U "$TARGET" -d "$TARGET" --no-owner --no-privileges --exit-on-error -L /tmp/drill.list /tmp/drill.dump
count=$(pg psql -v ON_ERROR_STOP=1 -tAX -U postgres -d "$TARGET" -c 'select count(*) from subscriber')
pg rm -f /tmp/drill.dump /tmp/drill.list
echo "restore drill: $key -> $TARGET, $count subscribers"

./reset-lab.sh "$TARGET"
aws cloudwatch put-metric-data --region "$REGION" --namespace Argon --metric-name RestoreDrillOk --value 1
