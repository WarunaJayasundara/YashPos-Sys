# Design

## Architecture

```
 Shop PC browser / owner's phone (PWA)
   React SPA ── service worker (app shell cache) ── IndexedDB (product catalogue, offline sales queue)
        │  same-origin HTTPS, session cookie, X-Requested-With header
        ▼
 Node.js / Express API  ── Zod validation ── permission checks ── services (inventory, sales, returns, purchases)
        │  Prisma (parameterised queries, transactions)
        ▼
 MySQL / MariaDB
```

In production one Node process serves both the API (`/api/*`) and the built PWA, so the session cookie is first-party
and `SameSite=Strict` works. In development Vite (port 5173) proxies `/api` to the API (port 4000).

## Costing method: weighted average cost

`products.avgCost` is a moving weighted average, updated whenever stock comes **in** at a known cost:

```
newAvg = (qtyOnHand × avgCost + qtyIn × unitCostIn) / (qtyOnHand + qtyIn)        (if qtyOnHand ≤ 0: newAvg = unitCostIn)
```

- **Goods receipt**: `unitCostIn` is the landed cost = supplier unit cost + its share of the receipt's additional
  costs (freight, delivery). Additional costs are spread over the *accepted* units in proportion to their value
  (qty × unit cost), with cent-exact rounding.
- **Sale**: each `sale_items.unitCost` stores the average cost at the moment of sale. That is the cost of goods sold for
  that line forever; later purchases at other prices never change it.
- **Customer return to stock / void**: the units come back at the cost they were sold at (keeps the average honest).
- `products.purchasePrice` is only the *last supplier price* (shown for reference and kept in `price_history`).

## Profit definitions (used identically by dashboard and reports)

| Metric | Definition |
|---|---|
| Sales (revenue incl. tax) | Sum of invoice totals of non-voided sales |
| Net sales revenue | Line totals − line discounts − allocated bill discount, **excluding tax**, minus refunds (excluding tax). Returns count on the date of the return |
| COGS | Σ qty × `unitCost` of sold lines − cost of units returned to stock |
| Gross profit | Net sales revenue − COGS |
| Gross margin % | Gross profit / net sales revenue |
| Stock written off | Cost of units moved out as DAMAGED or LOST (incl. damaged customer returns) |
| Net profit | Gross profit − stock written off − operating expenses dated in the period |
| Inventory value at cost | Σ qtyOnHand × avgCost |
| Retail value / potential profit | Σ qtyOnHand × sellingPrice, and retail − cost |
| Cash received | Payments by method; CREDIT ("on account") is not cash |
| Customer balance | Credit given on sales − customer payments − store-credit refunds |
| Supplier balance | Supplier invoice totals (non-draft, non-cancelled) − supplier payments |

A bill discount is allocated across lines by line value (`sale_items.allocatedBillDiscount`) so profit by product
and category stays exact. Tax (if configured) is added on the discounted bill and is never counted as revenue.

## Stock integrity and concurrency

- `services/inventory.ts › applyMovement()` is the **only** code that changes `qtyOnHand`, and it always writes a
  `stock_movements` row (type, signed qty, balance after, unit cost, user, reference, reason).
- Decrements are one conditional statement: `UPDATE products SET qtyOnHand = qtyOnHand - n WHERE id = ? AND qtyOnHand - qtyReserved >= n`.
  If no row is updated the transaction aborts with `INSUFFICIENT_STOCK`. Two tills selling the last unit cannot both
  succeed (covered by a test that fires 5 parallel sales at 2 units). Stock never goes negative.
- Increments lock the product row (`SELECT … FOR UPDATE`) so the average cost is computed from a consistent state.
- A sale, its items, payments, warranty records, stock movements, invoice number and audit entry are written in **one
  database transaction**. A sale is only reported complete after the commit.
- Partial returns use the same conditional-update pattern on `sale_items.qtyReturned`.

## Invoice numbers and duplicate submissions

- Numbers come from `document_sequences` (`INSERT … ON DUPLICATE KEY UPDATE value = value + 1` inside the sale
  transaction), so they are unique and gap-free per year: `YM-2026-000001`. Purchases (`PO-`), goods receipts
  (`GRN-`) and returns (`RT-`) use the same mechanism.
- Every POS checkout carries a `clientRequestId` (UUID) with a unique index. Re-sending the same request (double
  click, retry after a timeout, offline sync) returns the original sale with `duplicate: true` instead of creating
  another one, including when two copies race (the loser catches the unique-key error and returns the winner).

## Invoices are immutable snapshots

`sales` / `sale_items` store product name, SKU, list price, charged price, discounts, tax rate, cost and cashier name
at the time of sale. Receipts and PDFs are rendered only from these rows, so changing a product or price never changes
an old invoice. Refunds create `returns` / `return_items` / `refunds` rows that reference the sale; voids set
`status = VOIDED` with who/when/why. Nothing is deleted.

## Approvals (supervisor override)

When a cashier's request needs a higher permission (discount above their role's `maxDiscountPercent`, selling below
`minSellingPrice`, voids, returns, selling-price changes), the API answers `403 APPROVAL_REQUIRED`. The UI asks a
supervisor to type their own username and password, and the same request is repeated with `approval`. The server
verifies the supervisor's credentials and permission and stores the approver on the record and in the audit log.

## Roles and permissions

