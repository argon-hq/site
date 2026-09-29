#!/usr/bin/env bash
# Stops the lab environment after a stretch with no request. Lab is scratch — one environment at a
# time, overwritten on every use — so it has no reason to hold memory on a 2 GB instance overnight.
# A deploy brings it back. Usage: lab-idle-stop.sh [idle_minutes] (default 60, or LAB_IDLE_MINUTES).
set -euo pipefail
cd /opt/argon
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
IDLE_MIN="${1:-${LAB_IDLE_MINUTES:-60}}"
LOG=logs/lab.log

running=$(docker compose ps --status running --format '{{.Service}}' | grep -cE '^(web|api)-lab$' || true)
[ "$running" -gt 0 ] || exit 0

# Caddy appends to the log on every request to a lab host, so its timestamp is the last sign of
# life. The deploy touches the file, which gives a freshly published lab a full idle window before
# it can be stopped. A missing file means not even the deploy ran: nothing to protect.
if [ -f "$LOG" ]; then
  idle=$(( ($(date +%s) - $(stat -c %Y "$LOG")) / 60 ))
  [ "$idle" -ge "$IDLE_MIN" ] || exit 0
else
  idle="$IDLE_MIN+"
fi

docker compose stop web-lab api-lab
echo "lab: stopped after ${idle} min without a request"
