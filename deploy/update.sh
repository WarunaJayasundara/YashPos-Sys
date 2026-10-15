#!/usr/bin/env bash
# Updates the server to the latest code on GitHub. Usage (as root): bash /opt/yash-pos/deploy/update.sh
set -euo pipefail
APP=/opt/yash-pos
RUN_USER=yashpos
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i first)."; exit 1; }
cd "$APP"
echo "==> Backup before updating"
BACKUP_DIR=/var/backups/yash-pos DB_NAME=yash_pos sh "$APP/scripts/backup.sh"
echo "==> Getting the latest code"
sudo -u "$RUN_USER" git pull --ff-only
sudo -u "$RUN_USER" -H npm ci --include=dev --no-audit --no-fund
sudo -u "$RUN_USER" -H npm run build
sudo -u "$RUN_USER" -H npm run db:migrate
systemctl restart yash-pos
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/api/health && echo && echo "Updated."
