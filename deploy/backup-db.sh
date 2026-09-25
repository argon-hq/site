#!/usr/bin/env bash
# Dumps every database to S3. Takes over from the automated backups RDS used to run; the local
# Postgres has none. Usage: backup-db.sh — the bucket comes from ARGON_BACKUP_BUCKET in
# /opt/argon/.env. Retention is an S3 lifecycle rule on the bucket, not logic here.
set -euo pipefail
cd /opt/argon
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
BUCKET="${ARGON_BACKUP_BUCKET:-}"
[ -n "$BUCKET" ] || { echo "backup: ARGON_BACKUP_BUCKET is not set" >&2; exit 1; }
REGION=sa-east-1
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)

dbs=$(docker compose exec -T postgres psql -tAX -U postgres -c \
  "select datname from pg_database where not datistemplate and datname <> 'postgres'")

# The dump lands on disk first: a failed pg_dump then leaves nothing in S3, instead of a truncated
# object that looks like a backup until the day someone restores it.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
for db in $dbs; do
  # Custom format is already compressed and restores with pg_restore into an empty database.
  docker compose exec -T postgres pg_dump -U postgres --format=custom "$db" > "$tmp/$db.dump"
  aws s3 cp "$tmp/$db.dump" "s3://$BUCKET/postgres/$db/$stamp.dump" --region "$REGION" --only-show-errors
  rm -f "$tmp/$db.dump"
  echo "backup: $db -> s3://$BUCKET/postgres/$db/$stamp.dump"
done
# A backup that ran is a data point; the alarm on this metric is what notices the night it did not
# (deploy/README.md). A failure above never gets here, and the unit's OnFailure raises the alert.
aws cloudwatch put-metric-data --region "$REGION" --namespace Argon --metric-name BackupOk --value 1
