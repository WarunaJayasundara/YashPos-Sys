<?php

namespace App\Http\Controllers;

use App\Services\Inventory;
use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PurchaseController
{
    /** Purchase with supplier, items (+product), receipts (+items) and payments. */
    public static function full(int $id): ?array
    {
        $po = DB::table('purchase_orders')->find($id);
        if (! $po) {
            return null;
        }
        $out = Fmt::row('purchase_orders', $po);
        $out['supplier'] = Fmt::row('suppliers', DB::table('suppliers')->find($po->supplierId));
        $out['items'] = DB::table('purchase_items')->where('purchaseOrderId', $id)->orderBy('id')->get()->map(function ($i) {
            $row = Fmt::row('purchase_items', $i);
            $p = DB::table('products')->where('id', $i->productId)->first(['id', 'name', 'sku']);
            $row['product'] = ['id' => (int) $p->id, 'name' => $p->name, 'sku' => $p->sku];

            return $row;
        })->all();
        $out['receipts'] = DB::table('goods_receipts')->where('purchaseOrderId', $id)->orderBy('receivedAt')->get()->map(function ($r) {
            $row = Fmt::row('goods_receipts', $r);
            $row['items'] = Fmt::rows('goods_receipt_items', DB::table('goods_receipt_items')->where('goodsReceiptId', $r->id)->orderBy('id')->get());

            return $row;
        })->all();
        $out['payments'] = Fmt::rows('supplier_payments', DB::table('supplier_payments')->where('purchaseOrderId', $id)->orderBy('paidAt')->get());
        $out['balance'] = Money::fromCents(Money::toCents($po->invoiceTotal) - Money::toCents($po->amountPaid));

        return $out;
    }

    public function index(Request $req): JsonResponse
    {
        Auth::require($req, 'purchases.view');
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string', 'supplierId' => 'sometimes|integer',
            'status' => 'sometimes|in:DRAFT,ORDERED,PARTIALLY_RECEIVED,RECEIVED,CANCELLED', 'q' => 'sometimes|nullable|string']);
        $b = DB::table('purchase_orders as po')->join('suppliers as s', 's.id', '=', 'po.supplierId')->select('po.*', 's.name as _supplier');
        if (! empty($q['from']) || ! empty($q['to'])) {
            $r = Clock::range($q['from'] ?? null, $q['to'] ?? $q['from'] ?? null);
            $b->whereBetween('po.purchaseDate', [Clock::dateValue($r['from']), Clock::dateValue($r['to'])]);
        }
        if (! empty($q['supplierId'])) {
            $b->where('po.supplierId', (int) $q['supplierId']);
        }
        if (! empty($q['status'])) {
            $b->where('po.status', $q['status']);
        }
        if (! empty($q['q'])) {
            $like = '%'.addcslashes($q['q'], '%_\\').'%';
            $b->where(fn ($w) => $w->where('po.poNumber', 'like', $like)->orWhere('po.supplierInvoiceNo', 'like', $like));
        }
        $rows = $b->orderByDesc('po.id')->limit(300)->get()->map(function ($p) {
            $row = Fmt::row('purchase_orders', collect((array) $p)->except('_supplier')->all());
            $row['supplier'] = ['name' => $p->_supplier];
            $row['_count'] = ['items' => DB::table('purchase_items')->where('purchaseOrderId', $p->id)->count()];
            $row['balance'] = Money::fromCents(Money::toCents($p->invoiceTotal) - Money::toCents($p->amountPaid));

            return $row;
        });

        return response()->json($rows->all());
    }

    public function show(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.view');

        return response()->json(self::full(V::id($id)) ?? throw ApiError::notFound('Purchase not found'));
    }

    public function store(Request $req): JsonResponse
    {
        Auth::require($req, 'purchases.manage');
        $d = V::check($req->all(), [
            'supplierId' => 'required|integer|min:1', 'supplierInvoiceNo' => 'sometimes|nullable|string|max:60',
            'purchaseDate' => ['required', 'regex:/^\d{4}-\d{2}-\d{2}$/'], 'notes' => 'sometimes|nullable|string|max:2000',
            'invoiceTotal' => array_merge(['sometimes', 'nullable'], V::MONEY), 'status' => 'sometimes|in:DRAFT,ORDERED',
            'items' => 'required|array|min:1', 'items.*.productId' => 'required|integer|min:1',
            'items.*.qtyOrdered' => 'required|integer|min:1|max:100000', 'items.*.unitCost' => array_merge(['required'], V::MONEY),
        ]);
        if (! DB::table('suppliers')->where('id', $d['supplierId'])->exists()) {
            throw ApiError::badRequest('Supplier not found');
        }
        $pids = array_unique(array_map(fn ($i) => (int) $i['productId'], $d['items']));
        if (count($pids) !== count($d['items'])) {
            throw ApiError::badRequest('Each product may appear once per purchase');
        }
        if (DB::table('products')->whereIn('id', $pids)->count() !== count($pids)) {
            throw ApiError::badRequest('One or more products do not exist');
        }
        $computed = array_sum(array_map(fn ($i) => Money::toCents($i['unitCost']) * (int) $i['qtyOrdered'], $d['items']));
        $id = DB::transaction(function () use ($req, $d, $computed) {
            $year = substr(Clock::localToday(), 0, 4);
            $poNumber = "PO-$year-".str_pad((string) Data::nextSequence("PO-$year"), 5, '0', STR_PAD_LEFT);
            $total = Money::fromCents(isset($d['invoiceTotal']) ? Money::toCents($d['invoiceTotal']) : $computed);
            $id = Data::insert('purchase_orders', [
                'poNumber' => $poNumber, 'supplierId' => (int) $d['supplierId'], 'supplierInvoiceNo' => $d['supplierInvoiceNo'] ?? null,
                'purchaseDate' => Clock::dateValue($d['purchaseDate']), 'notes' => $d['notes'] ?? null, 'status' => $d['status'] ?? 'ORDERED',
                'invoiceTotal' => $total, 'createdById' => Auth::id($req),
            ], true);
            foreach ($d['items'] as $i) {
                DB::table('purchase_items')->insert(['purchaseOrderId' => $id, 'productId' => (int) $i['productId'], 'qtyOrdered' => (int) $i['qtyOrdered'],
                    'unitCost' => Money::fromCents(Money::toCents($i['unitCost']))]);
            }
            Audit::log($req, 'purchase.create', 'purchase', $id, ['poNumber' => $poNumber, 'total' => Fmt::dec($total)]);

            return $id;
        });
        $po = Fmt::row('purchase_orders', DB::table('purchase_orders')->find($id));
        $po['items'] = Fmt::rows('purchase_items', DB::table('purchase_items')->where('purchaseOrderId', $id)->orderBy('id')->get());

        return response()->json($po, 201);
    }

    public function order(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.manage');
        $id = V::id($id);
        $n = DB::table('purchase_orders')->where('id', $id)->where('status', 'DRAFT')->update(['status' => 'ORDERED', 'updatedAt' => Clock::now()]);
        if (! $n) {
            throw ApiError::conflict('Only draft purchases can be marked as ordered');
        }
        Audit::log($req, 'purchase.order', 'purchase', $id);

        return response()->json(['ok' => true]);
    }

    /** Stock only increases here: accepted = received - damaged. Extra costs are allocated by value (landed cost). */
    public function receive(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.manage');
        $id = V::id($id);
        $po = DB::table('purchase_orders')->find($id);
        if (! $po) {
            throw ApiError::notFound('Purchase not found');
        }
        $d = V::check($req->all(), [
            'additionalCost' => array_merge(['sometimes'], V::MONEY), 'notes' => 'sometimes|nullable|string|max:2000',
            'items' => 'required|array|min:1', 'items.*.purchaseItemId' => 'required|integer|min:1', 'items.*.qtyReceived' => 'required|integer|min:0',
            'items.*.qtyDamaged' => 'sometimes|integer|min:0', 'items.*.qtyMissing' => 'sometimes|integer|min:0',
        ]);
        $additional = $d['additionalCost'] ?? 0;
        if (! in_array($po->status, ['ORDERED', 'PARTIALLY_RECEIVED'], true)) {
            throw ApiError::conflict('Cannot receive against a '.strtolower($po->status).' purchase');
        }
        $byId = DB::table('purchase_items as pi')->join('products as p', 'p.id', '=', 'pi.productId')->where('pi.purchaseOrderId', $id)
            ->select('pi.*', 'p.name as productName', 'p.purchasePrice as productPurchasePrice')->get()->keyBy('id');
        $lines = [];
        foreach ($d['items'] as $r) {
            $r += ['qtyDamaged' => 0, 'qtyMissing' => 0];
            $pi = $byId[(int) $r['purchaseItemId']] ?? null;
            if (! $pi) {
                throw ApiError::badRequest('Line does not belong to this purchase');
            }
            if ($r['qtyDamaged'] > $r['qtyReceived']) {
                throw ApiError::badRequest("Damaged quantity of {$pi->productName} exceeds quantity received");
            }
            $settled = $pi->qtyReceived + $pi->qtyDamaged + $pi->qtyMissing;
            if ($settled + $r['qtyReceived'] + $r['qtyMissing'] > $pi->qtyOrdered) {
                throw ApiError::badRequest("{$pi->productName}: only ".($pi->qtyOrdered - $settled).' unit(s) are still outstanding');
            }
            $lines[] = ['r' => array_map('intval', $r), 'pi' => $pi, 'accepted' => (int) $r['qtyReceived'] - (int) $r['qtyDamaged']];
        }
        if (! array_filter($lines, fn ($l) => $l['r']['qtyReceived'] !== 0 || $l['r']['qtyMissing'] !== 0)) {
            throw ApiError::badRequest('Nothing to receive');
        }
        $extra = Money::allocate(Money::toCents($additional), array_map(fn ($l) => $l['accepted'] * Money::toCents($l['pi']->unitCost), $lines));

        DB::transaction(function () use ($req, $po, $lines, $extra, $additional, $d) {
            $year = substr(Clock::localToday(), 0, 4);
            $grnNo = "GRN-$year-".str_pad((string) Data::nextSequence("GRN-$year"), 5, '0', STR_PAD_LEFT);
            $grn = (int) DB::table('goods_receipts')->insertGetId(['receiptNumber' => $grnNo, 'purchaseOrderId' => $po->id, 'receivedAt' => Clock::now(),
                'additionalCost' => Money::fromCents(Money::toCents($additional)), 'notes' => $d['notes'] ?? null, 'receivedById' => Auth::id($req)]);
            foreach ($lines as $i => ['r' => $r, 'pi' => $pi, 'accepted' => $accepted]) {
                $base = (float) $pi->unitCost;
                $landed = $accepted > 0 ? $base + $extra[$i] / 100 / $accepted : $base;
                DB::table('goods_receipt_items')->insert(['goodsReceiptId' => $grn, 'purchaseItemId' => $pi->id, 'qtyReceived' => $r['qtyReceived'],
                    'qtyDamaged' => $r['qtyDamaged'], 'qtyMissing' => $r['qtyMissing'], 'qtyAccepted' => $accepted, 'landedUnitCost' => number_format($landed, 4, '.', '')]);
                DB::table('purchase_items')->where('id', $pi->id)->update(['qtyReceived' => DB::raw('qtyReceived + '.$accepted),
                    'qtyDamaged' => DB::raw('qtyDamaged + '.$r['qtyDamaged']), 'qtyMissing' => DB::raw('qtyMissing + '.$r['qtyMissing'])]);
                if ($accepted > 0) {
                    Inventory::move(['productId' => (int) $pi->productId, 'qtyChange' => $accepted, 'type' => 'PURCHASE_RECEIPT', 'unitCost' => $landed,
                        'updateAverage' => true, 'userId' => Auth::id($req), 'refType' => 'GRN', 'refId' => $grn, 'reason' => $po->poNumber]);
                    if (Money::toCents($pi->productPurchasePrice) !== Money::toCents($pi->unitCost)) {
                        Data::insert('price_history', ['productId' => $pi->productId, 'field' => 'purchasePrice', 'oldValue' => $pi->productPurchasePrice,
                            'newValue' => $pi->unitCost, 'changedById' => Auth::id($req), 'reason' => $po->poNumber]);
                        Data::update('products', (int) $pi->productId, ['purchasePrice' => $pi->unitCost, 'supplierId' => $po->supplierId], true);
                    }
                }
            }
            $done = DB::table('purchase_items')->where('purchaseOrderId', $po->id)->whereRaw('qtyReceived + qtyDamaged + qtyMissing < qtyOrdered')->doesntExist();
            Data::update('purchase_orders', (int) $po->id, ['status' => $done ? 'RECEIVED' : 'PARTIALLY_RECEIVED'], true);
            Audit::log($req, 'purchase.receive', 'purchase', $po->id, ['grn' => $grnNo, 'lines' => $d['items'], 'additionalCost' => $additional]);
        });

        return response()->json(self::full($id));
    }

    public function invoice(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.manage');
        $id = V::id($id);
        $d = V::check($req->all(), ['supplierInvoiceNo' => 'sometimes|nullable|string|max:60', 'invoiceTotal' => 'sometimes|numeric|min:0', 'notes' => 'sometimes|nullable|string|max:2000']);
        $po = DB::table('purchase_orders')->find($id);
        if (! $po) {
            throw ApiError::notFound();
        }
        if (isset($d['invoiceTotal']) && Money::toCents($d['invoiceTotal']) < Money::toCents($po->amountPaid)) {
            throw ApiError::badRequest('Invoice total cannot be less than the amount already paid');
        }
        if (isset($d['invoiceTotal'])) {
            $d['invoiceTotal'] = Money::fromCents(Money::toCents($d['invoiceTotal']));
        }
        Data::update('purchase_orders', $id, $d, true);
        Audit::log($req, 'purchase.update_invoice', 'purchase', $id, $req->only(['supplierInvoiceNo', 'invoiceTotal', 'notes']));

        return response()->json(Fmt::row('purchase_orders', DB::table('purchase_orders')->find($id)));
    }

    public function cancel(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.manage');
        $id = V::id($id);
        if (! DB::table('purchase_orders')->where('id', $id)->exists()) {
            throw ApiError::notFound();
        }
        if (DB::table('goods_receipts')->where('purchaseOrderId', $id)->exists() || DB::table('supplier_payments')->where('purchaseOrderId', $id)->exists()) {
            throw ApiError::conflict('Purchases with receipts or payments cannot be cancelled');
        }
        Data::update('purchase_orders', $id, ['status' => 'CANCELLED'], true);
        Audit::log($req, 'purchase.cancel', 'purchase', $id);

        return response()->json(['ok' => true]);
    }

    public function pay(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.pay');
        $id = V::id($id);
        $d = V::check($req->all(), ['amount' => 'required|numeric|gt:0', 'method' => 'required|in:CASH,CARD,BANK_TRANSFER,QR',
            'reference' => 'sometimes|nullable|string|max:80', 'paidAt' => 'sometimes|nullable|date']);
        $pay = DB::transaction(function () use ($req, $id, $d) {
            $po = DB::selectOne('SELECT invoiceTotal, amountPaid, supplierId, status FROM purchase_orders WHERE id = ? FOR UPDATE', [$id]);
            if (! $po) {
                throw ApiError::notFound();
            }
            if ($po->status === 'CANCELLED') {
                throw ApiError::conflict('Cannot pay a cancelled purchase');
            }
            $outstanding = Money::toCents($po->invoiceTotal) - Money::toCents($po->amountPaid);
            $amt = Money::toCents($d['amount']);
            if ($amt > $outstanding) {
                throw ApiError::badRequest('Payment exceeds the outstanding balance of '.Money::fromCents($outstanding));
            }
            $paidAt = ! empty($d['paidAt']) ? Clock::db((float) strtotime($d['paidAt'])) : Clock::now();
            $pid = (int) DB::table('supplier_payments')->insertGetId(['supplierId' => (int) $po->supplierId, 'purchaseOrderId' => $id,
                'amount' => Money::fromCents($amt), 'method' => $d['method'], 'reference' => $d['reference'] ?? null, 'paidAt' => $paidAt, 'recordedById' => Auth::id($req)]);
            Data::update('purchase_orders', $id, ['amountPaid' => Money::fromCents(Money::toCents($po->amountPaid) + $amt)], true);
            Audit::log($req, 'purchase.payment', 'purchase', $id, ['amount' => Money::fromCents($amt), 'method' => $d['method']]);

            return $pid;
        });

        return response()->json(Fmt::row('supplier_payments', DB::table('supplier_payments')->find($pay)), 201);
    }
}
