<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Categories, brands (same shape and rules) and suppliers. */
class CatalogController
{
    private static function entity(string $table): string
    {
        return $table === 'categories' ? 'category' : 'brand';
    }

    public function lookupIndex(Request $req, string $table): JsonResponse
    {
        Auth::require($req, 'products.view');
        $col = $table === 'categories' ? 'categoryId' : 'brandId';
        $rows = DB::table($table)->orderBy('name')->get()->map(function ($r) use ($table, $col) {
            $out = Fmt::row($table, $r);
            $out['_count'] = ['products' => DB::table('products')->where($col, $r->id)->count()];

            return $out;
        });

        return response()->json($rows->all());
    }

    public function lookupStore(Request $req, string $table): JsonResponse
    {
        Auth::require($req, 'catalog.manage');
        $d = V::check(V::trim($req->all(), ['name']), ['name' => 'required|string|min:2|max:80', 'isActive' => 'sometimes|boolean']);
        $id = Data::insert($table, ['name' => $d['name'], 'isActive' => isset($d['isActive']) ? (int) (bool) $d['isActive'] : 1]);
        Audit::log($req, self::entity($table).'.create', self::entity($table), $id, $req->all());

        return response()->json(Fmt::row($table, DB::table($table)->find($id)), 201);
    }

    public function lookupUpdate(Request $req, string $table, string $id): JsonResponse
    {
        Auth::require($req, 'catalog.manage');
        $id = V::id($id);
        if (! DB::table($table)->where('id', $id)->exists()) {
            throw ApiError::notFound();
        }
        $d = V::check(V::trim($req->all(), ['name']), ['name' => 'sometimes|string|min:2|max:80', 'isActive' => 'sometimes|boolean']);
        if (isset($d['isActive'])) {
            $d['isActive'] = (int) (bool) $d['isActive'];
        }
        if ($d) {
            DB::table($table)->where('id', $id)->update($d);
        }
        Audit::log($req, self::entity($table).'.update', self::entity($table), $id, $req->all());

        return response()->json(Fmt::row($table, DB::table($table)->find($id)));
    }

    /** Balance = supplier invoice totals (not cancelled or draft) minus payments. */
    private static function balances(): array
    {
        $rows = DB::select("SELECT s.id supplierId,
            COALESCE((SELECT SUM(invoiceTotal) FROM purchase_orders po WHERE po.supplierId = s.id AND po.status NOT IN ('CANCELLED','DRAFT')), 0) invoiced,
            COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplierId = s.id), 0) paid FROM suppliers s");
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r->supplierId] = ['invoiced' => (float) $r->invoiced, 'paid' => (float) $r->paid, 'balance' => round((float) $r->invoiced - (float) $r->paid, 2)];
        }

        return $out;
    }

    public function suppliers(Request $req): JsonResponse
    {
        Auth::require($req, 'purchases.view', 'suppliers.manage');
        $bal = self::balances();

        return response()->json(DB::table('suppliers')->orderBy('name')->get()
            ->map(fn ($s) => Fmt::row('suppliers', $s) + ($bal[$s->id] ?? ['invoiced' => 0, 'paid' => 0, 'balance' => 0]))->all());
    }

    public function supplier(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'purchases.view', 'suppliers.manage');
        $id = V::id($id);
        $s = DB::table('suppliers')->find($id);
        if (! $s) {
            throw ApiError::notFound('Supplier not found');
        }
        $out = Fmt::row('suppliers', $s);
        $out['purchases'] = Fmt::rows('purchase_orders', DB::table('purchase_orders')->where('supplierId', $id)->orderByDesc('purchaseDate')->limit(100)->get());
        $out['payments'] = Fmt::rows('supplier_payments', DB::table('supplier_payments')->where('supplierId', $id)->orderByDesc('paidAt')->limit(100)->get());
        $out += self::balances()[$id] ?? [];
        $out['priceHistory'] = array_map(fn ($r) => ['productId' => (int) $r->productId, 'name' => $r->name, 'sku' => $r->sku,
            'unitCost' => Fmt::dec($r->unitCost), 'purchaseDate' => Fmt::iso($r->purchaseDate), 'poNumber' => $r->poNumber],
            DB::select("SELECT p.id productId, p.name, p.sku, pi.unitCost, po.purchaseDate, po.poNumber
                FROM purchase_items pi JOIN purchase_orders po ON po.id = pi.purchaseOrderId JOIN products p ON p.id = pi.productId
                WHERE po.supplierId = ? AND po.status <> 'CANCELLED' ORDER BY po.purchaseDate DESC LIMIT 200", [$id]));

        return response()->json($out);
    }

    private static function supplierRules(bool $partial): array
    {
        $opt = 'sometimes|nullable|string';

        return [
            'name' => ($partial ? 'sometimes' : 'required').'|string|min:2|max:120',
            'contactPerson' => "$opt|max:120", 'phone' => "$opt|max:30",
            'email' => ['sometimes', 'nullable', 'string', 'max:120', fn ($a, $v, $fail) => $v === '' || filter_var($v, FILTER_VALIDATE_EMAIL) || $fail('Invalid email')],
            'address' => "$opt|max:255", 'businessRegNo' => "$opt|max:60", 'notes' => "$opt|max:2000", 'isActive' => 'sometimes|boolean',
        ];
    }

    public function supplierStore(Request $req): JsonResponse
    {
        Auth::require($req, 'suppliers.manage');
        $d = V::check(V::trim($req->all(), ['name']), self::supplierRules(false));
        if (isset($d['isActive'])) {
            $d['isActive'] = (int) (bool) $d['isActive'];
        }
        $id = Data::insert('suppliers', $d, true);
        Audit::log($req, 'supplier.create', 'supplier', $id, ['name' => $d['name']]);

        return response()->json(Fmt::row('suppliers', DB::table('suppliers')->find($id)), 201);
    }

    public function supplierUpdate(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'suppliers.manage');
        $id = V::id($id);
        if (! DB::table('suppliers')->where('id', $id)->exists()) {
            throw ApiError::notFound('Record not found');
        }
        $d = V::check(V::trim($req->all(), ['name']), self::supplierRules(true));
        if (isset($d['isActive'])) {
            $d['isActive'] = (int) (bool) $d['isActive'];
        }
        Data::update('suppliers', $id, $d, true);
        Audit::log($req, 'supplier.update', 'supplier', $id, $req->all());

        return response()->json(Fmt::row('suppliers', DB::table('suppliers')->find($id)));
    }
}
