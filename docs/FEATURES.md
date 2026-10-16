# Features, verification status and limitations

## Completed

**Access control**: login/logout with server-side sessions (owner and cashiers can be signed in at the same time on
different devices; in one browser a new sign-in replaces the old one and every open tab switches with it), three default roles (Owner, Manager, Cashier) plus custom
roles, per-permission editing, per-role discount limits, supervisor approval dialog, cost and profit fields removed
from API responses for unauthorised users, account deactivation, password change, login rate limiting, audit log.

**Products**: only a name and a selling price are required (anything can be sold, e.g. a TV); everything else is optional.
SKU (unique, generated automatically as P-00001... when left empty), barcode (EAN/UPC check-digit validation), description, category
(items without one appear as "Other" in the POS and "No category" in reports), brand, supplier,
model compatibility, colour, size, connector, variant group, buying price, weighted average cost, selling and minimum
price, stock on hand / reserved / available, reorder and overstock levels with LOW / OUT / OVER badges, warranty
months, image upload, active flag. Search, filters, paging, CSV export, all-or-nothing CSV import with row errors,
price-change history, lifetime units/revenue/COGS/profit per product, stock movement history. From the POS, a search
that finds nothing offers "Add as a new product", which creates it and puts it on the bill. Brand and category are typed with
suggestions ("sam" offers Samsung; "samsung" picks it, so no duplicates); a name that does not exist yet is added only
after a confirmation, and only by users who manage the catalogue (owner, manager); others are told to ask the owner.

**Purchases and suppliers**: suppliers with balances, purchase orders (draft/ordered), partial deliveries with
received / damaged / missing quantities, stock increases only on receipt, landed cost (freight allocated by value),
supplier invoice number and total, partial payments, outstanding balance, cancellation rules, supplier price history.

