# Low-cost hosting (own domain, about $6 a month)

This puts the POS on your own web address, for example `https://pos.yashmobile.com`, on a small cloud server.
The server is always on, keeps product photos, and backs up every night. One script does the setup.

## What you need

| Item | Where | Approx. cost |
|---|---|---|
| Domain name | Namecheap (a `.com` is cheapest; `.lk` costs more) | about $10–15 a year |
| Server (VPS) | DigitalOcean or Vultr, **Singapore**, Ubuntu 24.04, 1 GB RAM (2 GB if you can) | about $6 a month |
| HTTPS certificate, backups, firewall | included in the script | free |

Prices change, so check them before you buy. Avoid the very cheapest unknown hosts: a POS holds your money records.

## Steps

1. **Buy the server.** Create an Ubuntu 24.04 server ("Droplet" on DigitalOcean) in **Singapore**.
   Choose an SSH key (safer) or a strong root password, then copy the server's **IP address**.
2. **Point the domain at it.** In Namecheap open *Domain List → Manage → Advanced DNS* and add:

   | Type | Host | Value |
   |---|---|---|
   | A Record | `pos` | your server IP |

   This makes `pos.yourdomain.com`. Use Host `@` instead to use the bare domain. Wait 5–30 minutes.
3. **Run the setup.** On Windows open *Terminal* and connect: `ssh root@YOUR_SERVER_IP`, then run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/WarunaJayasundara/YashPos-Sys/main/deploy/setup-vps.sh -o setup.sh
   bash setup.sh pos.yourdomain.com you@email.com
   ```
   It takes about 10 minutes. At the end it prints the **owner password**. Write it down.
4. **Open** `https://pos.yourdomain.com`, sign in as `owner`, change the password in *My account*,
   then add staff in *Staff & permissions* and the shop details in *Settings*.
5. On the shop phone or tablet, open the address in Chrome and choose **Add to Home screen**.

If the GitHub repo is private, the download in step 3 will fail. Make the repo public, or copy the
`deploy` folder to the server and set `REPO` to a URL with a GitHub access token.

## What the script sets up

- Firewall: only SSH, HTTP and HTTPS are open. Fail2ban blocks repeated SSH password guessing.
- Ubuntu security updates install automatically.
- MariaDB with its own random password, stored only in `/opt/yash-pos/server/.env` (readable by the app only).
- The app runs as a background service, starts at boot, and restarts by itself if it stops.
- Caddy gets and renews the HTTPS certificate for free.
- A backup of the database and uploads every night at 11:30 pm, kept 30 days in `/var/backups/yash-pos`.

## Updating to new code

After pushing changes to GitHub:
```bash
ssh root@YOUR_SERVER_IP
bash /opt/yash-pos/deploy/update.sh
```
It backs up first, then installs, builds, updates the tables and restarts.

## Keep a copy of the backups off the server

If the server is lost, backups on it are lost too. Once a week, download the newest files:
```bash
scp root@YOUR_SERVER_IP:/var/backups/yash-pos/*.gz .
```
Or turn on your provider's automatic server backups (DigitalOcean charges about 20% of the server price).

## Useful commands

| Task | Command |
|---|---|
| Is it running? | `systemctl status yash-pos` |
| Recent errors | `journalctl -u yash-pos -n 100` |
| Restart | `systemctl restart yash-pos` |
| Backup now | `BACKUP_DIR=/var/backups/yash-pos sh /opt/yash-pos/scripts/backup.sh` |
| Restore a backup | see [DEPLOYMENT.md](DEPLOYMENT.md#restore) |
