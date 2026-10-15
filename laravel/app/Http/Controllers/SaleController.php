<?php

namespace App\Http\Controllers;

use App\Services\InvoicePdf;
use App\Services\Sales;
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

class SaleController
{
    /** Cost and profit on a sale are owner data. */
    public static function present(Request $req, array $s): array
    {
        if (Auth::can($req, 'products.view_cost')) {
            return $s;
        }
        unset($s['totalCost']);
        $s['items'] = array_map(fn ($i) => collect($i)->except('unitCost')->all(), $s['items']);
        $s['returns'] = array_map(fn ($r) => collect($r)->except('costReversed')->all(), $s['returns']);

        return $s;
    }

    private static function visible(Request $req, int $id): array
    {
        $s = Sales::full($id);
        if (! $s) {
            throw ApiError::notFound('Sale not found');
        }
        if (! Auth::can($req, 'sales.view_all') && $s['cashierId'] !== Auth::id($req)) {
            throw ApiError::forbidden('You can only open your own sales');
        }

        return $s;
    }

    public function store(Request $req): JsonResponse
    {
        Auth::require($req, 'sales.create');
        $in = V::check($req->all(), Sales::rules());
        ['sale' => $sale, 'duplicate' => $dup] = Sales::create($req, $in);

        return response()->json(['duplicate' => $dup, 'sale' => self::present($req, $sale)], $dup ? 200 : 201);
    }

