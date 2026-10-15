<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Turns database rows into the API's JSON shape: decimals as trimmed strings ("5400", "12.5"),
 * timestamps as ISO-8601 UTC ("2026-10-15T03:20:51.055Z"), booleans and JSON decoded.
 */
class Fmt
{
    private static ?array $types = null;

    private const JSON = ['audit_logs.details', 'cash_closings.nonCashTotals'];

    private static function types(): array
    {
        if (self::$types === null) {
            self::$types = [];
            $cols = DB::select('SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
            foreach ($cols as $col) {
                $key = "$col->t.$col->c";
                $d = strtolower($col->d);
                self::$types[$col->t][$col->c] = match (true) {
                    in_array($key, self::JSON, true) || $d === 'json' => 'json',
                    $d === 'decimal' => 'dec',
                    $d === 'datetime' || $d === 'timestamp' => 'iso',
                    $d === 'date' => 'date',
                    $d === 'tinyint' && str_starts_with(strtolower($col->ct), 'tinyint(1)') => 'bool',
                    in_array($d, ['int', 'integer', 'bigint', 'smallint', 'mediumint', 'tinyint'], true) => 'int',
                    default => 'str',
                };
            }
        }

        return self::$types;
    }

    public static function forget(): void
    {
        self::$types = null;
    }

    public static function dec(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = (string) $v;
        if (str_contains($s, '.')) {
            $s = rtrim(rtrim($s, '0'), '.');
        }
        if ($s === '-0' || $s === '' || $s === '-') {
            $s = '0';
        }

        return $s;
    }

    public static function iso(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = (string) $v;
        if (strlen($s) === 10) {
            return $s.'T00:00:00.000Z';
        }
        [$date, $time] = explode(' ', $s, 2) + [1 => '00:00:00'];
        [$hms, $frac] = explode('.', $time, 2) + [1 => '0'];

        return $date.'T'.$hms.'.'.str_pad(substr($frac, 0, 3), 3, '0').'Z';
    }

    /** Formats one row of $table (stdClass or array). Unknown columns pass through. */
    public static function row(string $table, object|array|null $row): ?array
    {
        if ($row === null) {
            return null;
        }
        $t = self::types()[$table] ?? [];
        $out = [];
        foreach ((array) $row as $k => $v) {
            $out[$k] = $v === null ? null : match ($t[$k] ?? 'raw') {
                'dec' => self::dec($v),
                'iso', 'date' => self::iso($v),
                'bool' => (bool) $v,
                'int' => (int) $v,
                'json' => is_string($v) ? json_decode($v, true) : $v,
                default => $v,
            };
        }

        return $out;
    }

    public static function rows(string $table, iterable $rows): array
    {
        $out = [];
        foreach ($rows as $r) {
            $out[] = self::row($table, $r);
        }

        return $out;
    }
}
