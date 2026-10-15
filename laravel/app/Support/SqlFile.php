<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

class SqlFile
{
    /** Splits a SQL file into statements (drops "--" comment lines). */
    public static function split(string $sql): array
    {
        $lines = array_filter(preg_split('/\r?\n/', $sql), fn ($l) => ! str_starts_with(trim($l), '--'));

        return array_values(array_filter(array_map('trim', preg_split('/;\s*(?:\n|$)/', implode("\n", $lines)))));
    }

    public static function run(string $path): void
    {
        foreach (self::split(file_get_contents($path)) as $stmt) {
            DB::unprepared($stmt);
        }
    }
}