**Stock**: complete movement ledger (opening, receipt, sale, void, customer return, supplier return, damaged, lost,
adjustment) with user, reference and reason; adjustment requests with manager approval; oversell protection under
concurrency. The owner can **undo** a wrong opening-stock entry or manual adjustment (an opposite entry is added; the original
stays in the history marked "Undone", with who and why; refused if those units were already sold) and **delete** a product
added by mistake, as long as it was never sold or purchased (otherwise deactivate it). Both are owner-only permissions.
Before going live, **Settings → Clear test data** (owner only, needs the word CLEAR and the owner's password) removes all
trial sales, returns, purchases, payments, expenses, cash closings and stock history and restarts invoice numbers; products
are kept with their current stock (or optionally deleted too). Staff, settings, customers and suppliers stay.

**Low-stock alerts**: a bell in the top bar (owner and manager) shows how many products are low or sold out, with the
list, suppliers and a link to start a purchase. When a sale, return write-off or adjustment takes a product to its reorder
level or to zero, the owner gets an email (sent after the sale, so the till never waits) and every open POS screen shows a
pop-up, plus a device notification if allowed. Optional daily email with the full list (cron). Set in Settings.

**POS**: keyboard-first screen (F2 search, arrow keys, Enter, F9 pay), keyboard-wedge barcode scanners (code +
Enter), search by name/SKU/barcode/brand/model/connector, cart with quantity, price and line discount, bill discount,
stock shown live, serial numbers for warranty items, optional customer, cash/card/bank transfer/QR/on-account and
split payments, quick cash buttons and change due, supervisor approval for discounts over the limit or below the
minimum price, idempotent submit; after the sale the cashier chooses the paper size (80 mm, 58 mm, A4, PDF), checks the bill and
can edit the customer and a note, or fix wrong items (cancels and re-rings with approval).

**Invoices**: 80 mm and 58 mm thermal layouts, A4 layout, server-side A4 PDF, reprint from history (audited),
configurable shop name, logo, address, phone, footer, warranty policy, tax label/rate/registration, invoice prefix,
default format. Invoices are snapshots; returns and voids reference the original.

**Returns, voids, warranty**: partial returns (refund = net price paid, exact across repeated partial returns),
restock or write off as damaged, refund method incl. store credit, exchange (return then new sale), same-day void with
restock, warranty records created automatically with expiry, claim status/notes/resolution.

**Customers**: optional registration (name + phone), purchase history, credit sales, payments on account, balances.

**Money**: expenses with categories, payment method, reference and attachment; daily cash closing with denomination
counter, expected vs counted, difference, non-cash totals for reconciliation.

**Dashboard** (PC and phone): today and period sales, bills, average bill, gross profit and margin, net profit,
stock units, stock at cost and retail, potential profit, low/out counts, daily sales and profit chart, payment method
chart, best sellers, slow movers, low stock list, recent sales and purchases. Financial tiles only for permitted users.

**Reports** (date/category/cashier filters, print, CSV that opens in Excel): daily sales, weekly/monthly sales, sales by
product / category / brand / cashier, gross profit by product / category, purchase history, supplier balances,
inventory valuation, low/out of stock, stock movements, damaged and adjusted stock, returns/refunds/voids, discounts
given (with approver), expenses and net profit, cash reconciliation, best sellers, slow movers.

**PWA / offline**: installable app (manifest, icons, service worker for the app shell), connection banner, last sync
time, cost-free cached catalogue, offline sale queue with pending/conflict states, automatic sync, reconciliation page.

**Mobile and design**: modern POS layout (tap-to-add product tiles with category chips, live stock badges, a bill panel,
on-screen cash keypad with quick amounts, large change display), grouped dark sidebar that collapses to icons (and does
so automatically on the till screen), top bar with connection status, phone bottom bar with a raised "Sell" button,
bill as a slide-up sheet on phones, list rows with product thumbnails on phones, collapsible filters, skeleton loading,
Inter typeface.

## How it was verified

Automated (all passing at the time of writing):
- **API, 76 PHP tests** (`laravel/tests/Feature`, PHPUnit), against a real MySQL/MariaDB test database: authentication, cookie flags, CSRF,
  rate limiting, session revocation, cashier/manager restrictions on cost data and owner-only reports; product
  validation (duplicate SKU, barcode check digit, negative price, min > selling), price history, stock filters,
  price-change approval; purchase orders not changing stock, partial receipt with damaged units, freight allocation and
  weighted average cost, over-receiving refused, supplier payments and overpayment; stock adjustments and approvals;
  server-side totals ignoring client totals, invalid and zero quantities, insufficient stock, all-or-nothing multi-line
  sales, selling past the last unit refused, duplicate submissions, sequential unique invoice
  numbers, discount limits and supervisor approval, minimum price, split/short/credit payments, historical cost kept
  after a new purchase price, own-sales visibility, audit entries, invoice snapshots after price changes, PDF output;
  partial and repeated returns, damaged returns, cashier return approval, void; gross profit with discounts and
  returns, report date filters, net profit, cash closing excluding card payments, CSV export; low-stock alerts (raised at
  the reorder level and again when sold out, not repeated, none for a failed sale or an inactive product, emailed once,
  switch off, daily summary, test email); every form accepting empty optional fields as the app sends them; and every
  GET endpoint opened as owner, manager and cashier (owner gets everything, nobody gets a server error).
- **Client, 21 tests** (`client/src/__tests__`): POS search ranking and barcode match, offline queue (pending, sync with
  the same idempotency key, network still down, stock conflict kept for reconciliation, only the original cashier can
  sync, discard restores local stock), 80/58 mm and A4 receipt content, responsive table.
- Type check (`tsc`) and production build of the client.
- **Real concurrency on Laravel**: five separate PHP processes on one database. Eight buyers for the last 2 units at
  the same moment, three times: exactly 2 sold each time, stock never below 0. The same sale sent five times at once:
  one sale. Twenty sales at once: twenty unique, gap-free invoice numbers.
- **Same answers as version 1**: every read endpoint and all 20 reports were compared field by field against the
  Node.js version on the same database, as owner, manager and cashier: identical (apart from the order of tied
  best-sellers, which is now fixed).
- **Shared-hosting rehearsal**: the upload zip was extracted into an empty folder, set up from the browser with
  `/install`, and served by Apache with PHP 8.3 (CGI) using the included `.htaccess` files, both with the document root
  on `public` and with everything in `public_html`: sign-in, sale, bill edit, PDF and CSV worked; `.env`, `vendor`
  and app files were never served; a PHP file planted in `uploads` was refused.

In the browser (development servers, demo data):
- Signed in as owner; dashboard rendered with real computed figures.
- POS: two barcode-style SKU scans and a word search added items, paid by cash, sale completed with correct change,
  receipt opened. Done by dispatching real input/keyboard events because the browser pane was not visible on screen.
- Print view: 80 mm receipt measured 72 mm wide, 58 mm measured 48 mm, A4 measured 186 mm; `@page` sizes correct;
  PDF endpoint returned a valid PDF.
- 23 routes at 375 px (phone), 768 px (tablet) and ~1100 px (laptop): no horizontal page overflow, every page loaded its
  data without error. The sign-in page was checked separately at phone and desktop size.
- Screenshots reviewed of the dashboard, POS (grid, bill, payment keypad, phone bill sheet and payment), products,
  sales history, sale detail and sign-in at phone, tablet and desktop sizes.
- Signed in as cashier: landed on POS, navigation limited, no cost or margin columns, another cashier's sale refused,
  no financial reports.
- Production mode (`npm run build`, served by Laravel): all 24 screens loaded with data, POS sale, paper choice, bill
  preview and edit, A4 PDF (layout checked), photo, logo and receipt uploads.

**Not verified** (be aware):
- Nothing was printed on a physical thermal printer; layouts were checked by measurement only.
- PWA installation and service-worker offline behaviour were not tested on a real phone or over HTTPS (the queue
  logic itself is unit-tested).
- Not yet run on a real Serverbyt account (the rehearsal used Apache + PHP 8.3 locally; Serverbyt may differ slightly).
- Tested with PHP 8.3; the code and dependencies target PHP 8.2 but were not run on 8.2 itself.
- Not tested on a real MySQL 8 server (developed and tested on MariaDB 10.4).

## Limitations and decisions

- **Costing** is weighted average cost (not FIFO). Damaged goods at receipt are not added to stock or cost; supplier
  credit notes for them are not modelled (adjust the supplier invoice total instead).
- **Variants** are separate SKUs linked by `variantGroup` (no separate variant table).
- **Reserved quantity** exists in the schema and in availability checks, but there is no reservation/lay-by feature yet.
- **Exchanges** are a return followed by a new sale (two documents), not a single exchange document.
- **Voids** are limited to the same business day; older sales must be returned.
- **Selling on account** (credit) is available to any role that can sell, provided a customer phone is entered;
  restrict it by policy or add a permission if needed.
- **Cash closing** is one drawer per business day; supplier payments in cash are not deducted from the drawer
  (record them as "paid from drawer" expenses if they come out of the till).
- **Offline**: only sales can be made offline; the cashier must stay signed in on that device; pending sales get no
  printed receipt until synced; offline sales are re-checked against server stock and may need reconciliation.
- **Silent printing** requires Chrome's `--kiosk-printing` flag or a local helper (not included).
- **Excel export** is CSV with a UTF-8 BOM (opens in Excel); there is no native `.xlsx` writer.
- **Sinhala**: the invoice language setting exists but only English templates are implemented.
- **Single branch** only; no branch transfers.
- **Rate limiting** uses Laravel's cache (file cache by default, shared by all PHP processes on the server).
- **Demo data**: version 2 has no demo catalogue seeder; a new install starts empty (the owner adds products).
- `npm audit`: two moderate React Router advisories remain (open redirect via backslash paths in `<Link>`, and SSR
  hydration). This app has no SSR and never navigates to user-supplied URLs, so they do not apply; upgrading to React
  Router 7 removes them. Other advisories are in development-only tools (Vite/esbuild dev server, Vitest); do not
  expose the dev server to a network.
