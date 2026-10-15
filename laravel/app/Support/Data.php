<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** Small database helpers shared by the services. */
class Data
{
    /** Next number in a gap-free sequence; call inside the transaction (the row lock is held until commit). */
    public static function nextSequence(string $key): int
    {
        DB::statement('INSERT INTO document_sequences (`key`, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [$key]);

        return (int) DB::scalar('SELECT value FROM document_sequences WHERE `key` = ?', [$key]);
    }

    public static function settings(): object
    {
        $s = DB::table('business_settings')->where('id', 1)->first();
        if (! $s) {
            DB::table('business_settings')->insertOrIgnore(['id' => 1, 'updatedAt' => Clock::now()]);
            $s = DB::table('business_settings')->where('id', 1)->first();
        }

        return $s;
    }

    /** Inserts a row with createdAt/updatedAt set (columns the original schema fills in code). */
    public static function insert(string $table, array $row, bool $updatedAt = false): int
    {
        if ($updatedAt) {
            $row['updatedAt'] = Clock::now();
        }
        if (! array_key_exists('createdAt', $row) && self::hasCreatedAt($table)) {
            $row['createdAt'] = Clock::now();
        }

        return (int) DB::table($table)->insertGetId($row);
    }

    private static function hasCreatedAt(string $table): bool
    {
        return ! in_array($table, ['role_permissions', 'permissions', 'purchase_items', 'goods_receipt_items', 'sale_items',
            'return_items', 'warranties', 'business_settings', 'document_sequences', 'goods_receipts', 'supplier_payments'], true);
    }

    public static function update(string $table, int $id, array $data, bool $updatedAt = false): int
    {
        if ($updatedAt) {
            $data['updatedAt'] = Clock::now();
        }

        return DB::table($table)->where('id', $id)->update($data);
    }
}
