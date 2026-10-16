<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SystemController
{
    /** Child tables first so foreign keys never block a delete. */
    private const TRANSACTIONS = ['refunds', 'return_items', 'returns', 'payments', 'customer_payments', 'warranties', 'sale_items', 'sales',
        'goods_receipt_items', 'goods_receipts', 'supplier_payments', 'purchase_items', 'purchase_orders', 'expenses', 'cash_closings',
        'stock_adjustments', 'stock_alerts', 'stock_movements', 'price_history'];

    /** Removes trial sales, purchases and stock history before going live. Staff, settings, customers and suppliers stay. */
    public function clearTestData(Request $req): JsonResponse
    {
        Auth::require($req, 'data.reset');
        $d = V::check($req->all(), ['password' => 'required|string', 'confirm' => 'required|string', 'deleteProducts' => 'sometimes|boolean']);
        if (strtoupper(trim($d['confirm'])) !== 'CLEAR') {
            throw ApiError::badRequest('Type CLEAR to confirm');
        }
        $me = DB::table('users')->find(Auth::id($req));
        if (! $me || ! password_verify($d['password'], $me->passwordHash)) {
            throw ApiError::badRequest('Your password is not correct');
        }
        $deleteProducts = filter_var($d['deleteProducts'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $counts = ['sales' => DB::table('sales')->count(), 'purchases' => DB::table('purchase_orders')->count(), 'expenses' => DB::table('expenses')->count()];

        DB::transaction(function () use ($req, $deleteProducts, &$counts) {
            foreach (self::TRANSACTIONS as $t) {
                DB::table($t)->delete();
            }
            // invoice, GRN, PO and return numbers start again from 1
            DB::table('document_sequences')->where('key', '!=', 'SKU')->delete();
            if ($deleteProducts) {
                $counts['products'] = DB::table('products')->count();
                DB::table('products')->delete();
                DB::table('document_sequences')->where('key', 'SKU')->delete();
            } else {
                // products keep today's counts, recorded as a fresh opening entry
                DB::table('products')->update(['qtyReserved' => 0]);
                $now = Clock::now();
                $rows = DB::table('products')->where('qtyOnHand', '!=', 0)->get(['id', 'qtyOnHand', 'avgCost'])->map(fn ($p) => [
                    'productId' => $p->id, 'type' => 'OPENING', 'qtyChange' => (int) $p->qtyOnHand, 'qtyAfter' => (int) $p->qtyOnHand,
                    'unitCost' => $p->avgCost, 'refType' => 'RESET', 'refId' => null, 'reason' => 'Stock kept after clearing test data',
                    'userId' => Auth::id($req), 'createdAt' => $now,
                ])->all();
                foreach (array_chunk($rows, 500) as $chunk) {
                    DB::table('stock_movements')->insert($chunk);
                }
            }
            Audit::log($req, 'data.clear_test', 'system', null, $counts + ['deleteProducts' => $deleteProducts]);
        });

        return response()->json(['ok' => true, 'cleared' => $counts]);
    }
}
