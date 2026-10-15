<?php

namespace App\Support;

/** Money helpers: all arithmetic is done in integer cents to avoid float drift. */
class Money
{
    public static function toCents(mixed $v): int
    {
        if ($v === null || $v === '') {
            return 0;
        }
        if (! is_numeric($v)) {
            throw new \InvalidArgumentException('Invalid amount: '.$v);
        }

        return (int) round(((float) $v) * 100);
    }

    public static function fromCents(int|float $c): string
    {
        $c = (int) round($c);
        $sign = $c < 0 ? '-' : '';
        $abs = abs($c);

        return $sign.intdiv($abs, 100).'.'.str_pad((string) ($abs % 100), 2, '0', STR_PAD_LEFT);
    }

    public static function num(mixed $v): float
    {
        return ($v === null || $v === '') ? 0.0 : (float) $v;
    }

    /** Fixed decimals like JS toFixed. */
    public static function fixed(mixed $v, int $d = 2): string
    {
        $s = number_format((float) $v, $d, '.', '');

        return $s === '-0.'.str_repeat('0', $d) || $s === '-0' ? substr($s, 1) : $s;
    }

    /** Splits $total cents across $weights; remainders go to the largest fractions so parts sum exactly. */
    public static function allocate(int $total, array $weights): array
    {
        $sum = array_sum($weights);
        if ($sum <= 0 || $total === 0) {
            return array_map(fn () => 0, $weights);
        }
        $raw = array_map(fn ($w) => $total * $w / $sum, $weights);
        $parts = array_map(fn ($r) => (int) floor($r), $raw);
        $rest = $total - array_sum($parts);
        $order = array_keys($raw);
        usort($order, fn ($a, $b) => ($raw[$b] - floor($raw[$b])) <=> ($raw[$a] - floor($raw[$a])));
        for ($k = 0; $rest > 0; $k = ($k + 1) % count($order), $rest--) {
            $parts[$order[$k]]++;
        }

        return $parts;
    }
}
