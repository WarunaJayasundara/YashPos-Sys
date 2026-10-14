# Free hosting

There are three realistic ways to run YASH MOBILE POS online for free. All three let the owner open it from a phone
anywhere. Free plans change often: the limits below were checked in October 2026 from public sources, so confirm
them on each provider's site before you rely on them.

| | A. Render + Aiven (recommended to start) | B. Oracle Cloud Always Free VM | C. Shop PC + Cloudflare Tunnel |
|---|---|---|---|
| Difficulty | Easy, no server administration | Hard (Linux server) | Medium |
| Card needed | No | Yes (identity check) | No |
| Always on | No: sleeps after 15 min idle, first open takes ~1 min | Yes | Only while the shop PC is on |
| Product images / logo uploads | Lost on every restart or redeploy | Kept | Kept |
| Good for | Trying it, light daily use | Real daily use | Shop that already leaves a PC on |

## Option A: Render (app) + Aiven (MySQL), no card

**Limits to know** ([Render free tier](https://render.com/docs/free), [Aiven free MySQL](https://aiven.io/free-mysql-database)):
- Render free web service: spins down after 15 minutes without traffic and takes about a minute to wake on the next
  visit; 750 free instance hours per month (enough for one service running all month); files written to disk are
  lost on restart, so uploaded product photos, the logo and expense attachments do not survive. Sales, stock and every
  other record are in the database and are safe.
- Aiven free MySQL: 1 CPU, 1 GB RAM, 1 GB storage, single node, daily backups, no expiry, powers off after a period of
  inactivity (you get an email first). 1 GB holds many years of sales for one shop.

### 1. Put the code on GitHub
Already done: `https://github.com/WarunaJayasundara/YashPos-Sys`.

### 2. Create the database on Aiven
1. Sign up at aiven.io (free, no card) and create a **MySQL** service on the **Free** plan.
2. When it is running, open the service's **Overview** and copy the **Service URI**. It looks like
   `mysql://avnadmin:PASSWORD@mysql-xxxx.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED`.
3. Convert it for Prisma: keep everything up to `defaultdb`, replace the query string with
   `?sslaccept=accept_invalid_certs`:
   ```
   mysql://avnadmin:PASSWORD@mysql-xxxx.aivencloud.com:12345/defaultdb?sslaccept=accept_invalid_certs
   ```
   The connection is still encrypted. (`accept_invalid_certs` skips checking Aiven's own certificate authority. To
   check it too, download the CA certificate from Aiven and use `?sslcert=ca.pem&sslaccept=strict` with the file
   placed in `server/prisma/`.)
4. If the password contains characters like `@`, `/` or `#`, URL-encode them (`@` becomes `%40`).

### 3. Create the app on Render
1. Sign up at render.com with your GitHub account.
2. **New > Blueprint**, pick the `YashPos-Sys` repository. Render reads [`render.yaml`](../render.yaml) and creates a
   free web service called `yash-pos`.
3. It asks for two secret values:
   - `DATABASE_URL`: the Prisma URL from step 2.3.
   - `SEED_ADMIN_PASSWORD`: the password for the `owner` account (long, unique; you can change it later in the app).
4. Click **Apply**. The first build installs, compiles, creates the tables and the owner account (about 3-6 minutes).
   No demo data is created (`SEED_DEMO=0`).
5. Open the address Render gives you (for example `https://yash-pos.onrender.com`), sign in as `owner` with the
   password from step 3.3, then: *Settings* (shop address, phone, receipt footer), *Staff & permissions* (cashier
   accounts), and add products.

On the owner's phone, open the same address in Chrome and choose **Add to Home screen** to install it like an app.

Every later `git push` to `main` redeploys automatically. Migrations run during the build, and the seed step only
creates the owner and roles if they are missing (it never changes an existing password or data).

### Optional: avoid the wake-up delay
A free uptime monitor (for example UptimeRobot or cron-job.org) that requests `https://<your-app>/api/health` every
10 minutes keeps the service awake. One always-on service uses about 744 of the 750 free hours a month. Uploaded
images are still lost on redeploy. Moving the same service to Render's paid "Starter" instance removes both limits.

### Backups on this setup
Aiven takes daily backups of the free service. For your own copy, run from any PC with the MySQL client:
```
mysqldump --ssl-mode=REQUIRED -h mysql-xxxx.aivencloud.com -P 12345 -u avnadmin -p --single-transaction defaultdb > yash-backup.sql
```

## Option B: Oracle Cloud Always Free VM (always on)

Oracle's Always Free tier includes an Arm (Ampere A1) virtual machine. As of mid-2026 the allowance was reduced to
2 OCPUs and 12 GB RAM in total ([report](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)), still
far more than this app needs. Caveats: a card is needed to verify your identity; free A1 capacity in your home region
is not guaranteed; Oracle may reclaim instances it considers idle (very low CPU, network and memory use over 7 days),
which a quiet shop server can hit.

Steps: create an Ubuntu VM, open ports 80/443 in the VCN security list, then follow
[DEPLOYMENT.md](DEPLOYMENT.md) "Production setup (Linux VPS)" exactly (MySQL on the same VM, Nginx, Let's Encrypt).
For a free hostname, use a free dynamic DNS name (for example DuckDNS) pointing at the VM's public IP, and request the
certificate for that name. Set up `scripts/backup.sh` and copy the backups off the VM.

## Option C: Shop PC + Cloudflare Tunnel

Run the app on the shop PC as described in DEPLOYMENT.md "Shop PC as server", then install Cloudflare's free
`cloudflared` tunnel to publish it over HTTPS without opening router ports. A permanent address needs a domain added
to a free Cloudflare account (a domain itself costs a few dollars a year); the no-domain "quick tunnel" gets a random
address that changes on every restart, so it is only for testing. The owner can then reach the shop PC from a phone
anywhere, but only while the PC and its internet are on. Back up to a cloud folder (OneDrive or Google Drive).

## Which one?

Start with **A**: it is free, needs no card and takes about 15 minutes. If the one-minute wake-up or losing uploaded
product photos becomes annoying, move the same Render service to a paid instance, or move to **B** for a free always-on
server if you are comfortable running Linux.
