<?php

use App\Support\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Products may have no category.
return new class extends Migration
{
    public function up(): void
    {
        $nullable = DB::scalar("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'categoryId'");
        if ($nullable !== 'YES') {
            SqlFile::run(database_path('schema/2026_10_14_optional_product_category.sql'));
        }
    }

    public function down(): void
    {
        //
    }
};
