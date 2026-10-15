<?php

namespace App\Services;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\V;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class Sales
{
    public static function rules(): array
    {
        return [
            'clientRequestId' => 'required|string|min:8|max:64',
            'items' => 'required|array|min:1|max:200',
            'items.*.productId' => 'required|integer|min:1',
            'items.*.qty' => 'required|integer|min:1|max:10000',
            'items.*.unitPrice' => array_merge(['sometimes', 'nullable'], V::MONEY),
            'items.*.lineDiscount' => array_merge(['sometimes', 'nullable'], V::MONEY),
            'items.*.serialNumber' => 'sometimes|nullable|string|max:80',
            'billDiscount' => array_merge(['sometimes', 'nullable'], V::MONEY),
            'payments' => 'required|array|min:1|max:10',
            'payments.*.method' => 'required|in:CASH,CARD,BANK_TRANSFER,QR,CREDIT',
            'payments.*.amount' => array_merge(['required', 'gt:0'], V::MONEY),
            'payments.*.reference' => 'sometimes|nullable|string|max:80',
            'customer' => 'sometimes|nullable|array',
            'customer.id' => 'sometimes|nullable|integer|min:1',
            'customer.name' => 'sometimes|nullable|string|max:120',
            'customer.phone' => 'sometimes|nullable|string|max:30',
            'notes' => 'sometimes|nullable|string|max:255',
            'offlineCreatedAt' => 'sometimes|nullable|date',
        ] + V::APPROVAL;
    }

    /** A sale with items, payments, customer and returns (with their items and refunds). */
    public static function full(int $id): ?array
    {
        $s = DB::table('sales')->find($id);
        if (! $s) {
            return null;
        }
        $out = Fmt::row('sales', $s);
        $out['items'] = Fmt::rows('sale_items', DB::table('sale_items')->where('saleId', $id)->orderBy('id')->get());
        $out['payments'] = Fmt::rows('payments', DB::table('payments')->where('saleId', $id)->orderBy('id')->get());
        $out['customer'] = $s->customerId ? Fmt::row('customers', DB::table('customers')->find($s->customerId)) : null;
        $out['returns'] = DB::table('returns')->where('saleId', $id)->orderBy('id')->get()->map(function ($r) {
            $row = Fmt::row('returns', $r);
            $row['items'] = Fmt::rows('return_items', DB::table('return_items')->where('returnId', $r->id)->orderBy('id')->get());
            $row['refunds'] = Fmt::rows('refunds', DB::table('refunds')->where('returnId', $r->id)->orderBy('id')->get());

            return $row;
        })->all();

        return $out;
    }

    private static function byRequestId(string $rid): ?array
    {
        $id = DB::table('sales')->where('clientRequestId', $rid)->value('id');

        return $id ? self::full((int) $id) : null;
    }

