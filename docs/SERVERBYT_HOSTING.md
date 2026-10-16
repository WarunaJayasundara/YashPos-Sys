# Hosting YASH MOBILE POS on Serverbyt (StackCP) with a Namecheap domain

Serverbyt's control panel is **StackCP**. You only click in the panel: no terminal needed.
Example domain below: `yashenterpr.store`; use your own.

You need: the upload file **`yash-pos-serverbyt.zip`**, your Serverbyt login and your Namecheap login.

---

## Step 1. Namecheap: point the domain to Serverbyt

Namecheap → **Domain List** → **MANAGE** (next to the domain) → **Domain** tab → **NAMESERVERS** →
choose **Custom DNS** → enter (use **ADD NAMESERVER** for boxes 3 and 4):

```
ns1.serverbyt.net
ns2.serverbyt.net
ns3.serverbyt.net
ns4.serverbyt.net
```

Click the green **✓**. It takes from 30 minutes to a few hours. Carry on with steps 2 to 6 meanwhile.

## Step 2. Open the hosting panel

Serverbyt → log in → **Manage Hosting** → next to your domain click **Options → Manage**. This is StackCP.

## Step 3. PHP version

**Web Tools → Change PHP Version** (also called PHP Version Manager) → choose **8.3** (or 8.2) → **Save**.

## Step 4. Create the database

1. **Web Tools → MySQL Databases**.
2. Type a name, e.g. `yashpos`, and a long password of **letters and numbers only** → **Create**.
3. In the list below, write down **three things** exactly as shown:
   - **Database name** (e.g. `yashpos-3530350fa3`); on StackCP this is **also the username**
   - **Database host / server** (looks like `shareddb-x.hosting.stackcp.net`), **not** `localhost`
   - the password you chose

## Step 5. Upload the POS into `public_html`

1. **Files → File Manager** → open **`public_html`**.
2. Delete what is already inside (usually a default `index.html` / `index.php` placeholder).
3. **Upload** `yash-pos-serverbyt.zip` into `public_html`.
4. Right-click the zip → **Extract** (into `public_html` itself) → then delete the zip.

`public_html` now contains `app`, `public`, `vendor`, `.htaccess`, `.env.example` and other files.
(If you do not see `.htaccess` / `.env.example`, turn on **Show hidden files** in the File Manager settings.)
The included `.htaccess` sends visitors only to the `public` folder; everything else stays private.

## Step 6. Fill in the settings

In `public_html`, **rename** `.env.example` to **`.env`**, then **edit** it and change the lines marked `<-`:

```
APP_URL=https://yashenterpr.store
DB_HOST=shareddb-x.hosting.stackcp.net      (database host from step 4)
DB_DATABASE=yashpos-3530350fa3              (database name from step 4)
DB_USERNAME=yashpos-3530350fa3              (same as the database name)
DB_PASSWORD=your database password
SEED_ADMIN_PASSWORD=a strong password for the owner account
```

Copy the **`INSTALL_KEY=`** value somewhere safe (step 8). Do not change `APP_KEY` or `INSTALL_KEY`. **Save**.

## Step 7. Free HTTPS (after step 1 has finished)

When Serverbyt no longer says "not using our nameservers": StackCP → **Security → Free SSL** (Let's Encrypt) →
turn it on for the domain (and `www`). Wait until it shows **Active**.

The POS sends every visitor to `https://` by itself, so do this **before** step 8.

## Step 8. Create the tables and the owner account

Open in the browser (your domain and your key from step 6):

```
https://yashenterpr.store/install?key=YOUR_INSTALL_KEY
```

It must end with **"Owner account created."** Then edit `.env` again and empty `SEED_ADMIN_PASSWORD=`
(keep `INSTALL_KEY`: updates use it).

## Step 9. Start selling

1. Open **https://yashenterpr.store** → sign in as **`owner`** with the password from step 6.
2. **My account**: change the password. **Settings**: shop name, address, phone, logo, receipt footer.
3. **Staff & permissions**: one account for each cashier (never share the owner login).
4. **Products**: add products with stock and reorder levels.
5. Shop phone/tablet: open the site in Chrome → ⋮ → **Add to Home screen**.
6. Safety check: `https://yashenterpr.store/.env` must show **Forbidden** or **Not Found**, never the file.

## Step 10. Low-stock emails (optional)

1. StackCP → **Emails → Email Addresses** (Mailboxes) → create `pos@yashenterpr.store` with a password.
2. Edit `.env`:
   ```
   MAIL_MAILER=smtp
   MAIL_SCHEME=smtps
   MAIL_HOST=smtp.stackmail.com
   MAIL_PORT=465
   MAIL_USERNAME=pos@yashenterpr.store
   MAIL_PASSWORD=the mailbox password
   MAIL_FROM_ADDRESS="pos@yashenterpr.store"
   ```
3. POS → **Settings → Low-stock alerts** → owner's email (Gmail is fine) → **Save settings** → **Send a test email**
   (check spam the first time).

*Optional daily list:* StackCP → **Scheduled Tasks / Cron Jobs** → daily at 08:00, command:
`php /home/sites/.../public_html/artisan pos:stock-alerts --summary` (StackCP shows the exact path to your site and to PHP).

---

## Updating to a new version

1. Make a new zip (below) and take a backup (next section).
2. File Manager → `public_html` → upload the zip → **Extract** (overwrite) → delete the zip.
   Your `.env` and the photos in `public/uploads` are kept (the zip has neither).
3. Open `https://yashenterpr.store/install?key=YOUR_INSTALL_KEY` once to apply database changes.

## Backups

- StackCP → **MySQL Databases** → your database → **phpMyAdmin** → **Export** → **Go**. Weekly and before every update.
- Download `public_html/public/uploads` now and then (photos, logo, receipts).
- StackCP also keeps its own daily backups (**Backups / Timeline**), which can restore files and databases.

## When something is wrong

| What you see | What to do |
|---|---|
| Error 500 / white page | File Manager → `public_html/storage/logs/laravel.log`: the last lines say why. Check the PHP version (step 3). |
| `/install` says *Access denied* or *getaddrinfo* | `DB_HOST`, `DB_DATABASE`, `DB_USERNAME` or `DB_PASSWORD` in `.env` do not match step 4 exactly. |
| `/install` shows *404* | The `key=` value is not exactly the `INSTALL_KEY` in `.env`. |
| Browser says "too many redirects" | Edit `public_html/public/.htaccess` and delete the "Force HTTPS" block (from that comment down to its RewriteRule line). |
| Browser says the connection is not private | SSL (step 7) is not active yet. Wait, then try again. |
| Sign-in fails immediately | Use `https://` (the login cookie only works over HTTPS). |
| "Send a test email" fails | Check the `MAIL_` lines; the username is the full email address. |
| "Permission denied" in the log | File Manager → set `storage` and `bootstrap/cache` to **755**. |

Full error on screen for a minute: set `APP_DEBUG=true` in `.env`, reload, then set it back to `false`.

## What happens when the internet goes off

The POS keeps selling: products come from a copy on the device and each sale is stored there as **pending**.
When the connection returns, pending sales are sent automatically and get their invoice numbers (never twice).
Only selling works offline; don't clear the browser's data while sales are pending.

---

## Making the upload file

On the PC, in the project folder (needs Node.js, PHP 8.2+ and Composer):

```bash
npm run package
```

It writes **`release/yash-pos-serverbyt.zip`** with fresh secret keys: never share it or put it on GitHub.
If PHP or Composer is not on the PATH: `PHP_BIN="C:/php83/php.exe" COMPOSER_PHAR="C:/path/composer.phar" npm run package`.
