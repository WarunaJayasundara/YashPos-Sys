# YASH MOBILE POS & Inventory Management System

Point of sale, inventory, purchasing and profit reporting for **YASH MOBILE**, a mobile phone accessories shop in Sri Lanka.
It runs in the browser on the shop PC, and the owner can use it on a phone. It is an installable PWA (Progressive Web App)
with an offline sales queue.

| Layer | Technology (exact versions are in `package.json` / `package-lock.json`) |
|---|---|
| Frontend | React 18.3, TypeScript 5.6, Vite 5.4, Tailwind CSS 3.4, React Router 6.30, TanStack Query 5, Recharts 2, vite-plugin-pwa (Workbox), IndexedDB via `idb` |
| Backend | Node.js 22 (20+ works), Express 4.21, TypeScript, Zod validation, Prisma 5.22 ORM, PDFKit (PDF invoices), Swagger UI |
| Database | MySQL 8 or MariaDB 10.4+ (developed on XAMPP's MariaDB 10.4) |
| Tests | Vitest + Supertest (API, against a real test database), Testing Library + fake-indexeddb (client) |

More documentation:
- [docs/DESIGN.md](docs/DESIGN.md): architecture, database tables, costing and profit rules, concurrency, offline design, security
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production setup, HTTPS, database backup and restore
- [docs/PRINTING.md](docs/PRINTING.md): thermal / A4 printer setup and troubleshooting
- [docs/CHEAP_HOSTING.md](docs/CHEAP_HOSTING.md): your own domain on a ~$6/month server, set up with one command (recommended for real use)
- [docs/CPANEL_HOSTING.md](docs/CPANEL_HOSTING.md): cPanel shared hosting with "Setup Node.js App" (Serverbyt, Namecheap Stellar): upload a zip, no command line
- [docs/FREE_HOSTING.md](docs/FREE_HOSTING.md): free ways to put it online (Render + Aiven, Oracle Cloud, Cloudflare Tunnel)
- [docs/FEATURES.md](docs/FEATURES.md): what is finished, what was verified, and known limitations
- API reference: `http://localhost:4000/api/docs` (Swagger UI) or [server/openapi.yaml](server/openapi.yaml)

## Quick start (Windows + XAMPP)

Requirements: Node.js 20 or 22, and MySQL/MariaDB running (XAMPP: start MySQL in the control panel).

```bash
npm install
```

```bash
copy server\.env.example server\.env
```

Edit `server/.env` and set `DATABASE_URL` (XAMPP default user is `root` with no password:
`mysql://root:@127.0.0.1:3306/yash_pos`). Then create the tables and the demo data:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Start the API (port 4000) and the web app (port 5173) in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173.

### Demo accounts (development seed only)

The development seed creates an owner, a manager and a cashier. Their usernames and passwords are in
[server/prisma/seed.ts](server/prisma/seed.ts) (`seedUsers`). **Change them, or seed a production database
with `SEED_DEMO=0` and your own `SEED_ADMIN_PASSWORD`** (see DEPLOYMENT.md). The demo catalogue, supplier,
purchase and sales are clearly fake data for trying the system; they are not real business figures.

## Commands

| Command | What it does |
|---|---|
| `npm run dev:server` / `npm run dev:client` | Development servers (API with auto-reload, Vite with hot reload; Vite proxies `/api` to :4000) |
| `npm run db:migrate` | Apply database migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Permissions, roles, settings, owner account (+ demo data when `SEED_DEMO` is not `0` and not production) |
| `npm run db:reset -w server` | **Deletes all data**, re-creates the schema and re-seeds (development only) |
| `npm test` | All automated tests (API tests reset and use the `yash_pos_test` database) |
| `npm run build` | Compile the API to `server/dist` and the PWA to `client/dist` |
| `npm start -w server` | Production: one Node process serves the API **and** the built PWA on the same port |
| `npm run typecheck -w client` / `npm run typecheck -w server` | Type checks |

The API tests need a MySQL user that can create/drop the `yash_pos_test` database. Override with `TEST_DATABASE_URL`
(the name must contain `test`; the suite refuses to reset anything else).

## Project layout

```
server/
  prisma/schema.prisma      database schema (all tables, decimal money columns, indexes, FKs)
  prisma/migrations/        SQL migrations
  prisma/seed.ts            roles/permissions/owner + optional demo data
  src/lib/                  auth (sessions, CSRF, permissions, supervisor approval), money, CSV, audit
  src/services/             inventory (the only code that changes stock), sales, returns, purchases, PDF invoice
  src/routes/               REST endpoints, one file per area
  openapi.yaml              API documentation (served at /api/docs)
  tests/                    API + integration tests
client/
  src/pages/                one file per screen (POS, sales, products, purchases, reports, ...)
  src/components/           UI kit, responsive table, receipt layouts, approval dialog, layout/navigation
  src/lib/                  API client, auth context, offline queue (IndexedDB), formatting
scripts/backup.ps1|.sh      database + uploads backup
```
