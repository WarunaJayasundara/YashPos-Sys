#!/usr/bin/env bash
# One-command install of YASH MOBILE POS on a fresh Ubuntu 22.04/24.04 server.
# Usage (as root):  bash setup-vps.sh pos.yourshop.com you@email.com
# Safe to run again: it keeps the existing database password, owner account and data.
set -euo pipefail

DOMAIN="${1:?Usage: bash setup-vps.sh pos.yourshop.com you@email.com}"
EMAIL="${2:-}"
REPO="${REPO:-https://github.com/WarunaJayasundara/YashPos-Sys.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/yash-pos
ENV_FILE="$APP/server/.env"
RUN_USER=yashpos

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo -i first)."; exit 1; }
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
export DEBIAN_FRONTEND=noninteractive

step "System updates, firewall and automatic security updates"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ufw fail2ban unattended-upgrades gnupg debian-keyring debian-archive-keyring apt-transport-https openssl
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone Asia/Colombo || true
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443
ufw --force enable
systemctl enable --now fail2ban

step "Swap file (lets a 1 GB server build the app)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

step "Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

step "MariaDB database"
apt-get install -y mariadb-server
systemctl enable --now mariadb

step "Caddy web server (free automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

step "App user and code"
id "$RUN_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$RUN_USER"
if [ -d "$APP/.git" ]; then
  sudo -u "$RUN_USER" git -C "$APP" pull --ff-only
else
  mkdir -p "$APP" && chown "$RUN_USER:$RUN_USER" "$APP"
  sudo -u "$RUN_USER" git clone --branch "$BRANCH" "$REPO" "$APP"
fi

step "Settings file (server/.env)"
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 24)"
  mysql -e "CREATE DATABASE IF NOT EXISTS yash_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
            CREATE USER IF NOT EXISTS 'pos_user'@'localhost' IDENTIFIED BY '$DB_PASS';
            ALTER USER 'pos_user'@'localhost' IDENTIFIED BY '$DB_PASS';
            GRANT ALL PRIVILEGES ON yash_pos.* TO 'pos_user'@'localhost'; FLUSH PRIVILEGES;"
  cat > "$ENV_FILE" <<EOF
DATABASE_URL="mysql://pos_user:$DB_PASS@127.0.0.1:3306/yash_pos"
PORT=4000
NODE_ENV=production
COOKIE_SECURE=1
TRUST_PROXY=1
SESSION_TTL_HOURS=12
EOF
fi
chown "$RUN_USER:$RUN_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

step "Install, build and create tables"
cd "$APP"
sudo -u "$RUN_USER" -H npm ci --include=dev --no-audit --no-fund
sudo -u "$RUN_USER" -H npm run build
sudo -u "$RUN_USER" -H npm run db:migrate
ADMIN_PASS=""
if [ "$(mysql -N -B yash_pos -e "SELECT COUNT(*) FROM users WHERE username='owner'")" = "0" ]; then
  ADMIN_PASS="${ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=')A9!}"
fi
# the seed never changes an existing owner password; without one it only refreshes roles and permissions
sudo -u "$RUN_USER" -H env SEED_DEMO=0 NODE_ENV=production SEED_ADMIN_PASSWORD="${ADMIN_PASS:-unchanged-Existing1!}" npm run db:seed

step "Background service"
cat > /etc/systemd/system/yash-pos.service <<EOF
[Unit]
Description=YASH MOBILE POS
After=network.target mariadb.service
Wants=mariadb.service

[Service]
User=$RUN_USER
WorkingDirectory=$APP/server
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable yash-pos
systemctl restart yash-pos

step "HTTPS for $DOMAIN"
{
  [ -n "$EMAIL" ] && printf '{\n\temail %s\n}\n\n' "$EMAIL"
  cat <<EOF
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size 6MB
	}
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:4000
}
EOF
} > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

step "Nightly backup at 11:30 pm (kept 30 days in /var/backups/yash-pos)"
cat > /etc/cron.d/yash-pos-backup <<EOF
30 23 * * * root BACKUP_DIR=/var/backups/yash-pos DB_NAME=yash_pos sh $APP/scripts/backup.sh >> /var/log/yash-pos-backup.log 2>&1
EOF

step "Checking the app"
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:4000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/api/health && echo

printf '\n\033[1;32mDone.\033[0m Open https://%s (HTTPS can take a minute the first time).\n' "$DOMAIN"
if [ -n "$ADMIN_PASS" ]; then
  printf 'Sign in as:  owner\nPassword:    %s\nWrite it down now and change it in "My account" after signing in.\n' "$ADMIN_PASS"
fi
echo "Update later with:  bash $APP/deploy/update.sh"
