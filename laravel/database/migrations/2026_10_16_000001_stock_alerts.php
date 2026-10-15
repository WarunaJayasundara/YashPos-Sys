<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Low-stock alerts: one row each time a product drops to its reorder level or sells out; emailed to the owner.
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('stock_alerts')) {
            Schema::create('stock_alerts', function (Blueprint $t) {
                $t->increments('id');
                $t->integer('productId');
                $t->string('level', 10); // LOW | OUT
                $t->integer('qtyAvailable');
                $t->integer('reorderLevel');
                $t->dateTime('createdAt', 3)->useCurrent();
                $t->dateTime('emailedAt', 3)->nullable();
                $t->index('createdAt');
                $t->index('emailedAt');
                $t->foreign('productId')->references('id')->on('products')->cascadeOnDelete();
            });
        }
        Schema::table('business_settings', function (Blueprint $t) {
            if (! Schema::hasColumn('business_settings', 'alertEmail')) {
                $t->string('alertEmail', 120)->default('');
            }
            if (! Schema::hasColumn('business_settings', 'lowStockAlerts')) {
                $t->boolean('lowStockAlerts')->default(true);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_alerts');
        Schema::table('business_settings', fn (Blueprint $t) => $t->dropColumn(['alertEmail', 'lowStockAlerts']));
    }
};
