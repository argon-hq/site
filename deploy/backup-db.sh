#!/usr/bin/env bash
# Dumps the production database to S3. Usage: backup-db.sh — the bucket comes from
# ARGON_BACKUP_BUCKET in /opt/argon/.env. Retention is an S3 lifecycle rule on the bucket, not logic
# here.
#
# Production lives on Neon, whose own restore only reaches 6 hours back on the Free plan. This dump
# covers what that does not: a bad migration or a wrong delete noticed the next day, and the Neon
# project itself going away. Dev and lab are not dumped: either can be rebuilt from production or
# from nothing.
set -euo pipefail
cd /opt/argon
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
BUCKET="${ARGON_BACKUP_BUCKET:-}"
[ -n "$BUCKET" ] || { echo "backup: ARGON_BACKUP_BUCKET is not set" >&2; exit 1; }
REGION=sa-east-1
# The dumps keep the prefix they had when production was the local argon_prod: the drill and the
# lifecycle rule look there.
DB=argon_prod
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)

# The same parameter the API reads, so the backup follows production wherever its database is.
# It reaches pg_dump through the environment, never the command line, which `ps` would show.
URL=$(aws ssm get-parameter --region "$REGION" --name /argon/prod/DATABASE_URL --with-decryption \
  --query Parameter.Value --output text)
export URL

# The dump lands on disk first: a failed pg_dump then leaves nothing in S3, instead of a truncated
# object that looks like a backup until the day someone restores it.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# pg_dump comes from the image Postgres runs on, so its major matches the server's (16). Custom
# format is already compressed and restores with pg_restore into an empty database.
docker run --rm -e URL pgvector/pgvector:pg16 sh -c 'pg_dump --format=custom "$URL"' > "$tmp/$DB.dump"
aws s3 cp "$tmp/$DB.dump" "s3://$BUCKET/postgres/$DB/$stamp.dump" --region "$REGION" --only-show-errors
echo "backup: production -> s3://$BUCKET/postgres/$DB/$stamp.dump ($(du -h "$tmp/$DB.dump" | cut -f1))"
# A backup that ran is a data point; the alarm on this metric is what notices the night it did not
# (deploy/README.md). A failure above never gets here, and the unit's OnFailure raises the alert.
aws cloudwatch put-metric-data --region "$REGION" --namespace Argon --metric-name BackupOk --value 1
