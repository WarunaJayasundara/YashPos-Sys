# YASH MOBILE POS & Inventory Management System

Point of sale, inventory, purchasing and profit reporting for **YASH MOBILE**, a mobile phone accessories shop in Sri Lanka.
It runs in the browser on the shop PC, and the owner can use it on a phone. It is an installable PWA (Progressive Web App)
with an offline sales queue.

| Layer | Technology (exact versions are in `laravel/composer.lock` and `package-lock.json`) |
|---|---|
| Backend | **PHP 8.2+, Laravel 12**, MySQL/MariaDB through Laravel's query builder (parameterised queries, transactions), FPDF (PDF invoices) |
| Frontend | React 18.3, TypeScript 5.6, Vite 5.4, Tailwind CSS 3.4, React Router 6.30, TanStack Query 5, Recharts 2, vite-plugin-pwa (Workbox), IndexedDB via `idb` |
| Database | MySQL 8 or MariaDB 10.4+ (developed on XAMPP's MariaDB 10.4) |
| Tests | PHPUnit feature tests against a real MySQL test database (`laravel/tests`), Vitest + Testing Library + fake-indexeddb (client) |
| Hosting | Any cPanel shared hosting with PHP 8.2+ and MySQL, for example **Serverbyt Ignite**; no terminal needed |

More documentation:
- [docs/SERVERBYT_HOSTING.md](docs/SERVERBYT_HOSTING.md): put it online with Serverbyt + a Namecheap domain, step by step
- [docs/DESIGN.md](docs/DESIGN.md): architecture, database tables, costing and profit rules, concurrency, offline design, security
- [docs/PRINTING.md](docs/PRINTING.md): thermal / A4 printer setup and troubleshooting
- [docs/FEATURES.md](docs/FEATURES.md): what is finished, what was verified, and known limitations
- API reference: [docs/openapi.yaml](docs/openapi.yaml)

Version 1 had a Node.js/Express backend. Version 2 replaces it with Laravel; the API, the database tables and the
React app are the same, so a version 1 database works as is (see "Moving from version 1" below).

## Quick start (Windows + XAMPP)

Requirements: **PHP 8.2 or newer**, Composer, Node.js 20+, and MySQL/MariaDB running (XAMPP: start MySQL).
XAMPP's own PHP may be older than 8.2: install PHP 8.2+ separately, or use `C:\path\to\php.exe` wherever `php` appears below.

```bash
npm install
```

```bash
cd laravel
```

```bash
composer install
```

```bash
copy .env.example .env
```

Edit `laravel/.env`: set `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` (XAMPP default: user `root`, empty password),
`SEED_ADMIN_PASSWORD` (the owner's first password), `APP_ENV=local`, `APP_DEBUG=true`, `COOKIE_SECURE=0`. Then:

```bash
php artisan key:generate
```

```bash
php artisan pos:setup
```

That creates the tables, roles, settings and the `owner` account. Start the API (port 8000):

```bash
php artisan serve
```

In a second terminal, from the project folder, start the web app (port 5173, it forwards `/api` to Laravel):

```bash
npm run dev
```

Open http://localhost:5173 and sign in as `owner`.

To try the production setup locally instead, run `npm run build` (copies the built app into `laravel/public`) and open
http://localhost:8000.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app with hot reload on :5173 (forwards `/api` and `/uploads` to :8000) |
| `php artisan serve` (in `laravel/`) | The API on :8000 |
| `php artisan pos:setup` | Create or update tables, roles, settings, and the owner account (safe to run again) |
| `npm run build` | Build the React app into `laravel/public` |
| `npm run package` | Make `release/yash-pos-serverbyt.zip` for cPanel hosting (see the hosting guide) |
| `npm test` | Client tests, then the PHP tests |
| `php artisan test` (in `laravel/`) | PHP feature tests; they recreate the `yash_pos_phptest` database each run |
| `npm run typecheck` | TypeScript check of the client |

The PHP tests need a MySQL user that can create and drop the `yash_pos_phptest` database (the name must contain
`test`; the test bootstrap refuses to reset anything else).

## Moving from version 1 (Node.js)

Point `laravel/.env` at the existing database and run `php artisan pos:setup`. It sees the tables are already there,
only records them as done, and keeps all data and passwords. Copy the old `server/uploads/*` files into
`laravel/public/uploads/`.

## Project layout

```
laravel/
  app/Http/Controllers/     REST endpoints, one class per area (sales, products, purchases, reports, ...)
  app/Services/             Inventory (the only code that changes stock), Sales (sales, voids, returns), PDF invoice, Setup
  app/Support/              auth (sessions, permissions, supervisor approval), money in cents, business-day dates, CSV, audit
  database/schema/          the database schema (SQL), applied by the migrations in database/migrations
  routes/api.php            every API route
  tests/Feature/            PHP feature tests
  public/                   web root: index.php, .htaccess, and the built React app (after npm run build)
client/
  src/pages/                one file per screen (POS, sales, products, purchases, reports, ...)
  src/components/           UI kit, responsive table, receipt layouts, paper chooser, approval dialog, layout
  src/lib/                  API client, auth context, offline queue (IndexedDB), formatting
scripts/
  build-laravel.mjs         builds the React app into laravel/public
  package-serverbyt.mjs     builds the cPanel upload zip
```
