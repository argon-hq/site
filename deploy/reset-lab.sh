#!/usr/bin/env bash
# Drops and recreates a scratch database — the lab, or dev — leaving it empty, with its role and
# extension, exactly as provision-db.sh makes it. Production is refused by name; there is no flag
# for it. Usage: reset-lab.sh [argon_lab|argon_dev]   (default: argon_lab)
set -euo pipefail
DB="${1:-argon_lab}"
case "$DB" in argon_lab|argon_dev) ;; *) echo "reset: refusing to drop '$DB' — only argon_lab or argon_dev" >&2; exit 1 ;; esac
ENV_NAME="${DB#argon_}"
cd /opt/argon

# The environment's containers hold connections, and a database with sessions cannot be dropped.
# They stay down: the schema is gone, and the next deploy migrates and starts them again.
docker compose stop "web-$ENV_NAME" "api-$ENV_NAME"
run() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
run -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
run -c "drop database if exists \"$DB\"" >/dev/null
./provision-db.sh "$ENV_NAME"
echo "reset: $DB is empty; the next deploy of $ENV_NAME migrates and starts it"