Permissions are stored in `permissions` / `role_permissions` and checked by the API on every route (`requirePerm`)
and inside services. Cost, buying price, margin and profit fields are **removed from responses** for users without
`products.view_cost` / `reports.financial` / `dashboard.financial`, not just hidden in the UI. The owner can edit any
role's permissions and discount limit in *Staff & permissions*; the Admin role always keeps every permission.

| | Owner | Manager (default) | Cashier (default) |
|---|---|---|---|
| POS, own sales, reprint | ✓ | ✓ | ✓ |
| All sales, void | ✓ | ✓ | approval needed |
| Returns / refunds | ✓ | ✓ | approval needed |
| Discount without approval | 100% | 15% | 5% |
| Buying price, average cost, margins | ✓ | ✓ | – |
| Products, categories, suppliers, purchases, receive goods | ✓ | ✓ | – |
| Supplier payments | ✓ | – | – |
| Stock adjustments | ✓ | ✓ (approve) | – |
| Sales & inventory reports, CSV export | ✓ | ✓ | – |
| Profit, valuation, net profit, supplier balance reports; financial dashboard | ✓ | – | – |
| Selling price changes | ✓ | approval needed | – |
| Expenses | ✓ | ✓ | – |
| Daily cash closing | ✓ | ✓ | ✓ |
| Staff, roles, audit log, settings | ✓ | – | – |

## Offline design

The system is online-first. Offline support is deliberately limited and conservative:

1. The service worker caches only the app shell (HTML/JS/CSS/icons). API responses are never cached by it.
2. The POS keeps a **cost-free** product catalogue in IndexedDB (`/api/products/catalog`), refreshed on load, after
   each sale, every 10 minutes, and when the connection returns. It is cleared on sign-out.
3. If the device is offline (or the server does not answer and the cashier agrees), the sale is stored in IndexedDB as
   **PENDING** with its `clientRequestId`. It has no invoice number and is clearly labelled as not recorded on the
   server. The local catalogue quantity is reduced so the same device does not oversell its own stock.
4. When online again, pending sales are posted one by one with the same `clientRequestId` (so a lost response can
   never create a duplicate). The server re-validates stock, prices and permissions. Only the cashier who saved a sale
   can sync it (their session identifies the cashier).
5. If the server rejects a sale (for example stock ran out because another device sold it), it becomes **CONFLICT**
   and is listed under *Offline queue* for reconciliation: restock and retry, or discard and settle with the customer.
   The client never pushes stock quantities to the server.

Receipts are not printed for pending sales (there is no invoice yet); print from Sales history after sync.

## Security summary

bcrypt password hashing (cost 12); server-side sessions (random 256-bit token, only its SHA-256 stored), httpOnly +
SameSite=Strict + Secure (when `COOKIE_SECURE=1`) cookie, sliding 12-hour expiry; sessions are deleted on logout,
password change, role change or deactivation. CSRF: state-changing requests require `X-Requested-With: yash-pos`
(not sendable cross-site without a CORS preflight, which the API never grants) on top of SameSite=Strict. Login rate
limiting per account+IP and per IP. Zod validation on every input; Prisma parameterised queries only. Helmet security
headers and CSP. Totals, discounts, payments and change are always recalculated on the server. CSV exports escape
formula injection. Uploads are type- and size-limited with random file names. Secrets only in environment variables.
Every sensitive action writes `audit_logs` (who, what, when, IP, details).

## Database tables

| Table | Purpose |
|---|---|
| `users`, `roles`, `permissions`, `role_permissions`, `sessions` | Staff accounts, role-based permissions, server-side login sessions |
| `categories`, `brands`, `suppliers` | Lookup data |
| `products` | One row per sellable SKU: prices, avg cost, stock, reorder/overstock levels, warranty, image. Colour/size/connector variants are separate SKUs linked by `variantGroup`, so stock is tracked at the level that is sold |
| `price_history` | Every change to selling, minimum or buying price, who changed it and why |
| `purchase_orders`, `purchase_items` | Orders to suppliers, ordered/accepted/damaged/missing quantities, unit cost, supplier invoice total and amount paid |
| `goods_receipts`, `goods_receipt_items` | Each physical delivery (partial deliveries allowed) with landed unit cost |
| `supplier_payments` | Payments to suppliers (partial payments allowed) |
| `sales`, `sale_items`, `payments` | Invoices (snapshots), lines with cost, split payments |
| `customers`, `customer_payments` | Optional customer records, credit sales and payments on account |
| `returns`, `return_items`, `refunds` | Returns/exchanges referencing the original sale, refund amounts and methods |
| `stock_movements` | Complete stock ledger |
| `stock_adjustments` | Damaged / lost / supplier return / count corrections with approval status |
| `expenses` | Operating expenses with optional attachment |
| `cash_closings` | Daily drawer reconciliation (expected vs counted, non-cash totals) |
| `warranties` | Warranty per sold line: serial, expiry, claim status, resolution |
| `audit_logs` | Append-only activity log |
| `business_settings` | Shop details, invoice template options, tax |
| `document_sequences` | Gap-free invoice / PO / GRN / return numbers |

Money uses `DECIMAL(12,2)` (average cost `DECIMAL(12,4)`); server arithmetic is done in integer cents.
The required list named `product_variants` and `stock_adjustments` separately; variants are modelled as SKUs (above)
because a variant always needs its own stock, barcode and price.