    /**
     * Creates a sale. Totals are always recomputed from server-side product data; the client only proposes
     * quantities, prices and discounts. Idempotent on clientRequestId.
     *
     * @return array{sale:array,duplicate:bool}
     */
    public static function create(Request $req, array $in): array
    {
        $user = Auth::user($req);
        if ($existing = self::byRequestId($in['clientRequestId'])) {
            return ['sale' => $existing, 'duplicate' => true];
        }
        $ids = array_unique(array_map(fn ($i) => (int) $i['productId'], $in['items']));
        $products = DB::table('products')->whereIn('id', $ids)->get()->keyBy('id');
        $settings = Data::settings();

        // ---- price and discount rules ----
        $needsOverride = null;
        $lines = [];
        foreach ($in['items'] as $it) {
            $p = $products[(int) $it['productId']] ?? null;
            if (! $p) {
                throw ApiError::badRequest("Product {$it['productId']} does not exist");
            }
            if (! $p->isActive) {
                throw ApiError::badRequest("{$p->name} is inactive and cannot be sold");
            }
            $qty = (int) $it['qty'];
            $list = Money::toCents($p->sellingPrice);
            $unit = isset($it['unitPrice']) ? Money::toCents($it['unitPrice']) : $list;
            $gross = $unit * $qty;
            $lineDisc = Money::toCents($it['lineDiscount'] ?? 0);
            if ($lineDisc > $gross) {
                throw ApiError::badRequest("Discount on {$p->name} exceeds the line amount");
            }
            $lineTotal = $gross - $lineDisc;
            if ($lineTotal < Money::toCents($p->minSellingPrice) * $qty) {
                $needsOverride ??= "Selling {$p->name} below its minimum price";
            }
            $lines[] = compact('it', 'p', 'qty', 'list', 'unit', 'lineDisc', 'lineTotal');
        }
        $listTotal = array_sum(array_map(fn ($l) => $l['list'] * $l['qty'], $lines));
        $subtotal = array_sum(array_map(fn ($l) => $l['unit'] * $l['qty'], $lines));
        $lineDiscount = array_sum(array_column($lines, 'lineDisc'));
        $afterLines = $subtotal - $lineDiscount;
        $billDiscount = Money::toCents($in['billDiscount'] ?? 0);
        if ($billDiscount > $afterLines) {
            throw ApiError::badRequest('Bill discount exceeds the bill amount');
        }
        $net = $afterLines - $billDiscount;
        $totalDiscount = $listTotal - $net;
        if ($listTotal > 0 && $totalDiscount > 0 && $totalDiscount * 100 / $listTotal > $user->maxDiscountPercent + 1e-9) {
            $needsOverride ??= sprintf('A discount of %.1f%% (your limit is %s%%)', $totalDiscount * 100 / $listTotal, rtrim(rtrim(number_format($user->maxDiscountPercent, 2, '.', ''), '0'), '.'));
        }
        $approvedBy = $needsOverride ? Auth::approval($req, 'discounts.override', $in['approval'] ?? null, $needsOverride) : null;

        $taxRate = (float) $settings->taxRate;
        $tax = (int) round($net * $taxRate / 100);
        $total = $net + $tax;

        // ---- payments ----
        $cash = $nonCash = $credit = 0;
        foreach ($in['payments'] as $pm) {
            $c = Money::toCents($pm['amount']);
            match ($pm['method']) {
                'CASH' => $cash += $c,
                'CREDIT' => $credit += $c,
                default => $nonCash += $c,
            };
        }
        if ($nonCash + $credit > $total) {
            throw ApiError::badRequest('Card/transfer/QR/credit payments exceed the bill total');
        }
        $cashDue = $total - $nonCash - $credit;
        if ($cash < $cashDue) {
            throw new ApiError(422, 'Payment is short by '.Money::fromCents($cashDue - $cash), 'PAYMENT_SHORT');
        }
        if ($cash > 0 && $cashDue === 0 && $nonCash + $credit === $total) {
            throw ApiError::badRequest('Cash entered but nothing is left to pay in cash');
        }
        $change = $cash - $cashDue;
        $cust = $in['customer'] ?? null;
        if ($credit > 0 && empty($cust['id']) && empty($cust['phone'])) {
            throw ApiError::badRequest('Credit sales need a registered customer (phone number)');
        }
        $allocBill = Money::allocate($billDiscount, array_column($lines, 'lineTotal'));

        try {
            $saleId = DB::transaction(function () use ($req, $in, $user, $cust, $settings, $lines, $allocBill, $subtotal, $lineDiscount, $billDiscount, $taxRate, $tax, $total, $credit, $cash, $cashDue, $change, $approvedBy) {
                $customerId = null;
                if (! empty($cust['id'])) {
                    $c = DB::table('customers')->find((int) $cust['id']);
                    if (! $c) {
                        throw ApiError::badRequest('Customer not found');
                    }
                    $customerId = (int) $c->id;
                } elseif (! empty($cust['phone'])) {
                    $phone = trim($cust['phone']);
                    DB::table('customers')->insertOrIgnore(['phone' => $phone, 'name' => trim((string) ($cust['name'] ?? '')) ?: 'Walk-in customer',
                        'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
                    $customerId = (int) DB::table('customers')->where('phone', $phone)->value('id');
                }

                $year = substr(Clock::localToday(), 0, 4);
                $invoiceNumber = "{$settings->invoicePrefix}-$year-".str_pad((string) Data::nextSequence("INV-$year"), 6, '0', STR_PAD_LEFT);
                $saleId = Data::insert('sales', [
                    'invoiceNumber' => $invoiceNumber, 'clientRequestId' => $in['clientRequestId'], 'customerId' => $customerId,
                    'customerName' => trim((string) ($cust['name'] ?? '')) ?: null, 'customerPhone' => trim((string) ($cust['phone'] ?? '')) ?: null,
                    'cashierId' => $user->id, 'cashierName' => $user->fullName,
                    'subtotal' => Money::fromCents($subtotal), 'lineDiscount' => Money::fromCents($lineDiscount), 'billDiscount' => Money::fromCents($billDiscount),
                    'taxRate' => number_format($taxRate, 2, '.', ''), 'taxAmount' => Money::fromCents($tax), 'total' => Money::fromCents($total), 'totalCost' => '0',
                    'amountPaid' => Money::fromCents($total - $credit), 'amountTendered' => Money::fromCents($cash), 'changeDue' => Money::fromCents($change),
                    'balanceDue' => Money::fromCents($credit), 'discountApprovedById' => $approvedBy, 'notes' => $in['notes'] ?? null,
                    'offlineCreatedAt' => ! empty($in['offlineCreatedAt']) ? Clock::db((float) strtotime($in['offlineCreatedAt'])) : null,
                ]);

                $totalCost = 0;
                foreach ($lines as $i => $l) {
                    $m = Inventory::move(['productId' => (int) $l['p']->id, 'qtyChange' => -$l['qty'], 'type' => 'SALE', 'userId' => $user->id, 'refType' => 'SALE', 'refId' => $saleId]);
                    $totalCost += (int) round($m['unitCost'] * $l['qty'] * 100);
                    $serial = ($l['it']['serialNumber'] ?? '') ?: null;
                    $itemId = (int) DB::table('sale_items')->insertGetId([
                        'saleId' => $saleId, 'productId' => (int) $l['p']->id, 'productName' => $l['p']->name, 'sku' => $l['p']->sku, 'qty' => $l['qty'],
                        'listPrice' => Money::fromCents($l['list']), 'unitPrice' => Money::fromCents($l['unit']), 'lineDiscount' => Money::fromCents($l['lineDisc']),
                        'lineTotal' => Money::fromCents($l['lineTotal']), 'allocatedBillDiscount' => Money::fromCents($allocBill[$i]),
                        'unitCost' => number_format($m['unitCost'], 4, '.', ''), 'serialNumber' => $serial, 'warrantyMonths' => (int) $l['p']->warrantyMonths,
                    ]);
                    if ($l['p']->warrantyMonths > 0) {
                        $start = microtime(true);
                        $end = (new \DateTimeImmutable('@'.(int) $start))->modify('+'.(int) $l['p']->warrantyMonths.' months')->getTimestamp() + ($start - (int) $start);
                        DB::table('warranties')->insert(['saleId' => $saleId, 'saleItemId' => $itemId, 'productId' => (int) $l['p']->id, 'serialNumber' => $serial,
                            'startsAt' => Clock::db($start), 'expiresAt' => Clock::db($end), 'updatedAt' => Clock::now()]);
                    }
                }
                $pays = [];
                foreach ($in['payments'] as $pm) {
                    if ($pm['method'] !== 'CASH') {
                        $pays[] = ['saleId' => $saleId, 'method' => $pm['method'], 'amount' => Money::fromCents(Money::toCents($pm['amount'])), 'reference' => $pm['reference'] ?? null, 'createdAt' => Clock::now()];
                    }
                }
                if ($cashDue > 0) {
                    $pays[] = ['saleId' => $saleId, 'method' => 'CASH', 'amount' => Money::fromCents($cashDue), 'reference' => null, 'createdAt' => Clock::now()];
                }
                DB::table('payments')->insert($pays);
                DB::table('sales')->where('id', $saleId)->update(['totalCost' => Money::fromCents($totalCost)]);
                Audit::log($req, 'sale.create', 'sale', $saleId, ['invoiceNumber' => $invoiceNumber, 'total' => Money::fromCents($total), 'approvedBy' => $approvedBy]);

                return $saleId;
            });
        } catch (QueryException $e) {
            // a concurrent duplicate submit lost the race on the unique key: return the winner
            if (($e->errorInfo[1] ?? null) === 1062 && str_contains($e->getMessage(), 'clientRequestId') && ($s = self::byRequestId($in['clientRequestId']))) {
                return ['sale' => $s, 'duplicate' => true];
            }
            throw $e;
        }

        return ['sale' => self::full($saleId), 'duplicate' => false];
    }

    /** Void: same business day only, nothing returned yet. Restocks at the original cost. */
    public static function void(Request $req, int $saleId, string $reason, ?array $approval): array
    {
        $sale = DB::table('sales')->find($saleId);
        if (! $sale) {
            throw ApiError::notFound('Sale not found');
        }
        if ($sale->status !== 'COMPLETED') {
            throw ApiError::conflict('Sale is '.strtolower($sale->status).' and cannot be voided');
        }
        $today = Clock::localToday();
        if ($sale->createdAt < Clock::localDayStart($today) || $sale->createdAt >= Clock::localDayStart(Clock::addDays($today, 1))) {
            throw ApiError::conflict('Only sales from today can be voided. Use a return for older sales.', 'VOID_WINDOW');
        }
        $approvedBy = Auth::approval($req, 'sales.void', $approval, 'Voiding a sale');
        DB::transaction(function () use ($req, $sale, $saleId, $reason, $approvedBy) {
            $n = DB::table('sales')->where('id', $saleId)->where('status', 'COMPLETED')
                ->update(['status' => 'VOIDED', 'voidedAt' => Clock::now(), 'voidedById' => $approvedBy, 'voidReason' => $reason]);
            if ($n === 0) {
                throw ApiError::conflict('Sale was changed by someone else');
            }
            foreach (DB::table('sale_items')->where('saleId', $saleId)->orderBy('id')->get() as $it) {
                Inventory::move(['productId' => (int) $it->productId, 'qtyChange' => (int) $it->qty, 'type' => 'SALE_VOID', 'unitCost' => (float) $it->unitCost,
                    'updateAverage' => true, 'userId' => Auth::id($req), 'refType' => 'SALE', 'refId' => $saleId, 'reason' => $reason]);
            }
            DB::table('warranties')->where('saleId', $saleId)->delete();
            Audit::log($req, 'sale.void', 'sale', $saleId, ['invoiceNumber' => $sale->invoiceNumber, 'reason' => $reason, 'approvedBy' => $approvedBy]);
        });

        return self::full($saleId);
    }

    /** Refund for units [before, before+n) of a line, so repeated partial returns sum exactly to the line's net. */
    private static function refundSlice(int $lineNet, int $lineQty, int $before, int $n): int
    {
        return (int) (self::jsRound($lineNet * ($before + $n) / $lineQty) - self::jsRound($lineNet * $before / $lineQty));
    }

    /** Math.round (halves go up, also for negatives). */
    private static function jsRound(float $v): float
    {
        return floor($v + 0.5);
    }

    public static function createReturn(Request $req, array $in): array
    {
        $sale = DB::table('sales')->find((int) $in['saleId']);
        if (! $sale) {
            throw ApiError::notFound('Sale not found');
        }
        if (in_array($sale->status, ['VOIDED', 'RETURNED'], true)) {
            throw ApiError::conflict('Sale is already '.strtolower($sale->status));
        }
        $type = $in['type'] ?? 'REFUND';
        $method = $in['refundMethod'] ?? 'CASH';
        if ($method === 'CREDIT' && ! $sale->customerId) {
            throw ApiError::badRequest('Store credit refunds need a customer on the sale');
        }
        $approvedBy = Auth::approval($req, 'returns.approve', $in['approval'] ?? null, 'A return/refund');
        $items = DB::table('sale_items')->where('saleId', $sale->id)->get()->keyBy('id');
        $seen = [];
        foreach ($in['items'] as $r) {
            $si = $items[(int) $r['saleItemId']] ?? null;
            if (! $si) {
                throw ApiError::badRequest('Item does not belong to this sale');
            }
            if (isset($seen[$si->id])) {
                throw ApiError::badRequest('Each sale line may appear once per return');
            }
            $seen[$si->id] = true;
            if ((int) $r['qty'] > $si->qty - $si->qtyReturned) {
                throw ApiError::badRequest('Only '.($si->qty - $si->qtyReturned)." of {$si->productName} can still be returned");
            }
        }
        $taxRate = (float) $sale->taxRate;

        $id = DB::transaction(function () use ($req, $in, $sale, $items, $type, $method, $approvedBy, $taxRate) {
            $year = substr(Clock::localToday(), 0, 4);
            $returnNumber = "RT-$year-".str_pad((string) Data::nextSequence("RET-$year"), 5, '0', STR_PAD_LEFT);
            $retId = Data::insert('returns', ['returnNumber' => $returnNumber, 'saleId' => $sale->id, 'reason' => $in['reason'], 'type' => $type,
                'refundTotal' => '0', 'costReversed' => '0', 'processedById' => Auth::id($req), 'approvedById' => $approvedBy]);
            $refundNet = $costReversed = 0;
            foreach ($in['items'] as $r) {
                $si = $items[(int) $r['saleItemId']];
                $qty = (int) $r['qty'];
                $restock = filter_var($r['restock'], FILTER_VALIDATE_BOOLEAN);
                // conditional increment guards against two returns of the same units at once
                $ok = DB::update('UPDATE sale_items SET qtyReturned = qtyReturned + ? WHERE id = ? AND qtyReturned + ? <= qty', [$qty, $si->id, $qty]);
                if ($ok === 0) {
                    throw ApiError::conflict("{$si->productName} was already returned");
                }
                $fresh = DB::table('sale_items')->find($si->id);
                $before = $fresh->qtyReturned - $qty;
                $lineNet = Money::toCents($si->lineTotal) - Money::toCents($si->allocatedBillDiscount);
                $amount = self::refundSlice($lineNet, (int) $si->qty, (int) $before, $qty);
                $refundNet += $amount;
                DB::table('return_items')->insert(['returnId' => $retId, 'saleItemId' => $si->id, 'qty' => $qty, 'restock' => $restock ? 1 : 0, 'refundAmount' => Money::fromCents($amount)]);
                $unitCost = (float) $si->unitCost;
                Inventory::move(['productId' => (int) $si->productId, 'qtyChange' => $qty, 'type' => 'CUSTOMER_RETURN', 'unitCost' => $unitCost, 'updateAverage' => true,
                    'userId' => Auth::id($req), 'refType' => 'RETURN', 'refId' => $retId, 'reason' => $in['reason']]);
                if ($restock) {
                    $costReversed += (int) round($unitCost * $qty * 100);
                } else {
                    Inventory::move(['productId' => (int) $si->productId, 'qtyChange' => -$qty, 'type' => 'DAMAGED', 'unitCost' => $unitCost,
                        'userId' => Auth::id($req), 'refType' => 'RETURN', 'refId' => $retId, 'reason' => "Returned damaged: {$in['reason']}"]);
                }
                if ($fresh->qtyReturned >= $fresh->qty) {
                    DB::table('warranties')->where('saleItemId', $si->id)->update(['claimStatus' => 'CLOSED', 'resolution' => "Item returned ($returnNumber)", 'updatedAt' => Clock::now()]);
                }
            }
            $refundTax = (int) round($refundNet * $taxRate / 100);
            $refundTotal = $refundNet + $refundTax;
            DB::table('returns')->where('id', $retId)->update(['refundTotal' => Money::fromCents($refundTotal), 'costReversed' => Money::fromCents($costReversed)]);
            if ($refundTotal > 0) {
                DB::table('refunds')->insert(['returnId' => $retId, 'method' => $method, 'amount' => Money::fromCents($refundTotal), 'createdAt' => Clock::now()]);
            }
            $all = DB::table('sale_items')->where('saleId', $sale->id)->whereColumn('qtyReturned', '<', 'qty')->doesntExist();
            DB::table('sales')->where('id', $sale->id)->update(['status' => $all ? 'RETURNED' : 'PARTIALLY_RETURNED']);
            Audit::log($req, 'return.create', 'return', $retId, ['saleId' => (int) $sale->id, 'invoice' => $sale->invoiceNumber, 'refundTotal' => Money::fromCents($refundTotal), 'approvedBy' => $approvedBy]);

            return $retId;
        });

        $ret = Fmt::row('returns', DB::table('returns')->find($id));
        $ret['items'] = DB::table('return_items')->where('returnId', $id)->orderBy('id')->get()->map(function ($ri) {
            $row = Fmt::row('return_items', $ri);
            $row['saleItem'] = Fmt::row('sale_items', DB::table('sale_items')->find($ri->saleItemId));

            return $row;
        })->all();
        $ret['refunds'] = Fmt::rows('refunds', DB::table('refunds')->where('returnId', $id)->get());
        $ret['sale'] = Fmt::row('sales', DB::table('sales')->find($ret['saleId']));

        return $ret;
    }
}
