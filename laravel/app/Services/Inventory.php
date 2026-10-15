<?php

namespace App\Services;

use App\Support\ApiError;
use App\Support\Clock;
use Illuminate\Support\Facades\DB;

/**
 * The only place stock quantities change. Decrements are one conditional UPDATE, so two concurrent sales
 * of the last unit cannot both succeed. Increments lock the row to keep the weighted-average cost right.
 * Call inside a transaction.
 */
class Inventory
{
    /**
     * @param  array{productId:int,qtyChange:int,type:string,userId:int,unitCost?:float|null,updateAverage?:bool,refType?:string|null,refId?:int|null,reason?:string|null}  $m
     * @return array{qtyAfter:int,unitCost:float}
     */
    public static function move(array $m): array
    {
        $qty = $m['qtyChange'];
        if (! is_int($qty) || $qty === 0) {
            throw new \InvalidArgumentException('qtyChange must be a non-zero integer');
        }
        if ($qty < 0) {
            $need = -$qty;
            $updated = DB::update('UPDATE products SET qtyOnHand = qtyOnHand - ?, updatedAt = ? WHERE id = ? AND qtyOnHand - qtyReserved >= ?',
                [$need, Clock::now(), $m['productId'], $need]);
            $p = DB::table('products')->where('id', $m['productId'])->first(['name', 'qtyOnHand', 'qtyReserved', 'avgCost']);
            if (! $p) {
                throw ApiError::notFound('Product not found');
            }
            if ($updated === 0) {
                $avail = $p->qtyOnHand - $p->qtyReserved;
                throw ApiError::conflict("Not enough stock for {$p->name}: {$avail} available, {$need} needed", 'INSUFFICIENT_STOCK',
                    ['productId' => $m['productId'], 'available' => $avail, 'requested' => $need]);
            }
            $qtyAfter = (int) $p->qtyOnHand;
            $unitCost = isset($m['unitCost']) ? (float) $m['unitCost'] : (float) $p->avgCost;
        } else {
            $row = DB::selectOne('SELECT qtyOnHand, avgCost FROM products WHERE id = ? FOR UPDATE', [$m['productId']]);
            if (! $row) {
                throw ApiError::notFound('Product not found');
            }
            $oldQty = (int) $row->qtyOnHand;
            $oldAvg = (float) $row->avgCost;
            $unitCost = isset($m['unitCost']) ? (float) $m['unitCost'] : $oldAvg;
            $qtyAfter = $oldQty + $qty;
            $newAvg = $oldAvg;
            if (! empty($m['updateAverage'])) {
                $newAvg = $oldQty <= 0 ? $unitCost : ($oldQty * $oldAvg + $qty * $unitCost) / $qtyAfter;
            }
            DB::table('products')->where('id', $m['productId'])->update(['qtyOnHand' => $qtyAfter, 'avgCost' => number_format($newAvg, 4, '.', ''), 'updatedAt' => Clock::now()]);
        }

        DB::table('stock_movements')->insert([
            'productId' => $m['productId'], 'type' => $m['type'], 'qtyChange' => $qty, 'qtyAfter' => $qtyAfter,
            'unitCost' => number_format($unitCost, 4, '.', ''), 'refType' => $m['refType'] ?? null, 'refId' => $m['refId'] ?? null,
            'reason' => $m['reason'] ?? null, 'userId' => $m['userId'], 'createdAt' => Clock::now(),
        ]);

        return ['qtyAfter' => $qtyAfter, 'unitCost' => $unitCost];
    }
}
