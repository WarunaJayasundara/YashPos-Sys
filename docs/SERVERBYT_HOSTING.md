# Hosting YASH MOBILE POS on Serverbyt (cPanel) with a Namecheap domain

The POS is a Laravel (PHP + MySQL) app, so it runs on normal cPanel shared hosting such as
**Serverbyt Ignite**. You only click in cPanel: no terminal or SSH needed.

You need:
- the upload file **`yash-pos-serverbyt.zip`** (how to make it: [Making the upload file](#making-the-upload-file))
- your Serverbyt cPanel login and your Namecheap login

---

## 1. Point the domain at Serverbyt (Namecheap)

1. Serverbyt's welcome email lists two **nameservers** (like `ns1.serverbyt…` and `ns2.serverbyt…`).
2. Namecheap → **Domain List** → **Manage** → **Nameservers** → choose **Custom DNS** → enter both → ✓.
3. In cPanel → **Domains**: if this is not the hosting account's main domain, click **Create a New Domain** and add it.
   To use a subdomain such as `pos.yourdomain.com`, create that instead.

DNS changes take from a few minutes up to a few hours.

## 2. Choose the PHP version

cPanel → **Select PHP Version** (or "MultiPHP Manager"):
- Version **8.2** or **8.3**.
- Extensions ticked: `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `tokenizer`, `ctype`, `xml`, `iconv`, `gd`, `curl`.

## 3. Create the database

cPanel → **MySQL® Databases**:
1. **Create New Database**: `yashpos` (cPanel names it like `cpuser_yashpos`).
2. **Add New User**: `posuser` (becomes `cpuser_posuser`). Use a long password of **letters and numbers only**. Save it.
3. **Add User To Database**: pick both, tick **ALL PRIVILEGES**, **Make Changes**.

## 4. Upload the app

1. cPanel → **File Manager** → **Settings** (top right) → tick **Show Hidden Files (dotfiles)** → Save.
2. Go to your **home folder** (the one that *contains* `public_html`, not inside it) → **+ Folder** → `yashpos`.
3. Open `yashpos` → **Upload** `yash-pos-serverbyt.zip` → right-click it → **Extract** → then delete the zip.

You should now see `app`, `public`, `vendor`, `.env.example` and others inside `yashpos`.

## 5. Fill in the settings

In `yashpos`, right-click **`.env.example`** → **Rename** to **`.env`** → right-click → **Edit**. Change these lines:

```
APP_URL=https://pos.yourdomain.com
DB_DATABASE=cpuser_yashpos
DB_USERNAME=cpuser_posuser
DB_PASSWORD=the password from step 3
SEED_ADMIN_PASSWORD=a strong password for the owner account
```

Leave `APP_KEY` and `INSTALL_KEY` as they are (they were generated for you). Copy the `INSTALL_KEY` value somewhere safe. **Save**.

## 6. Point the domain to the app

cPanel → **Domains** → **Manage** (next to your domain) → **Document Root** → `yashpos/public` → **Update**.

*If cPanel does not allow changing it:* extract the zip straight into `public_html` instead (step 4).
The included `.htaccess` then serves only the `public` folder and blocks everything else.

## 7. Turn on HTTPS

cPanel → **SSL/TLS Status** → tick your domain → **Run AutoSSL** (free, renews itself).
Then cPanel → **Domains** → turn on **Force HTTPS Redirect**.

## 8. Create the tables and the owner account

Open in your browser (with your domain and the `INSTALL_KEY` from step 5):

```
https://pos.yourdomain.com/install?key=YOUR_INSTALL_KEY
```

It should end with **"Owner account created."**. Then edit `.env` again and empty the `SEED_ADMIN_PASSWORD=` line (keep `INSTALL_KEY`: updates use it).

## 9. Start selling

1. Open **https://pos.yourdomain.com** → sign in as **`owner`** with the password from step 5.
2. **My account**: change the password. **Settings**: shop name, address, phone, logo, receipt footer.
3. **Staff & permissions**: one account per cashier (never share the owner login).
4. On the shop phone or tablet: Chrome → ⋮ → **Add to Home screen**.
5. Printers: see [PRINTING.md](PRINTING.md).

### Check that private files are protected
`https://pos.yourdomain.com/.env` must show **403 Forbidden** or **404**, never file contents.

---

## Updating to a new version

1. Make a new `yash-pos-serverbyt.zip` (below) and take a backup (next section).
2. File Manager → `yashpos` → upload the zip → **Extract** → allow overwriting → delete the zip.
   Your `.env` and the uploaded photos in `public/uploads` are not touched (the zip has neither).
3. Open `https://pos.yourdomain.com/install?key=YOUR_INSTALL_KEY` once to apply any database changes.

## Backups

- cPanel → **Backup** → **Download a MySQL Database Backup** → `cpuser_yashpos`. Weekly, and before every update.
- Also download the `yashpos/public/uploads` folder now and then (photos, logo, expense receipts).
- Restore: cPanel → **Backup** → **Restore a MySQL Database Backup**.

## When something is wrong

| What you see | What to do |
|---|---|
| Error 500 / white page | Open `yashpos/storage/logs/laravel.log` in File Manager: the last lines say why. Check the PHP version (step 2). |
| `/install` says *Setup failed … Access denied* | Database name, user or password in `.env` does not match step 3 (check the `cpuser_` prefix). |
| `/install` shows *404* | The `key=` value is not exactly the `INSTALL_KEY` in `.env`. |
| Sign-in page loads but sign-in fails at once | HTTPS is not working yet (step 7): with `COOKIE_SECURE=1` the login cookie only works over https. |
| "Permission denied" in the log | File Manager → set `yashpos/storage` and `yashpos/bootstrap/cache` to **755** (775 if still failing). |

To see the full error on screen for a minute: set `APP_DEBUG=true` in `.env`, reload, then set it back to `false`.

## What happens when the internet goes off

The POS keeps selling: products come from a copy saved on the device, and each sale is stored on that device as
**pending**. When the connection returns, pending sales are sent automatically and get their invoice numbers
(they are never recorded twice). Only selling works offline; don't clear the browser's data while sales are pending.

---

## Making the upload file

On your PC, in the project folder (needs Node.js, PHP 8.2+ and Composer):

```bash
npm run package
```

It builds the app and writes **`release/yash-pos-serverbyt.zip`**. That file contains fresh secret keys:
never share it or put it on GitHub (the `release` folder is ignored by git).

If your PHP or Composer is not on the PATH, tell the script where they are, for example:

```bash
PHP_BIN="C:/php83/php.exe" COMPOSER_PHAR="C:/ProgramData/ComposerSetup/bin/composer.phar" npm run package
```