    public function index(Request $req): JsonResponse
    {
        Auth::require($req, 'sales.view_own', 'sales.view_all');
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string', 'q' => 'sometimes|nullable|string|max:60',
            'status' => 'sometimes|in:COMPLETED,PARTIALLY_RETURNED,RETURNED,VOIDED', 'cashierId' => 'sometimes|integer',
            'method' => 'sometimes|in:CASH,CARD,BANK_TRANSFER,QR,CREDIT', 'limit' => 'sometimes|integer|max:500']);
        $b = DB::table('sales');
        if (! empty($q['q'])) {
            $like = '%'.addcslashes($q['q'], '%_\\').'%';
            $b->where(fn ($w) => $w->where('invoiceNumber', 'like', $like)->orWhere('customerPhone', 'like', $like)->orWhere('customerName', 'like', $like));
        } else {
            $r = Clock::range($q['from'] ?? null, $q['to'] ?? null);
            $b->where('createdAt', '>=', $r['gte'])->where('createdAt', '<', $r['lt']);
        }
        if (! empty($q['status'])) {
            $b->where('status', $q['status']);
        }
        if (! empty($q['method'])) {
            $b->whereExists(fn ($e) => $e->from('payments')->whereColumn('payments.saleId', 'sales.id')->where('payments.method', $q['method']));
        }
        if (! Auth::can($req, 'sales.view_all')) {
            $b->where('cashierId', Auth::id($req));
        } elseif (! empty($q['cashierId'])) {
            $b->where('cashierId', (int) $q['cashierId']);
        }
        $rows = $b->orderByDesc('id')->limit((int) ($q['limit'] ?? 100))
            ->get(['id', 'invoiceNumber', 'status', 'createdAt', 'cashierName', 'customerName', 'customerPhone', 'total', 'balanceDue']);
        $ids = $rows->pluck('id')->all();
        $pays = DB::table('payments')->whereIn('saleId', $ids)->orderBy('id')->get(['saleId', 'method', 'amount'])->groupBy('saleId');
        $counts = DB::table('sale_items')->whereIn('saleId', $ids)->selectRaw('saleId, COUNT(*) c')->groupBy('saleId')->pluck('c', 'saleId');

        return response()->json($rows->map(fn ($s) => Fmt::row('sales', $s) + [
            'payments' => ($pays[$s->id] ?? collect())->map(fn ($p) => ['method' => $p->method, 'amount' => Fmt::dec($p->amount)])->values()->all(),
            '_count' => ['items' => (int) ($counts[$s->id] ?? 0)],
        ])->all());
    }

    public function show(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'sales.view_own', 'sales.view_all');

        return response()->json(self::present($req, self::visible($req, V::id($id))));
    }

    /** Data for the printable receipt (thermal or A4): always the stored snapshot, never current prices. */
    public function receipt(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'sales.view_own', 'sales.view_all', 'sales.create');
        $s = self::present($req, self::visible($req, V::id($id)));
        unset($s['totalCost']);
        $s['items'] = array_map(fn ($i) => collect($i)->except('unitCost')->all(), $s['items']);

        return response()->json(['sale' => $s, 'settings' => Fmt::row('business_settings', Data::settings())]);
    }

    public function pdf(Request $req, string $id)
    {
        Auth::require($req, 'sales.view_own', 'sales.view_all');
        $s = self::visible($req, V::id($id));
        Audit::log($req, 'sale.pdf', 'sale', $s['id']);

        return response(InvoicePdf::render($s, Data::settings()), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="'.$s['invoiceNumber'].'.pdf"',
        ]);
    }

    public function reprint(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'sales.view_own', 'sales.view_all');
        $s = self::visible($req, V::id($id));
        Audit::log($req, 'sale.reprint', 'sale', $s['id'], ['invoiceNumber' => $s['invoiceNumber']]);

        return response()->json(['ok' => true]);
    }

    /** Edits the printed details of a bill (customer, note). Items and money never change here: use void or return. */
    public function details(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'sales.create', 'sales.void');
        $d = V::check($req->all(), ['customerName' => 'sometimes|nullable|string|max:120', 'customerPhone' => 'sometimes|nullable|string|max:30', 'notes' => 'sometimes|nullable|string|max:255']);
        $s = self::visible($req, V::id($id));
        if ($s['status'] === 'VOIDED') {
            throw ApiError::conflict('A voided sale cannot be edited');
        }
        $clean = fn (string $k) => array_key_exists($k, $d) ? (trim((string) $d[$k]) === '' ? null : trim((string) $d[$k])) : false;
        [$name, $phone, $notes] = [$clean('customerName'), $clean('customerPhone'), $clean('notes')];
        $changed = ($name !== false && $name !== $s['customerName']) || ($phone !== false && $phone !== $s['customerPhone']);
        if ($changed && Money::toCents($s['balanceDue']) > 0) {
            throw ApiError::conflict('This bill is on customer credit; its customer cannot be changed', 'CREDIT_CUSTOMER');
        }
        DB::transaction(function () use ($req, $s, $name, $phone, $notes) {
            $data = array_filter(['customerName' => $name, 'customerPhone' => $phone, 'notes' => $notes], fn ($v) => $v !== false);
            if ($phone !== false && $phone !== $s['customerPhone']) {
                if ($phone) {
                    DB::table('customers')->insertOrIgnore(['phone' => $phone, 'name' => ($name ?: null) ?? $s['customerName'] ?? 'Walk-in customer',
                        'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
                    $data['customerId'] = (int) DB::table('customers')->where('phone', $phone)->value('id');
                } else {
                    $data['customerId'] = null;
                }
            }
            if ($data) {
                DB::table('sales')->where('id', $s['id'])->update($data);
            }
            $after = DB::table('sales')->find($s['id']);
            Audit::log($req, 'sale.edit_details', 'sale', $s['id'], [
                'invoiceNumber' => $s['invoiceNumber'],
                'before' => ['customerName' => $s['customerName'], 'customerPhone' => $s['customerPhone'], 'notes' => $s['notes']],
                'after' => ['customerName' => $after->customerName, 'customerPhone' => $after->customerPhone, 'notes' => $after->notes],
            ]);
        });

        return response()->json(self::present($req, Sales::full($s['id'])));
    }

    public function void(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'sales.create', 'sales.void');
        $d = V::check(V::trim($req->all(), ['reason']), ['reason' => 'required|string|min:3|max:255'] + V::APPROVAL);
        $s = self::visible($req, V::id($id));

        return response()->json(self::present($req, Sales::void($req, $s['id'], $d['reason'], $d['approval'] ?? null)));
    }

    public function returnStore(Request $req): JsonResponse
    {
        // any cashier may process a return: customers often come back to a different cashier
        Auth::require($req, 'returns.create', 'returns.approve');
        $in = V::check($req->all(), [
            'saleId' => 'required|integer|min:1', 'items' => 'required|array|min:1', 'items.*.saleItemId' => 'required|integer|min:1',
            'items.*.qty' => 'required|integer|min:1', 'items.*.restock' => 'required|boolean', 'reason' => 'required|string|min:3|max:255',
            'type' => 'sometimes|in:REFUND,EXCHANGE', 'refundMethod' => 'sometimes|in:CASH,CARD,BANK_TRANSFER,QR,CREDIT',
        ] + V::APPROVAL);

        return response()->json(Sales::createReturn($req, $in), 201);
    }

    /** Finds the original sale for a return by its invoice number. */
    public function returnLookup(Request $req): JsonResponse
    {
        Auth::require($req, 'returns.create', 'returns.approve');
        $id = DB::table('sales')->where('invoiceNumber', trim((string) $req->query('invoice', '')))->value('id');
        if (! $id) {
            throw ApiError::notFound('No sale with that invoice number');
        }

        return response()->json(self::present($req, Sales::full((int) $id)));
    }

    public function returnIndex(Request $req): JsonResponse
    {
        Auth::require($req, 'returns.create', 'returns.approve', 'reports.sales');
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string']);
        $r = Clock::range($q['from'] ?? null, $q['to'] ?? null);
        $rows = DB::table('returns')->where('createdAt', '>=', $r['gte'])->where('createdAt', '<', $r['lt'])->orderByDesc('id')->get()->map(function ($ret) {
            $row = Fmt::row('returns', $ret);
            $row['sale'] = ['invoiceNumber' => DB::table('sales')->where('id', $ret->saleId)->value('invoiceNumber')];
            $row['refunds'] = Fmt::rows('refunds', DB::table('refunds')->where('returnId', $ret->id)->get());
            $row['items'] = DB::table('return_items as ri')->join('sale_items as si', 'si.id', '=', 'ri.saleItemId')->where('ri.returnId', $ret->id)
                ->select('ri.*', 'si.productName as _name', 'si.sku as _sku')->get()->map(fn ($i) => Fmt::row('return_items', collect((array) $i)->except(['_name', '_sku'])->all())
                    + ['saleItem' => ['productName' => $i->_name, 'sku' => $i->_sku]])->all();

            return $row;
        });

        return response()->json($rows->all());
    }
}
