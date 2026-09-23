#!/usr/bin/env bash
# User data da instância (Amazon Linux 2023, ARM). Instala Docker e o Compose, prepara /opt/argon.
set -euo pipefail
dnf install -y docker
systemctl enable --now docker
mkdir -p /usr/local/lib/docker/cli-plugins
ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && ARCH=aarch64 || ARCH=x86_64
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
mkdir -p /opt/argon/env
# Swap de 2 GB: a t4g.small tem 2 GB de RAM.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Nightly dump of every database to S3, at 03:30 America/Sao_Paulo — before the 05:30 generation.
# The bucket comes from ARGON_BACKUP_BUCKET in /opt/argon/.env; without it the unit fails loudly
# instead of pretending to back anything up. A systemd timer, because cron is not in the base AMI.
cat > /etc/systemd/system/argon-backup.service <<'UNIT'
[Unit]
Description=Dump the Argon databases to S3
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
systemctl daemon-reload
systemctl enable --now argon-backup.timer

# Para o lab depois de uma hora sem requisição. Ajuste com LAB_IDLE_MINUTES em /opt/argon/.env.
cat > /etc/systemd/system/argon-lab-idle.service <<'UNIT'
[Unit]
Description=Stop the Argon lab environment when idle
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
systemctl daemon-reload
systemctl enable --now argon-lab-idle.timer
