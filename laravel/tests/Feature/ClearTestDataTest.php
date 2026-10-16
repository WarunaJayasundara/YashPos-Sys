<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ClearTestDataTest extends TestCase
{
    public function test_needs_owner_permission_confirm_word_and_password(): void
    {
        $owner = $this->owner();
        $owner->post('/api/system/clear-test-data', ['confirm' => 'nope', 'password' => 'Owner@12345'])->assertStatus(400);
        $owner->post('/api/system/clear-test-data', ['confirm' => 'CLEAR', 'password' => 'wrong'])->assertStatus(400);
        $this->ensureUser('t_manager', 'manager')->post('/api/system/clear-test-data', ['confirm' => 'CLEAR', 'password' => 'Passw0rd!x'])->assertStatus(403);
    }

    public function test_clears_sales_keeps_products_with_their_stock_then_the_test_product_can_be_deleted(): void
    {
        $owner = $this->owner();
        $id = $owner->post('/api/products', ['name' => 'Trial cable', 'sellingPrice' => 500, 'openingStock' => 5])->json('id');
        $owner->post('/api/sales', $this->sale($id, 3))->assertStatus(201);
        $owner->send('DELETE', "/api/products/$id")->assertStatus(409);

        $owner->post('/api/system/clear-test-data', ['confirm' => 'clear', 'password' => 'Owner@12345'])->assertOk();
        $this->assertSame(0, DB::table('sales')->count());
        $this->assertSame(2, $this->qty($id));
        $this->assertSame(1, DB::table('stock_movements')->where('productId', $id)->where('type', 'OPENING')->count());
        $this->assertTrue(DB::table('audit_logs')->where('action', 'data.clear_test')->exists());

        $owner->send('DELETE', "/api/products/$id")->assertOk();
    }

    public function test_can_also_delete_every_product(): void
    {
        $owner = $this->owner();
        $id = $owner->post('/api/products', ['name' => 'Trial case', 'sellingPrice' => 800, 'openingStock' => 2])->json('id');
        $owner->post('/api/sales', $this->sale($id, 1))->assertStatus(201);
        $owner->post('/api/system/clear-test-data', ['confirm' => 'CLEAR', 'password' => 'Owner@12345', 'deleteProducts' => true])->assertOk();
        $this->assertSame(0, DB::table('products')->count());
        $this->assertSame(0, DB::table('stock_movements')->count());
        $this->assertNotSame(0, DB::table('users')->count());
    }
}
