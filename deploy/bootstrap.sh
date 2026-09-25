#!/usr/bin/env bash
# User data da instância (Amazon Linux 2023, ARM). Instala Docker e o Compose, prepara /opt/argon.
# Idempotent: it runs again on the existing instance to pick up a new timer or setting (deploy/README.md).
set -euo pipefail
# jq: deploy.sh and provision-db.sh quote and unquote env values with it. dnf-automatic applies
# security updates by itself; yum-utils brings `needs-restarting` for the Sunday reboot check.
dnf install -y docker jq dnf-automatic yum-utils
systemctl enable --now docker

# Compose pinned by version and checksum: `releases/latest` installed whatever was current that day,
# unverified. Bump the three values together; the sums are in checksums.txt of the release.
COMPOSE_VERSION=v5.5.1
COMPOSE_SHA256_aarch64=732e3a84c1a0f67256ce80bc2598a24546b10ca05f9faa97efceb1171ece2ef7
COMPOSE_SHA256_x86_64=db1889184726840f75c4f9c001048430d4f25b3be3cb084d3ddd762bc0aed576
ARCH=$(uname -m); [ "$ARCH" = aarch64 ] || ARCH=x86_64
PLUGIN=/usr/local/lib/docker/cli-plugins/docker-compose
mkdir -p "$(dirname "$PLUGIN")"
installed=$("$PLUGIN" version --short 2>/dev/null || true)
if [ "${installed#v}" != "${COMPOSE_VERSION#v}" ]; then
  curl -fsSL "https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-$ARCH" -o "$PLUGIN.tmp"
  sum="COMPOSE_SHA256_$ARCH"
  echo "${!sum}  $PLUGIN.tmp" | sha256sum -c - >/dev/null
  chmod +x "$PLUGIN.tmp" && mv "$PLUGIN.tmp" "$PLUGIN"
fi

mkdir -p /opt/argon/env
chmod 700 /opt/argon/env

# Swap de 2 GB: a t4g.small tem 2 GB de RAM. Guarded step by step, so a second run does not trip
# on the file it made the first time.
if ! [ -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -qx /swapfile || swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Swap is there for a burst, not for everyday paging: drop cache before swapping a container out.
echo 'vm.swappiness = 10' > /etc/sysctl.d/90-argon.conf
sysctl --quiet --system

# Security updates install themselves, daily around 03:00 America/Sao_Paulo (the timer's default,
# 06:00 UTC plus a random hour), before the 05:30 generation. Anything that needs a reboot waits
# for the Sunday timer below.
sed -i 's/^upgrade_type = .*/upgrade_type = security/; s/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic-install.timer

# Both units below drive containers: without docker.service there is nothing to run against.
# argon-alert@ turns any failed unit into a message on the alerts topic (ARGON_ALERTS_TOPIC_ARN in
# /opt/argon/.env); %i is the unit that failed.
cat > /etc/systemd/system/argon-alert@.service <<'UNIT'
[Unit]
Description=Alert the operator that %i failed
[Service]
Type=oneshot
EnvironmentFile=/opt/argon/.env
ExecStart=/bin/sh -c 'aws sns publish --region sa-east-1 --topic-arn "${ARGON_ALERTS_TOPIC_ARN}" --subject "argon: %i failed" --message "Unit %i failed on $(hostname). Details: journalctl -u %i"'
UNIT

# Nightly dump of every database to S3, at 03:30 America/Sao_Paulo — before the 05:30 generation.
# The bucket comes from ARGON_BACKUP_BUCKET in /opt/argon/.env; without it the unit fails loudly
# instead of pretending to back anything up. A systemd timer, because cron is not in the base AMI.
cat > /etc/systemd/system/argon-backup.service <<'UNIT'
[Unit]
Description=Dump the Argon databases to S3
After=docker.service
Requires=docker.service
OnFailure=argon-alert@%n.service
[Service]
Type=oneshot
ExecStart=/opt/argon/backup-db.sh
UNIT
cat > /etc/systemd/system/argon-backup.timer <<'UNIT'
[Unit]
Description=Nightly Argon database backup
[Timer]
OnCalendar=*-*-* 06:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# Monthly proof that the backup restores: the latest prod dump into argon_lab, then a count of
# subscribers, then the lab is emptied again. 05:00 America/Sao_Paulo on the 1st, after the backup.
cat > /etc/systemd/system/argon-restore-drill.service <<'UNIT'
[Unit]
Description=Restore the latest production dump into the lab and count what came back
After=docker.service
Requires=docker.service
OnFailure=argon-alert@%n.service
[Service]
Type=oneshot
ExecStart=/opt/argon/restore-drill.sh
UNIT
cat > /etc/systemd/system/argon-restore-drill.timer <<'UNIT'
[Unit]
Description=Monthly Argon restore drill
[Timer]
OnCalendar=*-*-01 08:00:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# Para o lab depois de uma hora sem requisição. Ajuste com LAB_IDLE_MINUTES em /opt/argon/.env.
cat > /etc/systemd/system/argon-lab-idle.service <<'UNIT'
[Unit]
Description=Stop the Argon lab environment when idle
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/opt/argon/lab-idle-stop.sh
UNIT
cat > /etc/systemd/system/argon-lab-idle.timer <<'UNIT'
[Unit]
Description=Check whether the Argon lab is idle
[Timer]
OnCalendar=*:0/10
Persistent=true
[Install]
WantedBy=timers.target
UNIT

# Sunday 09:00 America/Sao_Paulo: no edition goes out on Sundays, and the 07:00 send is long done.
# `needs-restarting -r` exits 1 only when an installed update wants a reboot; any other code stays up.
cat > /etc/systemd/system/argon-reboot.service <<'UNIT'
[Unit]
Description=Reboot if an installed update needs it
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'dnf -q needs-restarting -r; [ $? -eq 1 ] && systemctl reboot || echo "reboot: not needed"'
UNIT
cat > /etc/systemd/system/argon-reboot.timer <<'UNIT'
[Unit]
Description=Weekly Argon reboot check
[Timer]
OnCalendar=Sun *-*-* 12:00:00 UTC
Persistent=false
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now argon-backup.timer argon-restore-drill.timer argon-lab-idle.timer argon-reboot.timer
