<?php

use App\Http\Controllers\AlertController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CatalogController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\MoneyController;
use App\Http\Controllers\PeopleController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\PurchaseController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\StockController;
use App\Http\Controllers\SystemController;
use App\Http\Middleware\RequireAuth;
use App\Support\Clock;
use App\Support\Fmt;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['ok' => true, 'time' => Fmt::iso(Clock::now())]));

Route::post('/auth/login', [AuthController::class, 'login']);
Route::post('/auth/logout', [AuthController::class, 'logout']);

Route::middleware(RequireAuth::class)->group(function () {
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/catalog', [ProductController::class, 'catalog']);
    Route::get('/products/export', [ProductController::class, 'export']);
    Route::post('/products/import', [ProductController::class, 'import']);
    Route::post('/products/upload-image', [ProductController::class, 'uploadImage']);
    Route::get('/products/{id}', [ProductController::class, 'show']);
    Route::post('/products', [ProductController::class, 'store']);
    Route::put('/products/{id}', [ProductController::class, 'update']);
    Route::get('/products/{id}/movements', [ProductController::class, 'movements']);
    Route::delete('/products/{id}', [ProductController::class, 'destroy']);

    foreach (['categories' => 'categories', 'brands' => 'brands'] as $path => $table) {
        Route::get("/$path", [CatalogController::class, 'lookupIndex'])->defaults('table', $table);
        Route::post("/$path", [CatalogController::class, 'lookupStore'])->defaults('table', $table);
        Route::put("/$path/{id}", [CatalogController::class, 'lookupUpdate'])->defaults('table', $table);
    }
    Route::get('/suppliers', [CatalogController::class, 'suppliers']);
    Route::get('/suppliers/{id}', [CatalogController::class, 'supplier']);
    Route::post('/suppliers', [CatalogController::class, 'supplierStore']);
    Route::put('/suppliers/{id}', [CatalogController::class, 'supplierUpdate']);

    Route::get('/purchases', [PurchaseController::class, 'index']);
    Route::get('/purchases/{id}', [PurchaseController::class, 'show']);
    Route::post('/purchases', [PurchaseController::class, 'store']);
    Route::post('/purchases/{id}/order', [PurchaseController::class, 'order']);
    Route::post('/purchases/{id}/receive', [PurchaseController::class, 'receive']);
    Route::put('/purchases/{id}/invoice', [PurchaseController::class, 'invoice']);
    Route::post('/purchases/{id}/cancel', [PurchaseController::class, 'cancel']);
    Route::post('/purchases/{id}/payments', [PurchaseController::class, 'pay']);

    Route::get('/stock/movements', [StockController::class, 'movements']);
    Route::get('/stock/adjustments', [StockController::class, 'adjustments']);
    Route::post('/stock/adjustments', [StockController::class, 'requestAdjustment']);
    Route::post('/stock/adjustments/{id}/decide', [StockController::class, 'decide']);
    Route::post('/stock/movements/{id}/undo', [StockController::class, 'undo']);

    Route::post('/sales', [SaleController::class, 'store']);
    Route::get('/sales', [SaleController::class, 'index']);
    Route::get('/sales/{id}', [SaleController::class, 'show']);
    Route::get('/sales/{id}/receipt', [SaleController::class, 'receipt']);
    Route::get('/sales/{id}/invoice.pdf', [SaleController::class, 'pdf']);
    Route::post('/sales/{id}/reprint', [SaleController::class, 'reprint']);
    Route::patch('/sales/{id}/details', [SaleController::class, 'details']);
    Route::post('/sales/{id}/void', [SaleController::class, 'void']);

    Route::post('/returns', [SaleController::class, 'returnStore']);
    Route::get('/returns/lookup', [SaleController::class, 'returnLookup']);
    Route::get('/returns', [SaleController::class, 'returnIndex']);

    Route::get('/customers', [PeopleController::class, 'customers']);
    Route::get('/customers/{id}', [PeopleController::class, 'customer']);
    Route::post('/customers', [PeopleController::class, 'customerStore']);
    Route::put('/customers/{id}', [PeopleController::class, 'customerUpdate']);
    Route::post('/customers/{id}/payments', [PeopleController::class, 'customerPay']);
    Route::get('/warranties', [PeopleController::class, 'warranties']);
    Route::put('/warranties/{id}', [PeopleController::class, 'warrantyUpdate']);
    Route::get('/users', [PeopleController::class, 'users']);
    Route::get('/users/staff', [PeopleController::class, 'staff']);
    Route::post('/users', [PeopleController::class, 'userStore']);
    Route::put('/users/{id}', [PeopleController::class, 'userUpdate']);
    Route::get('/roles', [PeopleController::class, 'roles']);
    Route::post('/roles', [PeopleController::class, 'roleStore']);
    Route::put('/roles/{id}', [PeopleController::class, 'roleUpdate']);
    Route::get('/audit-logs', [PeopleController::class, 'audit']);

    Route::get('/expenses/categories', [MoneyController::class, 'expenseCategories']);
    Route::get('/expenses', [MoneyController::class, 'expenses']);
    Route::post('/expenses', [MoneyController::class, 'expenseStore']);
    Route::delete('/expenses/{id}', [MoneyController::class, 'expenseDelete']);
    Route::get('/cash/summary', [MoneyController::class, 'summary']);
    Route::post('/cash/close', [MoneyController::class, 'cashClose']);
    Route::get('/cash/closings', [MoneyController::class, 'closings']);
    Route::get('/settings', [MoneyController::class, 'settings']);
    Route::post('/settings/logo', [MoneyController::class, 'logo']);
    Route::put('/settings', [MoneyController::class, 'settingsUpdate']);

    Route::get('/reports', [ReportController::class, 'index']);
    Route::get('/reports/{key}', [ReportController::class, 'show']);
    Route::get('/dashboard', [DashboardController::class, 'index']);
    Route::get('/alerts/stock', [AlertController::class, 'stock']);
    Route::post('/alerts/test-email', [AlertController::class, 'testEmail']);
    Route::post('/system/clear-test-data', [SystemController::class, 'clearTestData']);
});
