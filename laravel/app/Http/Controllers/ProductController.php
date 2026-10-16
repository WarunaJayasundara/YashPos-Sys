<?php

namespace App\Http\Controllers;

use App\Services\Inventory;
use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Csv;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ProductController
{
    /** EAN-8/UPC-A/EAN-13 need a valid check digit; other codes (Code 128 etc.) just need safe characters. */
    public static function validBarcode(string $code): bool
    {
        if (preg_match('/^\d{8}$|^\d{12}$|^\d{13}$/', $code)) {
            $d = array_map('intval', str_split($code));
            $check = array_pop($d);
            $sum = 0;
            foreach (array_reverse($d) as $i => $n) {
                $sum += $n * ($i % 2 === 0 ? 3 : 1);
            }

            return (10 - ($sum % 10)) % 10 === $check;
        }

        return (bool) preg_match('/^[A-Za-z0-9\-.]{4,40}$/', $code);
    }

    private const STRINGS = ['sku', 'barcode', 'name', 'variantGroup', 'compatibility', 'color', 'size', 'connectorType'];

    private static function rules(bool $partial): array
    {
        $req = $partial ? 'sometimes' : 'required';
        $opt = fn (string $more) => array_merge(['sometimes', 'nullable'], explode('|', $more));

        return [
            'sku' => array_merge($opt('string|max:40'), [function ($a, $v, $fail) {
                if ($v !== '' && ! preg_match('/^[A-Za-z0-9\-_.]{2,40}$/', $v)) {
                    $fail('SKU may contain letters, digits, - _ .');
                }
            }]),
            'barcode' => array_merge($opt('string|max:40'), [function ($a, $v, $fail) {
                if ($v !== '' && ! self::validBarcode($v)) {
                    $fail('Barcode is not valid (check digit or characters)');
                }
            }]),
            'name' => [$req, 'string', 'min:2', 'max:160'],
            'description' => $opt('string|max:5000'),
            'categoryId' => $opt('integer|min:1'), 'brandId' => $opt('integer|min:1'), 'supplierId' => $opt('integer|min:1'),
            'variantGroup' => $opt('string|max:60'), 'compatibility' => $opt('string|max:255'),
            'color' => $opt('string|max:40'), 'size' => $opt('string|max:40'), 'connectorType' => $opt('string|max:40'),
            'purchasePrice' => array_merge(['sometimes'], V::MONEY),
            'sellingPrice' => array_merge([$req], V::MONEY),
            'minSellingPrice' => array_merge(['sometimes', 'nullable'], V::MONEY),
            'reorderLevel' => 'sometimes|integer|min:0|max:100000',
            'maxStockLevel' => $opt('integer|min:0|max:1000000'),
            'warrantyMonths' => 'sometimes|integer|min:0|max:120',
            'imageUrl' => $opt('string|max:255'),
            'isActive' => 'sometimes|boolean',
        ];
    }

    public static function stockStatus(object $p): string
    {
        $avail = $p->qtyOnHand - $p->qtyReserved;
        if ($avail <= 0) {
            return 'OUT';
        }
        if ($avail <= $p->reorderLevel) {
            return 'LOW';
        }
        if ($p->maxStockLevel !== null && $p->qtyOnHand > $p->maxStockLevel) {
            return 'OVER';
        }

        return 'OK';
    }

    /** Next free automatic SKU, e.g. P-00042 (skips any taken by hand). Call inside a transaction. */
    public static function generateSku(): string
    {
        while (true) {
            $sku = 'P-'.str_pad((string) Data::nextSequence('SKU'), 5, '0', STR_PAD_LEFT);
            if (! DB::table('products')->where('sku', $sku)->exists()) {
                return $sku;
            }
        }
    }

    private static function query()
    {
        return DB::table('products as p')
            ->leftJoin('categories as c', 'c.id', '=', 'p.categoryId')
            ->leftJoin('brands as b', 'b.id', '=', 'p.brandId')
            ->leftJoin('suppliers as s', 's.id', '=', 'p.supplierId')
            ->select('p.*', 'c.name as _category', 'b.name as _brand', 's.name as _supplier');
    }

    private static function find(int $id): ?object
    {
        return self::query()->where('p.id', $id)->first();
    }

    /** Hides cost and margin from users without products.view_cost. */
    public static function present(Request $req, object $p): array
    {
        $f = Fmt::row('products', collect((array) $p)->except(['_category', '_brand', '_supplier'])->all());
        $out = [
            'id' => $f['id'], 'sku' => $f['sku'], 'barcode' => $f['barcode'], 'name' => $f['name'], 'description' => $f['description'],
            'categoryId' => $f['categoryId'], 'category' => $p->_category ?? null, 'brandId' => $f['brandId'], 'brand' => $p->_brand ?? null,
            'variantGroup' => $f['variantGroup'], 'compatibility' => $f['compatibility'], 'color' => $f['color'], 'size' => $f['size'],
            'connectorType' => $f['connectorType'], 'sellingPrice' => $f['sellingPrice'], 'minSellingPrice' => $f['minSellingPrice'],
            'qtyOnHand' => $f['qtyOnHand'], 'qtyReserved' => $f['qtyReserved'], 'qtyAvailable' => $f['qtyOnHand'] - $f['qtyReserved'],
            'reorderLevel' => $f['reorderLevel'], 'maxStockLevel' => $f['maxStockLevel'], 'warrantyMonths' => $f['warrantyMonths'],
            'imageUrl' => $f['imageUrl'], 'isActive' => $f['isActive'], 'stockStatus' => self::stockStatus($p),
            'createdAt' => $f['createdAt'], 'updatedAt' => $f['updatedAt'],
        ];
        // like the original API, a missing category or brand name is left out
        $out = array_filter($out, fn ($v, $k) => ! (in_array($k, ['category', 'brand'], true) && $v === null), ARRAY_FILTER_USE_BOTH);
        if (! Auth::can($req, 'products.view_cost')) {
            return $out;
        }
        $sell = (float) $p->sellingPrice;
        $cost = (float) $p->avgCost;

        return $out + [
            'supplierId' => $f['supplierId'], ...($p->_supplier === null ? [] : ['supplier' => $p->_supplier]), 'purchasePrice' => $f['purchasePrice'], 'avgCost' => $f['avgCost'],
            'unitProfit' => Money::fromCents(Money::toCents($sell) - Money::toCents($cost)),
            'marginPercent' => $sell > 0 ? round(($sell - $cost) / $sell * 100, 1) : null,
        ];
    }

    private static function listQuery(Request $req): array
    {
        return V::check($req->query(), [
            'q' => 'sometimes|nullable|string|max:100', 'categoryId' => 'sometimes|integer', 'brandId' => 'sometimes|integer',
            'supplierId' => 'sometimes|integer', 'status' => 'sometimes|in:LOW,OUT,OVER,OK', 'active' => 'sometimes|in:true,false,all',
            'page' => 'sometimes|integer|min:1', 'pageSize' => 'sometimes|integer|min:1|max:500', 'sort' => 'sometimes|in:name,sku,qty,updated,price',
        ]) + ['active' => 'true', 'page' => 1, 'pageSize' => 50, 'sort' => 'name'];
    }

    private static function filtered(array $q)
    {
        $b = self::query();
        if ($q['active'] !== 'all') {
            $b->where('p.isActive', $q['active'] === 'true' ? 1 : 0);
        }
        foreach (['categoryId', 'brandId', 'supplierId'] as $k) {
            if (! empty($q[$k])) {
                $b->where("p.$k", (int) $q[$k]);
            }
        }
        if (! empty($q['q'])) {
            $s = trim($q['q']);
            $like = '%'.addcslashes($s, '%_\\').'%';
            $b->where(fn ($w) => $w->where('p.name', 'like', $like)->orWhere('p.sku', 'like', $like)->orWhere('p.barcode', $s)
                ->orWhere('p.compatibility', 'like', $like)->orWhere('b.name', 'like', $like)->orWhere('p.connectorType', 'like', $like)
                ->orWhere('p.color', 'like', $like));
        }
        if (! empty($q['status'])) {
            $b->whereRaw([
                'OUT' => 'p.qtyOnHand - p.qtyReserved <= 0',
                'LOW' => 'p.qtyOnHand - p.qtyReserved > 0 AND p.qtyOnHand - p.qtyReserved <= p.reorderLevel',
                'OVER' => 'p.maxStockLevel IS NOT NULL AND p.qtyOnHand > p.maxStockLevel AND p.qtyOnHand - p.qtyReserved > p.reorderLevel',
                'OK' => 'p.qtyOnHand - p.qtyReserved > p.reorderLevel AND (p.maxStockLevel IS NULL OR p.qtyOnHand <= p.maxStockLevel)',
            ][$q['status']]);
        }
        [$col, $dir] = ['name' => ['p.name', 'asc'], 'sku' => ['p.sku', 'asc'], 'qty' => ['p.qtyOnHand', 'asc'],
            'updated' => ['p.updatedAt', 'desc'], 'price' => ['p.sellingPrice', 'asc']][$q['sort']];

        return $b->orderBy($col, $dir)->orderBy('p.id');
    }

    public function index(Request $req): JsonResponse
    {
        Auth::require($req, 'products.view');
        $q = self::listQuery($req);
        $b = self::filtered($q);
        $total = (clone $b)->count();
        $rows = $b->forPage((int) $q['page'], (int) $q['pageSize'])->get();

        return response()->json(['total' => $total, 'page' => (int) $q['page'], 'pageSize' => (int) $q['pageSize'],
            'data' => $rows->map(fn ($p) => self::present($req, $p))->all()]);
    }

    /** Lightweight catalogue for POS search and the offline cache: never any cost fields. */
    public function catalog(Request $req): JsonResponse
    {
        Auth::require($req, 'products.view');
        $rows = self::query()->where('p.isActive', 1)->orderBy('p.name')->get();

        return response()->json(['syncedAt' => gmdate('Y-m-d\TH:i:s.v\Z'), 'data' => $rows->map(fn ($p) => [
            'id' => (int) $p->id, 'sku' => $p->sku, 'barcode' => $p->barcode, 'name' => $p->name, ...($p->_brand === null ? [] : ['brand' => $p->_brand]),
            'category' => $p->_category, 'categoryId' => $p->categoryId === null ? null : (int) $p->categoryId,
            'compatibility' => $p->compatibility, 'color' => $p->color, 'connectorType' => $p->connectorType,
            'sellingPrice' => Fmt::dec($p->sellingPrice), 'minSellingPrice' => Fmt::dec($p->minSellingPrice),
            'qtyAvailable' => $p->qtyOnHand - $p->qtyReserved, 'warrantyMonths' => (int) $p->warrantyMonths, 'imageUrl' => $p->imageUrl,
        ])->all()]);
    }

    public function export(Request $req)
    {
        Auth::require($req, 'products.manage');
        $data = self::filtered(self::listQuery($req))->get()->map(fn ($p) => self::present($req, $p))->all();
        $cols = ['sku', 'barcode', 'name', 'category', 'brand', 'compatibility', 'color', 'size', 'connectorType', 'sellingPrice', 'minSellingPrice', 'qtyOnHand', 'reorderLevel', 'warrantyMonths', 'isActive'];
        if (Auth::can($req, 'products.view_cost')) {
            array_splice($cols, 9, 0, ['supplier', 'purchasePrice', 'avgCost']);
        }

        return Csv::response('products.csv', Csv::make($data, array_map(fn ($k) => ['key' => $k, 'label' => $k], $cols)));
    }

    /** Validated product fields for create (defaults applied). */
    private static function validateNew(array $input): array
    {
        $input = V::trim($input, self::STRINGS);
        $d = V::check($input, self::rules(false) + ['openingStock' => 'sometimes|integer|min:0|max:1000000']);
        if (isset($d['minSellingPrice']) && $d['minSellingPrice'] !== null && (float) $d['minSellingPrice'] > (float) $d['sellingPrice']) {
            throw new ApiError(422, 'Validation failed', 'VALIDATION', ['formErrors' => [], 'fieldErrors' => ['minSellingPrice' => ['Minimum price cannot exceed the selling price']]]);
        }

        return $d + ['purchasePrice' => 0, 'reorderLevel' => 5, 'warrantyMonths' => 0, 'isActive' => true, 'openingStock' => 0];
    }

    /** Row values for the products table from validated input. */
    private static function columns(array $d): array
    {
        $out = [];
        foreach (['barcode', 'name', 'description', 'categoryId', 'brandId', 'supplierId', 'variantGroup', 'compatibility', 'color', 'size',
            'connectorType', 'reorderLevel', 'maxStockLevel', 'warrantyMonths', 'imageUrl'] as $k) {
            if (array_key_exists($k, $d)) {
                $out[$k] = $d[$k] === '' && $k !== 'name' ? ($k === 'barcode' ? null : $d[$k]) : $d[$k];
            }
        }
        foreach (['purchasePrice', 'sellingPrice', 'minSellingPrice'] as $k) {
            if (array_key_exists($k, $d) && $d[$k] !== null) {
                $out[$k] = Money::fromCents(Money::toCents($d[$k]));
            }
        }
        if (array_key_exists('isActive', $d)) {
            $out['isActive'] = filter_var($d['isActive'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }

        return $out;
    }

    public function store(Request $req): JsonResponse
    {
        Auth::require($req, 'products.manage');
        $d = self::validateNew($req->all());
        $id = DB::transaction(function () use ($req, $d) {
            $row = self::columns($d);
            $row['sku'] = ! empty($d['sku']) ? strtoupper($d['sku']) : self::generateSku();
            $row['minSellingPrice'] = $row['minSellingPrice'] ?? $row['sellingPrice'];
            $row['avgCost'] = $row['purchasePrice'];
            $id = Data::insert('products', $row, true);
            $opening = (int) $d['openingStock'];
            if ($opening > 0) {
                Inventory::move(['productId' => $id, 'qtyChange' => $opening, 'type' => 'OPENING', 'unitCost' => (float) $d['purchasePrice'],
                    'updateAverage' => true, 'userId' => Auth::id($req), 'reason' => 'Opening stock']);
            }
            Audit::log($req, 'product.create', 'product', $id, ['sku' => $row['sku'], 'openingStock' => $opening]);

            return $id;
        });

        return response()->json(self::present($req, self::find($id)), 201);
    }

    public function update(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'products.manage');
        $id = V::id($id);
        $existing = DB::table('products')->where('id', $id)->first();
        if (! $existing) {
            throw ApiError::notFound('Product not found');
        }
        $input = V::trim($req->all(), self::STRINGS);
        $d = V::check($input, self::rules(true) + ['priceChangeReason' => 'sometimes|nullable|string|max:200'] + V::APPROVAL);
        $data = self::columns($d);
        if (! empty($d['sku'])) {
            $data['sku'] = strtoupper($d['sku']);
        }
        $sell = isset($data['sellingPrice']) ? (float) $data['sellingPrice'] : (float) $existing->sellingPrice;
        if (array_key_exists('minSellingPrice', $d) && $d['minSellingPrice'] === null) {
            $data['minSellingPrice'] = Money::fromCents(Money::toCents($sell)); // cleared: no separate minimum
        }
        $min = isset($data['minSellingPrice']) ? (float) $data['minSellingPrice'] : (float) $existing->minSellingPrice;
        if ($min > $sell) {
            throw ApiError::badRequest('Minimum price cannot exceed the selling price');
        }
        $priceFields = array_values(array_filter(['sellingPrice', 'minSellingPrice', 'purchasePrice'],
            fn ($f) => isset($data[$f]) && Money::toCents($data[$f]) !== Money::toCents($existing->$f)));
        if (array_diff($priceFields, ['purchasePrice']) && ! Auth::can($req, 'prices.change')) {
            Auth::approval($req, 'prices.change', $d['approval'] ?? null, 'Changing selling prices');
        }
        if (isset($data['purchasePrice']) && ! Auth::can($req, 'products.view_cost')) {
            unset($data['purchasePrice']);
            $priceFields = array_values(array_diff($priceFields, ['purchasePrice']));
        }
        DB::transaction(function () use ($req, $id, $existing, $data, $priceFields, $d) {
            foreach ($priceFields as $f) {
                Data::insert('price_history', ['productId' => $id, 'field' => $f, 'oldValue' => $existing->$f, 'newValue' => $data[$f],
                    'changedById' => Auth::id($req), 'reason' => $d['priceChangeReason'] ?? null]);
            }
            Data::update('products', $id, $data, true);
            Audit::log($req, 'product.update', 'product', $id, ['changed' => array_keys($data), 'priceFields' => $priceFields]);
        });

        return response()->json(self::present($req, self::find($id)));
    }

    public function show(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'products.view');
        $id = V::id($id);
        $p = self::find($id);
        if (! $p) {
            throw ApiError::notFound('Product not found');
        }
        $out = self::present($req, $p);
        if (Auth::can($req, 'products.view_cost')) {
            $sold = DB::selectOne("SELECT SUM(si.qty - si.qtyReturned) qty, SUM((si.lineTotal - si.allocatedBillDiscount) * (si.qty - si.qtyReturned) / si.qty) revenue,
                SUM(si.unitCost * (si.qty - si.qtyReturned)) cogs FROM sale_items si JOIN sales s ON s.id = si.saleId WHERE si.productId = ? AND s.status <> 'VOIDED'", [$id]);
            $received = DB::scalar("SELECT SUM(qtyChange) FROM stock_movements WHERE productId = ? AND type = 'PURCHASE_RECEIPT'", [$id]);
            $revenue = (float) $sold->revenue;
            $cogs = (float) $sold->cogs;
            $out['lifetime'] = [
                'unitsSold' => (int) $sold->qty, 'unitsReceived' => (int) $received,
                'netRevenue' => Money::fixed($revenue), 'cogs' => Money::fixed($cogs), 'grossProfit' => Money::fixed($revenue - $cogs),
                'potentialProfitOnStock' => Money::fixed(((float) $p->sellingPrice - (float) $p->avgCost) * $p->qtyOnHand),
            ];
            $out['priceHistory'] = Fmt::rows('price_history', DB::table('price_history')->where('productId', $id)->orderByDesc('createdAt')->limit(50)->get());
        }
        $out['variants'] = $p->variantGroup
            ? DB::table('products')->where('variantGroup', $p->variantGroup)->where('id', '<>', $id)->get(['id', 'name', 'sku', 'color', 'size', 'qtyOnHand'])
                ->map(fn ($v) => Fmt::row('products', $v))->all()
            : [];

        return response()->json($out);
    }

    public function movements(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'stock.view');
        $rows = Fmt::rows('stock_movements', DB::table('stock_movements')->where('productId', V::id($id))->orderByDesc('id')->limit(200)->get());
        if (! Auth::can($req, 'products.view_cost')) {
            $rows = array_map(fn ($m) => collect($m)->except('unitCost')->all(), $rows);
        }

        return response()->json(StockController::withUndo($rows));
    }

    /** Deletes a product added by mistake. Anything sold or purchased stays (deactivate it instead) so records remain true. */
    public function destroy(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'products.delete');
        $id = V::id($id);
        $p = DB::table('products')->find($id);
        if (! $p) {
            throw ApiError::notFound('Product not found');
        }
        if (DB::table('sale_items')->where('productId', $id)->exists() || DB::table('purchase_items')->where('productId', $id)->exists()) {
            throw ApiError::conflict("{$p->name} has sales or purchases, so it cannot be deleted. Deactivate it instead (Edit, then untick Active): it disappears from the POS but its history stays.", 'HAS_HISTORY');
        }
        DB::transaction(function () use ($req, $id, $p) {
            foreach (['stock_alerts', 'stock_movements', 'stock_adjustments', 'price_history', 'warranties'] as $t) {
                DB::table($t)->where('productId', $id)->delete();
            }
            DB::table('products')->where('id', $id)->delete();
            Audit::log($req, 'product.delete', 'product', $id, ['sku' => $p->sku, 'name' => $p->name, 'qtyOnHand' => (int) $p->qtyOnHand]);
        });

        return response()->json(['ok' => true]);
    }

    public function uploadImage(Request $req): JsonResponse
    {
        Auth::require($req, 'products.manage');
        $f = $req->file('image');
        if (! $f || ! $f->isValid() || $f->getSize() > 3 * 1024 * 1024 || ! in_array($f->getMimeType(), ['image/png', 'image/jpeg', 'image/webp'], true)) {
            throw ApiError::badRequest('Upload a PNG, JPG or WEBP image up to 3 MB');
        }
        $name = Str::uuid().'.'.(['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'][$f->getMimeType()]);
        $f->move(public_path('uploads'), $name);

        return response()->json(['url' => "/uploads/$name"]);
    }

    /**
     * CSV import. Only name and sellingPrice are required. Existing SKUs are updated (prices go through price history);
     * rows without a SKU get an automatic one. All-or-nothing.
     */
    public function import(Request $req): JsonResponse
    {
        Auth::require($req, 'products.manage');
        $file = $req->file('file');
        if (! $file || ! $file->isValid() || $file->getSize() > 2 * 1024 * 1024) {
            throw ApiError::badRequest('Attach a CSV file');
        }
        $rows = Csv::parse(file_get_contents($file->getRealPath()));
        if (! $rows) {
            throw ApiError::badRequest('The file has no data rows');
        }
        if (count($rows) > 5000) {
            throw ApiError::badRequest('Import at most 5000 rows at a time');
        }
        $errors = [];
        $parsed = [];
        foreach ($rows as $i => $r) {
            $n = fn (string $k) => ($r[$k] ?? '') === '' ? null : $r[$k];
            $cand = array_filter([
                'sku' => $r['sku'] ?? '' ?: null, 'name' => $r['name'] ?? '', 'barcode' => ($r['barcode'] ?? '') ?: null,
                'compatibility' => ($r['compatibility'] ?? '') ?: null, 'color' => ($r['color'] ?? '') ?: null, 'size' => ($r['size'] ?? '') ?: null,
                'connectorType' => ($r['connectorType'] ?? '') ?: null, 'purchasePrice' => $n('purchasePrice') ?? 0,
                'sellingPrice' => $n('sellingPrice'), 'minSellingPrice' => $n('minSellingPrice') ?? $n('sellingPrice'),
                'reorderLevel' => $n('reorderLevel') ?? 5, 'warrantyMonths' => $n('warrantyMonths') ?? 0, 'openingStock' => $n('openingStock') ?? 0,
            ], fn ($v) => $v !== null);
            try {
                $parsed[] = ['r' => $r, 'v' => self::validateNew($cand)];
            } catch (ApiError $e) {
                $msgs = [];
                foreach ($e->details['fieldErrors'] ?? [] as $k => $m) {
                    $msgs[] = "$k: ".implode(', ', $m);
                }
                $errors[] = ['row' => $i + 2, 'message' => implode('; ', $msgs) ?: $e->getMessage()];
                $parsed[] = ['r' => $r, 'v' => null];
            }
        }
        $skus = array_map(fn ($p) => ($p['r']['sku'] ?? '') !== '' ? strtoupper($p['r']['sku']) : null, $parsed);
        foreach ($skus as $i => $s) {
            if ($s && array_search($s, $skus, true) !== $i) {
                $errors[] = ['row' => $i + 2, 'message' => "Duplicate SKU $s in file"];
            }
        }
        if ($errors) {
            return response()->json(['error' => ['code' => 'IMPORT_INVALID', 'message' => count($errors).' problem(s) found; nothing imported', 'details' => array_slice($errors, 0, 100)]], 422);
        }
        [$created, $updated] = DB::transaction(function () use ($req, $parsed) {
            $created = $updated = 0;
            $lookup = function (string $table, string $name) {
                DB::table($table)->insertOrIgnore(['name' => $name, 'isActive' => 1, 'createdAt' => Clock::now()]);

                return (int) DB::table($table)->where('name', $name)->value('id');
            };
            foreach ($parsed as ['r' => $r, 'v' => $v]) {
                $data = self::columns($v);
                $data['minSellingPrice'] = $data['minSellingPrice'] ?? $data['sellingPrice'];
                $data['categoryId'] = ($r['category'] ?? '') !== '' ? $lookup('categories', $r['category']) : null;
                $data['brandId'] = ($r['brand'] ?? '') !== '' ? $lookup('brands', $r['brand']) : null;
                $sku = ! empty($v['sku']) ? strtoupper($v['sku']) : null;
                $existing = $sku ? DB::table('products')->where('sku', $sku)->first() : null;
                if ($existing) {
                    foreach (['sellingPrice', 'minSellingPrice'] as $f) {
                        if (Money::toCents($existing->$f) !== Money::toCents($data[$f])) {
                            Data::insert('price_history', ['productId' => $existing->id, 'field' => $f, 'oldValue' => $existing->$f, 'newValue' => $data[$f],
                                'changedById' => Auth::id($req), 'reason' => 'CSV import']);
                        }
                    }
                    Data::update('products', (int) $existing->id, $data, true);
                    $updated++;
                } else {
                    $data['sku'] = $sku ?? self::generateSku();
                    $data['avgCost'] = $data['purchasePrice'];
                    $pid = Data::insert('products', $data, true);
                    if ((int) $v['openingStock'] > 0) {
                        Inventory::move(['productId' => $pid, 'qtyChange' => (int) $v['openingStock'], 'type' => 'OPENING', 'unitCost' => (float) $data['purchasePrice'],
                            'updateAverage' => true, 'userId' => Auth::id($req), 'reason' => 'CSV import']);
                    }
                    $created++;
                }
            }
            Audit::log($req, 'product.import', 'product', null, ['created' => $created, 'updated' => $updated]);

            return [$created, $updated];
        });

        return response()->json(['created' => $created, 'updated' => $updated]);
    }
}
