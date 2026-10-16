<?php

namespace App\Http\Controllers;

use App\Services\Inventory;
use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Fmt;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class StockController
{
    public function movements(Request $req): JsonResponse
    {
        Auth::require($req, 'stock.view');
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string', 'productId' => 'sometimes|integer',
            'type' => 'sometimes|string', 'userId' => 'sometimes|integer', 'limit' => 'sometimes|integer|max:1000']);
        $b = DB::table('stock_movements as m')->join('products as p', 'p.id', '=', 'm.productId')->select('m.*', 'p.name as _name', 'p.sku as _sku');
        if (! empty($q['from']) || ! empty($q['to'])) {
            $r = Clock::range($q['from'] ?? null, $q['to'] ?? null);
            $b->where('m.createdAt', '>=', $r['gte'])->where('m.createdAt', '<', $r['lt']);
        }
        foreach (['productId', 'userId'] as $k) {
            if (! empty($q[$k])) {
                $b->where("m.$k", (int) $q[$k]);
            }
        }
        if (! empty($q['type'])) {
            $b->where('m.type', $q['type']);
        }
        $users = DB::table('users')->pluck('fullName', 'id');
        $showCost = Auth::can($req, 'products.view_cost');
        $rows = $b->orderByDesc('m.id')->limit((int) ($q['limit'] ?? 300))->get()->map(function ($m) use ($users, $showCost) {
            $row = Fmt::row('stock_movements', collect((array) $m)->except(['_name', '_sku'])->all());
            if (! $showCost) {
                unset($row['unitCost']);
            }
            $row['product'] = ['name' => $m->_name, 'sku' => $m->_sku];
            $row['user'] = $users[$m->userId] ?? null;

            return $row;
        });

        return response()->json(self::withUndo($rows->all()));
    }

    /** Entries the owner may undo: stock typed in by hand. Sales, returns and receipts have their own void/return steps. */
    public const UNDOABLE = ['OPENING', 'ADJUSTMENT', 'DAMAGED', 'LOST', 'SUPPLIER_RETURN'];

    /** Adds `undone` (already reversed) and `canUndo` to movement rows. */
    public static function withUndo(array $rows): array
    {
        $ids = array_column($rows, 'id');
        $undone = $ids ? DB::table('stock_movements')->where('refType', 'UNDO')->whereIn('refId', $ids)->pluck('refId')->flip() : collect();

        return array_map(function ($m) use ($undone) {
            $m['undone'] = isset($undone[$m['id']]);
            $m['canUndo'] = ! $m['undone'] && $m['refType'] !== 'UNDO' && in_array($m['type'], self::UNDOABLE, true);

            return $m;
        }, $rows);
    }

    /** Reverses a wrong stock entry with an opposite movement; the original stays in the history, marked as undone. */
    public function undo(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'stock.undo');
        $d = V::check(V::trim($req->all(), ['reason']), ['reason' => 'sometimes|nullable|string|max:200']);
        $id = V::id($id);
        DB::transaction(function () use ($req, $id, $d) {
            $m = DB::selectOne('SELECT * FROM stock_movements WHERE id = ? FOR UPDATE', [$id]);
            if (! $m) {
                throw ApiError::notFound('Stock entry not found');
            }
            if ($m->refType === 'UNDO' || ! in_array($m->type, self::UNDOABLE, true)) {
                throw ApiError::conflict('Only opening stock and manual adjustments can be undone. Use a void or a return for sales.', 'NOT_UNDOABLE');
            }
            if (DB::table('stock_movements')->where('refType', 'UNDO')->where('refId', $id)->exists()) {
                throw ApiError::conflict('This entry was already undone');
            }
            $why = trim((string) ($d['reason'] ?? '')) ?: 'entered by mistake';
            // adding back restocks at the entry's own cost; removing fails cleanly if those units were sold meanwhile
            Inventory::move(['productId' => (int) $m->productId, 'qtyChange' => -(int) $m->qtyChange, 'type' => 'ADJUSTMENT', 'unitCost' => (float) $m->unitCost,
                'updateAverage' => $m->qtyChange < 0, 'userId' => Auth::id($req), 'refType' => 'UNDO', 'refId' => $id, 'reason' => "Undo of entry #$id: $why"]);
            Audit::log($req, 'stock.undo', 'stock_movement', $id, ['productId' => (int) $m->productId, 'type' => $m->type, 'qtyChange' => (int) $m->qtyChange, 'reason' => $why]);
        });

        return response()->json(['ok' => true]);
    }

    private static function withProduct(object $a): array
    {
        $row = Fmt::row('stock_adjustments', $a);
        $p = DB::table('products')->where('id', $a->productId)->first(['name', 'sku', 'qtyOnHand']);
        $row['product'] = ['name' => $p->name, 'sku' => $p->sku, 'qtyOnHand' => (int) $p->qtyOnHand];

        return $row;
    }

    public function adjustments(Request $req): JsonResponse
    {
        Auth::require($req, 'stock.adjust', 'stock.approve');
        $b = DB::table('stock_adjustments');
        if (is_string($s = $req->query('status')) && $s !== '') {
            $b->where('status', $s);
        }

        return response()->json($b->orderByDesc('id')->limit(300)->get()->map(fn ($a) => self::withProduct($a))->all());
    }

    private static function applyApproved(Request $req, object $a, int $approverId): void
    {
        Inventory::move(['productId' => (int) $a->productId, 'qtyChange' => (int) $a->qtyChange, 'type' => $a->type, 'userId' => $approverId,
            'refType' => 'ADJUSTMENT', 'refId' => (int) $a->id, 'reason' => $a->reason]);
    }

    /** Users with stock.approve apply it at once; others create a request that waits for approval. */
    public function requestAdjustment(Request $req): JsonResponse
    {
        Auth::require($req, 'stock.adjust');
        $d = V::check(V::trim($req->all(), ['reason']), [
            'productId' => 'required|integer|min:1', 'type' => 'required|in:DAMAGED,LOST,ADJUSTMENT,SUPPLIER_RETURN',
            'qtyChange' => ['required', 'integer', fn ($a, $v, $fail) => (int) $v === 0 && $fail('Quantity cannot be zero')],
            'reason' => 'required|string|min:3|max:255',
        ]);
        $d['qtyChange'] = (int) $d['qtyChange'];
        if ($d['type'] !== 'ADJUSTMENT' && $d['qtyChange'] > 0) {
            throw ApiError::badRequest(strtolower(str_replace('_', ' ', $d['type'])).' must reduce stock (use a negative quantity)');
        }
        if (! DB::table('products')->where('id', $d['productId'])->exists()) {
            throw ApiError::notFound('Product not found');
        }
        $base = ['productId' => (int) $d['productId'], 'type' => $d['type'], 'qtyChange' => $d['qtyChange'], 'reason' => $d['reason'],
            'requestedById' => Auth::id($req), 'createdAt' => Clock::now()];
        if (Auth::can($req, 'stock.approve')) {
            // request + apply in one transaction so a failed apply leaves nothing behind
            $id = DB::transaction(function () use ($req, $base, $d) {
                $id = (int) DB::table('stock_adjustments')->insertGetId($base + ['status' => 'APPROVED', 'approvedById' => Auth::id($req), 'decidedAt' => Clock::now()]);
                self::applyApproved($req, DB::table('stock_adjustments')->find($id), Auth::id($req));
                Audit::log($req, 'stock.adjust_approve', 'stock_adjustment', $id, $d);

                return $id;
            });

            return response()->json(Fmt::row('stock_adjustments', DB::table('stock_adjustments')->find($id)), 201);
        }
        $id = (int) DB::table('stock_adjustments')->insertGetId($base + ['status' => 'PENDING']);
        Audit::log($req, 'stock.adjust_request', 'stock_adjustment', $id, $d);

        return response()->json(Fmt::row('stock_adjustments', DB::table('stock_adjustments')->find($id)), 201);
    }

    public function decide(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'stock.approve');
        $id = V::id($id);
        $d = V::check($req->all(), ['approve' => 'required|boolean']);
        $a = DB::table('stock_adjustments')->find($id);
        if (! $a) {
            throw ApiError::notFound();
        }
        if ($a->status !== 'PENDING') {
            throw ApiError::conflict('Adjustment was already decided');
        }
        if (filter_var($d['approve'], FILTER_VALIDATE_BOOLEAN)) {
            DB::transaction(function () use ($req, $a) {
                $n = DB::table('stock_adjustments')->where('id', $a->id)->where('status', 'PENDING')
                    ->update(['status' => 'APPROVED', 'approvedById' => Auth::id($req), 'decidedAt' => Clock::now()]);
                if (! $n) {
                    throw ApiError::conflict('Adjustment was already decided');
                }
                self::applyApproved($req, $a, Auth::id($req));
                Audit::log($req, 'stock.adjust_approve', 'stock_adjustment', $a->id, ['productId' => (int) $a->productId, 'qtyChange' => (int) $a->qtyChange, 'type' => $a->type]);
            });
        } else {
            DB::table('stock_adjustments')->where('id', $a->id)->update(['status' => 'REJECTED', 'approvedById' => Auth::id($req), 'decidedAt' => Clock::now()]);
            Audit::log($req, 'stock.adjust_reject', 'stock_adjustment', $a->id);
        }

        return response()->json(Fmt::row('stock_adjustments', DB::table('stock_adjustments')->find($id)));
    }
}
