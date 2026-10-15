<?php

namespace App\Support;

/** Business days in local time (Sri Lanka, no DST); the database stores UTC. */
class Clock
{
    public static function offsetMinutes(): int
    {
        return (int) config('pos.tz_offset_minutes', 330);
    }

    /** "+05:30" for CONVERT_TZ. */
    public static function tzSql(): string
    {
        $m = abs(self::offsetMinutes());

        return (self::offsetMinutes() < 0 ? '-' : '+').sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    }

    /** Current UTC time as a DATETIME(3) value. */
    public static function now(): string
    {
        return self::db(microtime(true));
    }

    public static function db(float $ts): string
    {
        $sec = (int) floor($ts);

        return gmdate('Y-m-d H:i:s', $sec).'.'.sprintf('%03d', (int) round(($ts - $sec) * 1000) % 1000);
    }

    public static function localToday(?float $now = null): string
    {
        return gmdate('Y-m-d', (int) (($now ?? microtime(true)) + self::offsetMinutes() * 60));
    }

    /** Start of a local day as a UTC DATETIME value. */
    public static function localDayStart(string $day): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $day));

        return gmdate('Y-m-d H:i:s', gmmktime(0, 0, 0, $m, $d, $y) - self::offsetMinutes() * 60).'.000';
    }

    public static function addDays(string $day, int $n): string
    {
        [$y, $m, $d] = array_map('intval', explode('-', $day));

        return gmdate('Y-m-d', gmmktime(0, 0, 0, $m, $d + $n, $y));
    }

    /** Inclusive local date range -> [gte, lt) UTC bounds. Defaults to today. */
    public static function range(?string $from = null, ?string $to = null): array
    {
        $f = $from ?: self::localToday();
        $t = $to ?: $f;
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $t)) {
            throw ApiError::badRequest('Dates must be YYYY-MM-DD');
        }

        return ['from' => $f, 'to' => $t, 'gte' => self::localDayStart($f), 'lt' => self::localDayStart(self::addDays($t, 1))];
    }

    /** A YYYY-MM-DD date stored at UTC midnight (purchase, expense and closing dates). */
    public static function dateValue(string $day): string
    {
        return $day.' 00:00:00.000';
    }
}
