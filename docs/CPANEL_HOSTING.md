# Hosting on cPanel shared hosting (Serverbyt, Namecheap Stellar and similar)

This runs the POS on a cheap shared-hosting plan with your Namecheap domain. You only click in cPanel: no server
commands. The app creates its own tables and owner account the first time it starts.

**Check first:** in cPanel, under *Software*, there must be **Setup Node.js App** (sometimes "Node.js Selector").
If it isn't there, ask the host's support "Can you enable Setup Node.js App (Node 20 or 22) on my account?".
Without it this hosting cannot run the POS; use [CHEAP_HOSTING.md](CHEAP_HOSTING.md) (a $6 VPS) instead.

## What you need

- The upload file **`yash-pos-cpanel.zip`**. Make it on your PC in the project folder:
  ```bash
  npm run package:cpanel
  ```
  It is written to `release/yash-pos-cpanel.zip` (under 1 MB).
- Your cPanel login and your Namecheap login.

## Step 1: Connect the domain (Namecheap → your host)

1. Your host's welcome email lists two **nameservers** (for example `ns1.host.com`, `ns2.host.com`).
2. Namecheap → **Domain List → Manage → Nameservers** → choose **Custom DNS**, enter both, click ✓.
3. If the domain is not the main domain of your hosting account, add it in cPanel → **Domains → Create a New Domain**.
4. In cPanel → **Domains**, create the subdomain **`pos.yourdomain.com`** (uncheck "share document root").

DNS changes can take from a few minutes to a few hours.

## Step 2: Create the database

cPanel → **MySQL® Databases**:

1. **Create New Database**: `yashpos` → cPanel names it like `cpuser_yashpos`.
2. **Add New User**: `posuser` → becomes `cpuser_posuser`. Use a long password made of **letters and numbers only**
   (symbols such as `@ : / #` break the connection address). Save it.
3. **Add User To Database**: choose both, tick **ALL PRIVILEGES**, **Make Changes**.

Your connection address (used in step 4) is:
```
mysql://cpuser_posuser:YOURPASSWORD@localhost:3306/cpuser_yashpos
```

## Step 3: Upload the app

1. cPanel → **File Manager**. In your home folder (**not** inside `public_html`) create a folder **`yashpos`**.
2. Open it, **Upload** `yash-pos-cpanel.zip`, then right-click it → **Extract**. Delete the zip afterwards.

You should see `app.js`, `package.json`, `client`, `server` and `uploads` inside `yashpos`.

## Step 4: Create the Node.js app

cPanel → **Setup Node.js App → Create Application**:

| Field | Value |
|---|---|
| Node.js version | **22** (or 20) |
| Application mode | **Production** |
| Application root | `yashpos` |
| Application URL | `pos.yourdomain.com` |
| Application startup file | `app.js` |

Under **Environment variables** add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the address from step 2 |
| `AUTO_SETUP` | `1` |
| `SEED_ADMIN_PASSWORD` | a strong password for the `owner` account |
| `NODE_ENV` | `production` |
| `COOKIE_SECURE` | `1` |
| `TRUST_PROXY` | `1` |

Click **Create**, then **Run NPM Install** (wait until it finishes, 1–3 minutes), then **Restart**.

## Step 5: HTTPS

cPanel → **SSL/TLS Status** → tick `pos.yourdomain.com` → **Run AutoSSL**. Free; it renews itself.

## Step 6: Sign in

Open **https://pos.yourdomain.com**, sign in as **owner** with the `SEED_ADMIN_PASSWORD` from step 4.
Change it in *My account*, add your shop in *Settings* and cashiers in *Staff & permissions*.
On the shop phone: Chrome → ⋮ → **Add to Home screen**.

## Updating to a new version

1. On your PC: `git pull`, then `npm run package:cpanel`.
2. cPanel → File Manager → `yashpos` → upload the new zip → **Extract** (allow it to overwrite) → delete the zip.
   Your `uploads` folder (photos, logo) is kept.
3. Setup Node.js App → **Run NPM Install** → **Restart**. New database changes are applied on start.

Take a backup before every update.

## Backups

- cPanel → **Backup** → *Download a MySQL Database Backup* → `cpuser_yashpos`. Do this weekly and before updates.
- Also download the `yashpos/uploads` folder now and then (product photos, logo, expense attachments).
- To restore: cPanel → **Backup** → *Restore a MySQL Database Backup*.

## If something is wrong

| What you see | What to do |
|---|---|
| "Incomplete response" or error 503 | Open `yashpos/stderr.log` in File Manager (if present) or ask support for the app log; it shows the reason. Usually `DATABASE_URL` is wrong. |
| `Access denied for user` in the log | Username/password/database name in `DATABASE_URL` don't match step 2 (check the `cpuser_` prefix). |
| Sign-in page loads but sign-in fails right away | Make sure HTTPS works (step 5): with `COOKIE_SECURE=1` the login cookie only works over https. |
| "Run NPM Install" fails | Try again once. If it fails again, send the error to the host's support; the install needs to download the Prisma engine. |
| No users / cannot sign in | `SEED_ADMIN_PASSWORD` was missing on first start: add it and **Restart**. |

## Good to know

- Shared hosting pauses apps that nobody uses for a while; the first visit afterwards takes a few seconds.
- CPU and memory are shared with other customers. Fine for one shop; if it becomes slow, move to a VPS
  ([CHEAP_HOSTING.md](CHEAP_HOSTING.md)) with a database backup and restore.
- Check that your host's terms allow Node.js apps on your plan.
