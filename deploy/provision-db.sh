#!/usr/bin/env bash
# Ensures the role, database and extension an environment needs exist in the local Postgres.
# Usage: provision-db.sh <prod|dev|lab>
#
# Idempotent, and it runs on every deploy: a fresh volume rebuilds itself on the next deploy.
# DATABASE_URL in Parameter Store stays the single source of truth for the credentials — this
# only mirrors them into the container. An environment whose URL still points at RDS is skipped,
# so prod and dev can migrate one at a time.
set -euo pipefail
ENV_NAME="$1"
cd /opt/argon

url=$(grep -m1 '^DATABASE_URL=' "env/$ENV_NAME.env" | cut -d= -f2-)
[ -n "$url" ] || { echo "provision: no DATABASE_URL for $ENV_NAME" >&2; exit 1; }

# postgresql://user:pass@host:port/dbname?params → the parts, percent-decoded. A literal + stays a
# plus: the +-for-space rule belongs to form encoding, not to the userinfo of a URL, and generated
# passwords are base64. Backslashes are escaped first so printf renders them instead of reading them.
decode() { local s="${1//\\/\\\\}"; printf '%b' "${s//%/\\x}"; }
body="${url#*://}"; body="${body%%\?*}"
creds="${body%%@*}"; location="${body#*@}"
user=$(decode "${creds%%:*}")
pass=$(decode "${creds#*:}")
host="${location%%[:/]*}"
dbname="${location##*/}"

if [ "$host" != "postgres" ]; then
  echo "provision: $ENV_NAME points at $host, not the local Postgres — skipping"
  exit 0
fi

# Doubling is the whole escape: '' inside a literal, "" inside an identifier.
lit() { printf "%s" "${1//\'/\'\'}"; }
ident() { printf "%s" "${1//\"/\"\"}"; }
run() { docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

run -d postgres -c "do \$\$ begin
  if exists (select 1 from pg_roles where rolname = '$(lit "$user")') then
    alter role \"$(ident "$user")\" with login password '$(lit "$pass")';
  else
    create role \"$(ident "$user")\" login password '$(lit "$pass")';
  end if;
end \$\$;" >/dev/null

# create database cannot run inside a transaction, so it is guarded instead of being made idempotent.
if [ "$(run -tAX -d postgres -c "select 1 from pg_database where datname = '$(lit "$dbname")'")" != "1" ]; then
  run -d postgres -c "create database \"$(ident "$dbname")\" owner \"$(ident "$user")\"" >/dev/null
fi

# pgvector matches what the RDS instance had enabled; Mastra creates its own schema on first use.
run -d "$dbname" -c 'create extension if not exists vector' >/dev/null
echo "provision: $ENV_NAME ready ($user@$dbname)"
