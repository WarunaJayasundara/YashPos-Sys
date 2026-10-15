<?php

namespace Tests\Feature;

use App\Support\Clock;
use Tests\TestCase;

/** The app's forms send empty optional fields as "" or null; every form must accept them. */
class FormsTest extends TestCase
{
    public function test_settings_save_with_empty_optional_fields(): void
    {
        $this->owner()->put('/api/settings', [
            'shopName' => 'YASH MOBILE', 'address' => '', 'phone' => '', 'email' => '', 'receiptWidth' => 80, 'defaultPrintFormat' => '80',
            'receiptFooter' => '', 'warrantyPolicy' => '', 'taxLabel' => 'VAT', 'taxRate' => 0, 'taxRegNo' => '', 'invoicePrefix' => 'YM',
            'currency' => 'Rs.', 'language' => 'en', 'logoUrl' => null, 'alertEmail' => '', 'lowStockAlerts' => true,
        ])->assertOk()->assertJson(['address' => '', 'email' => '', 'alertEmail' => '']);
    }

    public function test_product_form_with_only_name_and_price(): void
    {
        $r = $this->owner()->post('/api/products', [
            'sku' => '', 'barcode' => '', 'name' => 'Form phone stand', 'description' => '', 'categoryId' => null, 'brandId' => null, 'supplierId' => null,
            'variantGroup' => '', 'compatibility' => '', 'color' => '', 'size' => '', 'connectorType' => '', 'purchasePrice' => null, 'sellingPrice' => 950,
            'minSellingPrice' => null, 'reorderLevel' => 5, 'maxStockLevel' => null, 'warrantyMonths' => 0, 'imageUrl' => '', 'isActive' => true, 'openingStock' => 0,
        ])->assertStatus(201);
        $this->assertMatchesRegularExpression('/^P-\d{5}$/', $r->json('sku'));
        $this->assertNull($r->json('barcode'));
        $this->assertSame('950', $r->json('minSellingPrice'));
    }

    public function test_customer_supplier_expense_and_staff_forms_with_empty_optional_fields(): void
    {
        $owner = $this->owner();
        $owner->post('/api/customers', ['name' => 'Walk in Form', 'phone' => null, 'email' => null, 'notes' => null])->assertStatus(201);
        $owner->post('/api/suppliers', ['name' => 'Form supplier', 'contactPerson' => null, 'phone' => null, 'email' => null, 'address' => null,
            'businessRegNo' => null, 'notes' => null, 'isActive' => true])->assertStatus(201);
        $owner->post('/api/expenses', ['category' => 'Water', 'description' => 'Water bill', 'amount' => 850, 'expenseDate' => Clock::localToday(),
            'method' => 'CASH', 'reference' => '', 'paidFromDrawer' => false])->assertStatus(201)->assertJson(['reference' => '']);
        $owner->post('/api/users', ['username' => 'form.cashier', 'fullName' => 'Form Cashier', 'roleId' => 3, 'password' => 'Form-pass1', 'isActive' => true])->assertStatus(201);
        $owner->post('/api/categories', ['name' => 'Form category'])->assertStatus(201);
    }

    public function test_an_empty_amount_counts_as_zero(): void
    {
        $p = $this->makeProduct();
        $sup = $this->owner()->post('/api/suppliers', ['name' => 'Zero supplier'])->json('id');
        $po = $this->owner()->post('/api/purchases', ['supplierId' => $sup, 'purchaseDate' => '2026-10-10', 'items' => [['productId' => $p->id, 'qtyOrdered' => 1, 'unitCost' => 500]]])->json();
        $this->owner()->post("/api/purchases/{$po['id']}/receive", ['additionalCost' => '', 'items' => [['purchaseItemId' => $po['items'][0]['id'], 'qtyReceived' => 1]]])->assertOk();
    }
}
