<?php

use App\Support\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

// The POS schema (identical to the original Node/Prisma one, so an existing database can be adopted as is).
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('roles')) {
            SqlFile::run(database_path('schema/2026_10_14_init.sql'));
        }
    }

    public function down(): void
    {
        // not reversible: it would delete the shop's data
    }
};
