<?php

namespace App\Http\Controllers;

use App\Services\StockAlerts;
use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Fmt;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AlertController
{
    /** What the bell shows: everything low now, plus the alerts of the last 7 days. */
    public function stock(Request $req): JsonResponse
    {
        Auth::require($req, 'stock.view', 'reports.inventory', 'products.manage');
        $items = StockAlerts::lowItems();
        $recent = DB::table('stock_alerts as a')->join('products as p', 'p.id', '=', 'a.productId')
            ->where('a.createdAt', '>=', gmdate('Y-m-d H:i:s', time() - 7 * 86400))->orderByDesc('a.id')->limit(50)
            ->get(['a.id', 'a.productId', 'a.level', 'a.qtyAvailable', 'a.reorderLevel', 'a.createdAt', 'a.emailedAt', 'p.name', 'p.sku']);

        return response()->json([
            'lowCount' => count(array_filter($items, fn ($i) => $i['status'] === 'LOW')),
            'outCount' => count(array_filter($items, fn ($i) => $i['status'] === 'OUT')),
            'items' => $items,
            'recent' => $recent->map(fn ($a) => Fmt::row('stock_alerts', collect((array) $a)->except(['name', 'sku'])->all()) + ['name' => $a->name, 'sku' => $a->sku])->all(),
            'latestAlertId' => (int) DB::table('stock_alerts')->max('id'),
        ]);
    }

    public function testEmail(Request $req): JsonResponse
    {
        Auth::require($req, 'settings.manage');
        $d = V::check($req->all(), ['email' => 'required|email|max:120']);
        try {
            StockAlerts::testEmail($d['email']);
        } catch (\Throwable $e) {
            throw ApiError::badRequest('The email could not be sent: '.$e->getMessage().'. Check the MAIL_ lines in .env.');
        }
        Audit::log($req, 'settings.test_email', 'settings', 1, ['email' => $d['email']]);

        return response()->json(['ok' => true]);
    }
}
