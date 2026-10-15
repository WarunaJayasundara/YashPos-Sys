<?php

namespace App\Services;

use App\Support\Clock;
use App\Support\Data;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Low-stock alerts. A row is written when stock falls to the reorder level (LOW) or to zero (OUT); the owner gets
 * an email (sent after the response, so the till never waits) and sees the list behind the bell in the app.
 */
class StockAlerts
{
    private static bool $hooked = false;

    /** Called by Inventory after stock goes down; inside the sale's transaction, so a rolled-back sale leaves no alert. */
    public static function check(int $productId, int $availBefore, int $availAfter): void
    {
        $p = DB::table('products')->where('id', $productId)->first(['reorderLevel', 'isActive']);
        if (! $p || ! $p->isActive) {
            return;
        }
        $level = null;
        if ($availAfter <= 0 && $availBefore > 0) {
            $level = 'OUT';
        } elseif ($availAfter <= $p->reorderLevel && $availBefore > $p->reorderLevel) {
            $level = 'LOW';
        }
        if (! $level) {
            return;
        }
        DB::table('stock_alerts')->insert(['productId' => $productId, 'level' => $level, 'qtyAvailable' => $availAfter,
            'reorderLevel' => (int) $p->reorderLevel, 'createdAt' => Clock::now()]);
        if (! self::$hooked && ! app()->runningUnitTests()) {
            self::$hooked = true;
            app()->terminating(fn () => self::emailPending());
        }
    }

    /** Products at or below their reorder level, most urgent first. */
    public static function lowItems(): array
    {
        return array_map(fn ($r) => ['id' => (int) $r->id, 'name' => $r->name, 'sku' => $r->sku, 'available' => (int) $r->available,
            'reorderLevel' => (int) $r->reorderLevel, 'status' => $r->available <= 0 ? 'OUT' : 'LOW', 'supplier' => $r->supplier],
            DB::select('SELECT p.id, p.name, p.sku, p.qtyOnHand - p.qtyReserved available, p.reorderLevel, s.name supplier
                FROM products p LEFT JOIN suppliers s ON s.id = p.supplierId
                WHERE p.isActive = 1 AND p.qtyOnHand - p.qtyReserved <= p.reorderLevel ORDER BY available, p.name LIMIT 500'));
    }

    private static function recipient(): ?string
    {
        $s = Data::settings();
        $to = trim((string) ($s->alertEmail ?? ''));

        return ($s->lowStockAlerts ?? true) && filter_var($to, FILTER_VALIDATE_EMAIL) ? $to : null;
    }

    private static function line(array $i): string
    {
        return sprintf('%-4s %s (%s): %d left, reorder at %d%s', $i['status'], $i['name'], $i['sku'], $i['available'], $i['reorderLevel'],
            $i['supplier'] ? " - supplier: {$i['supplier']}" : '');
    }

    /** Emails alerts not sent yet. Returns how many alerts the email covered (0 = nothing sent). */
    public static function emailPending(): int
    {
        $to = self::recipient();
        $pending = DB::table('stock_alerts as a')->join('products as p', 'p.id', '=', 'a.productId')->whereNull('a.emailedAt')
            ->orderBy('a.id')->get(['a.id', 'a.level', 'a.qtyAvailable', 'a.reorderLevel', 'p.name', 'p.sku']);
        if (! $to || $pending->isEmpty()) {
            return 0;
        }
        $shop = Data::settings()->shopName;
        $body = ['Hello,', '', 'These items just ran low at '.$shop.':', ''];
        foreach ($pending as $a) {
            $body[] = sprintf('- %s (%s): %s, %d left (reorder level %d)', $a->name, $a->sku, $a->level === 'OUT' ? 'SOLD OUT' : 'low', $a->qtyAvailable, $a->reorderLevel);
        }
        $all = self::lowItems();
        $body = array_merge($body, ['', 'All items at or below their reorder level now ('.count($all).'):', ''], array_map(fn ($i) => self::line($i), array_slice($all, 0, 100)),
            ['', 'Open the POS: '.rtrim((string) config('app.url'), '/').'/products?status=LOW', '', '- '.$shop.' POS']);
        $out = $pending->where('level', 'OUT')->count();
        $subject = "$shop: ".$pending->count().' item'.($pending->count() === 1 ? '' : 's').' running low'.($out ? " ($out sold out)" : '');
        try {
            Mail::raw(implode("\n", $body), fn ($m) => $m->to($to)->subject($subject));
        } catch (\Throwable $e) {
            Log::warning('Low-stock email failed: '.$e->getMessage());

            return 0; // stays pending; retried on the next alert or by the scheduled command
        }
        DB::table('stock_alerts')->whereIn('id', $pending->pluck('id'))->update(['emailedAt' => Clock::now()]);

        return $pending->count();
    }

    /** Daily summary of everything low, sent even when nothing new happened. */
    public static function emailSummary(): int
    {
        $to = self::recipient();
        $all = self::lowItems();
        if (! $to || ! $all) {
            return 0;
        }
        $shop = Data::settings()->shopName;
        Mail::raw(implode("\n", array_merge(['Good morning,', '', count($all)." item(s) at $shop are at or below their reorder level:", ''],
            array_map(fn ($i) => self::line($i), array_slice($all, 0, 200)), ['', '- '.$shop.' POS'])),
            fn ($m) => $m->to($to)->subject("$shop: daily low-stock list (".count($all).' items)'));

        return count($all);
    }

    /** Sends a test message to check the email settings. Throws on failure so the owner sees the reason. */
    public static function testEmail(string $to): void
    {
        $shop = Data::settings()->shopName;
        Mail::raw("This is a test from $shop POS.\n\nLow-stock alerts will be sent to this address.", fn ($m) => $m->to($to)->subject("$shop POS: test email"));
    }
}
