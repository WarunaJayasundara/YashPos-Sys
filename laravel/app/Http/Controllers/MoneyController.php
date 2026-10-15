<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\V;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class MoneyController
{
    public const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Salaries', 'Transport', 'Packaging', 'Internet & phone', 'Repairs', 'Marketing', 'Other'];

    // ---------- expenses ----------

    public function expenseCategories(Request $req): JsonResponse
    {
        Auth::require($req, 'expenses.view', 'expenses.manage');

        return response()->json(self::EXPENSE_CATEGORIES);
    }

    public function expenses(Request $req): JsonResponse
    {
        Auth::require($req, 'expenses.view');
        $q = V::check($req->query(), ['from' => 'sometimes|string', 'to' => 'sometimes|string', 'category' => 'sometimes|string']);
        $r = Clock::range($q['from'] ?? null, $q['to'] ?? null);
        $b = DB::table('expenses')->whereBetween('expenseDate', [Clock::dateValue($r['from']), Clock::dateValue($r['to'])]);
        if (! empty($q['category'])) {
            $b->where('category', $q['category']);
        }

        return response()->json(Fmt::rows('expenses', $b->orderByDesc('expenseDate')->orderByDesc('id')->get()));
    }

    public function expenseStore(Request $req): JsonResponse
    {
        Auth::require($req, 'expenses.manage');
        $d = V::check(V::trim($req->all(), ['category', 'description']), [
            'category' => 'required|string|min:2|max:60', 'description' => 'required|string|min:2|max:255',
            'amount' => 'required|numeric|gt:0|max:100000000', 'expenseDate' => ['required', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
            'method' => 'required|in:CASH,CARD,BANK_TRANSFER,QR', 'reference' => 'sometimes|nullable|string|max:80', 'paidFromDrawer' => 'sometimes|nullable',
        ]);
        $url = null;
        $f = $req->file('attachment');
        if ($f && $f->isValid() && $f->getSize() <= 5 * 1024 * 1024 && in_array($f->getMimeType(), ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'], true)) {
            $name = 'exp-'.Str::uuid().'.'.strtolower($f->getClientOriginalExtension() ?: 'bin');
            $f->move(public_path('uploads'), $name);
            $url = "/uploads/$name";
        }
        $drawer = in_array($d['paidFromDrawer'] ?? false, [true, 'true', '1', 1], true);
        $id = Data::insert('expenses', [
            'category' => $d['category'], 'description' => $d['description'], 'amount' => Money::fromCents(Money::toCents($d['amount'])),
            'expenseDate' => Clock::dateValue($d['expenseDate']), 'method' => $d['method'], 'reference' => $d['reference'] ?? null,
            'paidFromDrawer' => $d['method'] === 'CASH' && $drawer ? 1 : 0, 'attachmentUrl' => $url, 'recordedById' => Auth::id($req),
        ]);
        $e = DB::table('expenses')->find($id);
        Audit::log($req, 'expense.create', 'expense', $id, ['category' => $e->category, 'amount' => Fmt::dec($e->amount)]);

        return response()->json(Fmt::row('expenses', $e), 201);
    }

    public function expenseDelete(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'expenses.manage');
        $e = DB::table('expenses')->find(V::id($id));
        if (! $e) {
            throw ApiError::notFound('Record not found');
        }
        $closed = DB::table('cash_closings')->where('businessDate', substr($e->expenseDate, 0, 10))->exists();
        if ($closed && $e->paidFromDrawer) {
            throw ApiError::conflict('That day is already closed; record a correcting entry instead');
        }
        DB::table('expenses')->where('id', $e->id)->delete();
        Audit::log($req, 'expense.delete', 'expense', $e->id, ['category' => $e->category, 'amount' => Fmt::dec($e->amount), 'description' => $e->description]);

        return response()->json(['ok' => true]);
    }

    // ---------- daily cash closing ----------

    /** Expected drawer cash for a business day. Card, transfer and QR never count as drawer cash. */
    public static function cashSummary(string $day): array
    {
        $r = Clock::range($day, $day);
        $sum = fn (string $sql, array $b) => Money::toCents(DB::scalar($sql, $b));
        $cashSales = $sum("SELECT SUM(p.amount) FROM payments p JOIN sales s ON s.id = p.saleId WHERE p.method = 'CASH' AND s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ?", [$r['gte'], $r['lt']]);
        $cashCollections = $sum("SELECT SUM(amount) FROM customer_payments WHERE method = 'CASH' AND createdAt >= ? AND createdAt < ?", [$r['gte'], $r['lt']]);
        $cashRefunds = $sum("SELECT SUM(amount) FROM refunds WHERE method = 'CASH' AND createdAt >= ? AND createdAt < ?", [$r['gte'], $r['lt']]);
        $cashExpenses = $sum('SELECT SUM(amount) FROM expenses WHERE paidFromDrawer = 1 AND expenseDate = ?', [Clock::dateValue($day)]);
        $nonCash = [];
        foreach (DB::select("SELECT p.method, SUM(p.amount) v FROM payments p JOIN sales s ON s.id = p.saleId
            WHERE p.method <> 'CASH' AND s.status <> 'VOIDED' AND s.createdAt >= ? AND s.createdAt < ? GROUP BY p.method", [$r['gte'], $r['lt']]) as $n) {
            $nonCash[$n->method] = Money::fixed($n->v);
        }

        return compact('cashSales', 'cashCollections', 'cashRefunds', 'cashExpenses') + ['nonCashTotals' => (object) $nonCash];
    }

    public function summary(Request $req): JsonResponse
    {
        Auth::require($req, 'cash.close');
        $day = is_string($req->query('date')) ? $req->query('date') : Clock::localToday();
        $s = self::cashSummary($day);
        $closing = DB::table('cash_closings')->where('businessDate', $day)->first();

        return response()->json([
            'date' => $day,
            'cashSales' => Money::fromCents($s['cashSales']), 'cashCollections' => Money::fromCents($s['cashCollections']),
            'cashRefunds' => Money::fromCents($s['cashRefunds']), 'cashExpenses' => Money::fromCents($s['cashExpenses']),
            'expectedBeforeFloat' => Money::fromCents($s['cashSales'] + $s['cashCollections'] - $s['cashRefunds'] - $s['cashExpenses']),
            'nonCashTotals' => $s['nonCashTotals'], 'closing' => Fmt::row('cash_closings', $closing),
        ]);
    }

    public function closings(Request $req): JsonResponse
    {
        Auth::require($req, 'cash.close', 'reports.financial');
        $from = (string) ($req->query('from') ?: Clock::localToday());
        $r = Clock::range($from, (string) ($req->query('to') ?: $from));

        return response()->json(Fmt::rows('cash_closings', DB::table('cash_closings')->whereBetween('businessDate', [$r['from'], $r['to']])->orderByDesc('businessDate')->get()));
    }

    public function cashClose(Request $req): JsonResponse
    {
        Auth::require($req, 'cash.close');
        $d = V::check($req->all(), ['date' => ['sometimes', 'regex:/^\d{4}-\d{2}-\d{2}$/'], 'openingFloat' => 'required|numeric|min:0',
            'countedCash' => 'required|numeric|min:0', 'notes' => 'sometimes|nullable|string|max:255']);
        $day = $d['date'] ?? Clock::localToday();
        $s = self::cashSummary($day);
        $expected = Money::toCents($d['openingFloat']) + $s['cashSales'] + $s['cashCollections'] - $s['cashRefunds'] - $s['cashExpenses'];
        $counted = Money::toCents($d['countedCash']);
        try {
            $id = Data::insert('cash_closings', [
                'businessDate' => $day, 'openingFloat' => Money::fromCents(Money::toCents($d['openingFloat'])),
                'cashSales' => Money::fromCents($s['cashSales']), 'cashCollections' => Money::fromCents($s['cashCollections']),
                'cashRefunds' => Money::fromCents($s['cashRefunds']), 'cashExpenses' => Money::fromCents($s['cashExpenses']),
                'expectedCash' => Money::fromCents($expected), 'countedCash' => Money::fromCents($counted), 'difference' => Money::fromCents($counted - $expected),
                'nonCashTotals' => json_encode($s['nonCashTotals']), 'notes' => $d['notes'] ?? null, 'closedById' => Auth::id($req),
            ]);
        } catch (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw ApiError::conflict("$day has already been closed");
            }
            throw $e;
        }
        $c = DB::table('cash_closings')->find($id);
        Audit::log($req, 'cash.close', 'cash_closing', $id, ['day' => $day, 'expected' => Fmt::dec($c->expectedCash), 'counted' => Fmt::dec($c->countedCash), 'difference' => Fmt::dec($c->difference)]);

        return response()->json(Fmt::row('cash_closings', $c), 201);
    }

    // ---------- business settings ----------

    public function settings(Request $req): JsonResponse
    {
        return response()->json(Fmt::row('business_settings', Data::settings()));
    }

    public function logo(Request $req): JsonResponse
    {
        Auth::require($req, 'settings.manage');
        $f = $req->file('logo');
        if (! $f || ! $f->isValid() || $f->getSize() > 1024 * 1024 || ! in_array($f->getMimeType(), ['image/png', 'image/jpeg'], true)) {
            throw ApiError::conflict('Upload a PNG or JPG up to 1 MB', 'BAD_FILE');
        }
        $name = 'logo-'.(int) (microtime(true) * 1000).'.'.($f->getMimeType() === 'image/png' ? 'png' : 'jpg');
        $f->move(public_path('uploads'), $name);
        Data::settings();
        DB::table('business_settings')->where('id', 1)->update(['logoUrl' => "/uploads/$name", 'updatedAt' => Clock::now()]);
        Audit::log($req, 'settings.logo', 'settings', 1);

        return response()->json(Fmt::row('business_settings', Data::settings()));
    }

    public function settingsUpdate(Request $req): JsonResponse
    {
        Auth::require($req, 'settings.manage');
        Data::settings();
        $d = V::check(V::trim($req->all(), ['shopName']), [
            'shopName' => 'sometimes|string|min:2|max:120', 'address' => 'sometimes|string|max:255', 'phone' => 'sometimes|string|max:60', 'email' => 'sometimes|string|max:120',
            'logoUrl' => 'sometimes|nullable|string|max:255', 'receiptWidth' => 'sometimes|in:58,80', 'defaultPrintFormat' => 'sometimes|in:58,80,A4',
            'receiptFooter' => 'sometimes|string|max:255', 'warrantyPolicy' => 'sometimes|string|max:3000', 'taxLabel' => 'sometimes|string|max:20',
            'taxRate' => 'sometimes|numeric|min:0|max:50', 'taxRegNo' => 'sometimes|string|max:60',
            'invoicePrefix' => ['sometimes', 'regex:/^[A-Z0-9]{1,10}$/'], 'currency' => 'sometimes|string|max:10', 'language' => 'sometimes|in:en,si',
        ], ['invoicePrefix.regex' => 'Up to 10 capital letters/digits']);
        if (isset($d['taxRate'])) {
            $d['taxRate'] = number_format((float) $d['taxRate'], 2, '.', '');
        }
        if (isset($d['receiptWidth'])) {
            $d['receiptWidth'] = (int) $d['receiptWidth'];
        }
        DB::table('business_settings')->where('id', 1)->update($d + ['updatedAt' => Clock::now()]);
        Audit::log($req, 'settings.update', 'settings', 1, $req->all());

        return response()->json(Fmt::row('business_settings', Data::settings()));
    }
}
