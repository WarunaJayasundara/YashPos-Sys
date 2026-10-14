# Deployment, backup and restore

## Choose where it runs

The owner wants to check the shop from a phone, including away from the shop. That needs the server to be reachable
from the internet over HTTPS. Two common setups:

| Option | Owner's phone works | Notes |
|---|---|---|
| **A. Small cloud VPS** (recommended) | Anywhere | Linux VPS (1 vCPU / 1-2 GB RAM is enough), MySQL on the same VPS, Nginx + free Let's Encrypt certificate. Shop PC just opens the website. |
| B. Shop PC as the server | Only on the shop Wi-Fi, unless you add a tunnel (e.g. Cloudflare Tunnel) | No monthly cost; depends on the shop PC being on. Back up off the PC. |

PWA install and the offline queue need HTTPS (browsers allow `http://localhost` only). On a LAN-only setup over
plain HTTP the app works but cannot be installed and the service worker is disabled.

## Production setup (Linux VPS, option A)

1. Install Node.js 22 LTS, MySQL 8 (or MariaDB 10.6+), Nginx, and Certbot.
2. Create the database and a dedicated user:
   ```sql
   CREATE DATABASE yash_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'pos_user'@'localhost' IDENTIFIED BY 'a-long-random-password';
   GRANT ALL PRIVILEGES ON yash_pos.* TO 'pos_user'@'localhost';
   ```
3. Copy the project to `/opt/yash-pos`, then:
   ```bash
   npm ci
   cp server/.env.example server/.env   # then edit it
   ```
   `server/.env` in production:
   ```
   DATABASE_URL="mysql://pos_user:...@127.0.0.1:3306/yash_pos"
   NODE_ENV=production
   PORT=4000
   COOKIE_SECURE=1
   TRUST_PROXY=1
   SESSION_TTL_HOURS=12
   ```
4. Create tables and the owner account (no demo data):
   ```bash
   npm run db:migrate
   SEED_DEMO=0 SEED_ADMIN_PASSWORD='choose-a-strong-password' npm run db:seed
   ```
   The owner username is `owner`. Sign in, open *My account* and change the password, then create staff accounts in
   *Staff & permissions*. Set the shop address, phone, logo and receipt footer in *Settings*.
5. Build and run:
   ```bash
   npm run build
   npm start -w server
   ```
   Keep it running with systemd (example unit):
   ```ini
   [Unit]
   Description=YASH MOBILE POS
   After=network.target mysql.service
   [Service]
   WorkingDirectory=/opt/yash-pos/server
   ExecStart=/usr/bin/node dist/index.js
   Restart=always
   User=yashpos
   [Install]
   WantedBy=multi-user.target
   ```
6. Nginx in front (HTTPS terminates here):
   ```nginx
   server {
     server_name pos.example.lk;
     client_max_body_size 6m;
     location / { proxy_pass http://127.0.0.1:4000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
   }
   ```
   then `certbot --nginx -d pos.example.lk`. Add HSTS once HTTPS works.

The `uploads/` folder (product images, logo, expense attachments) lives in `server/uploads` and must be backed up.

## Shop PC as server (option B, Windows)

Use XAMPP's MySQL (or MySQL Community Server), then the same steps 2-5 in PowerShell. Keep `COOKIE_SECURE=0`
when using plain `http://`. Run the server at startup with Task Scheduler ("At log on": `node dist\index.js`, start
in `server`). Other devices on the Wi-Fi open `http://<shop-pc-ip>:4000` (allow port 4000 in Windows Firewall).

## Updating

```bash
git pull            # or copy the new release
npm ci
npm run db:migrate  # applies new migrations only
npm run build
# restart the service
```

Always take a backup before updating.

## Backups

Backups contain the database **and** `server/uploads`.

- Windows: `powershell -File scripts\backup.ps1` (defaults: XAMPP path, database `yash_pos`, keeps 30 days). Put the
  MySQL password in the `MYSQL_PWD` environment variable for the scheduled task, never in the script. Schedule daily
  after closing time in Task Scheduler.
- Linux: `scripts/backup.sh` with credentials in `~/.my.cnf` (`[mysqldump] user=… password=…`, file mode 600).
  Cron: `30 23 * * * /opt/yash-pos/scripts/backup.sh`.
- **Copy backups off the machine** (Google Drive / OneDrive folder, external disk, or object storage). A backup on the
  same disk does not survive a disk failure or theft.
- Test a restore every few months.

## Restore

```bash
# 1. stop the POS service
# 2. restore the database (this replaces its contents)
unzip yash_pos-20261014-233000.sql.zip          # Windows backups are .sql.zip, Linux .sql.gz (gunzip)
mysql -u pos_user -p yash_pos < yash_pos-20261014-233000.sql
# 3. restore uploads into server/uploads
# 4. npm run db:migrate   (if the backup is older than the code)
# 5. start the service
```

For a disaster on the shop PC: install Node + MySQL on a new machine, copy the project, create the empty database,
restore as above, then `npm run build` and start.

## Security checklist for production

- HTTPS only (`COOKIE_SECURE=1`), strong unique passwords, one account per staff member (never shared).
- Database user limited to the `yash_pos` database; MySQL not exposed to the internet.
- `.env` readable only by the service user; never commit it.
- Keep Node, MySQL and dependencies patched (`npm audit`); see the note in FEATURES.md about two moderate React
  Router advisories that do not affect this app.
- Review the audit log and the cash-closing differences regularly.
