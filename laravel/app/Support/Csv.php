<?php

namespace App\Support;

use Symfony\Component\HttpFoundation\Response;

class Csv
{
    private static function esc(mixed $v): string
    {
        if ($v === null) {
            return '';
        }
        $s = is_bool($v) ? ($v ? 'true' : 'false') : (string) $v;
        // neutralise spreadsheet formula injection
        if (preg_match('/^[=+\-@\t\r]/', $s) && ! preg_match('/^-?\d+(\.\d+)?$/', $s)) {
            $s = "'".$s;
        }

        return preg_match('/[",\n\r]/', $s) ? '"'.str_replace('"', '""', $s).'"' : $s;
    }

    /** @param array<array{key:string,label:string}>|null $cols */
    public static function make(array $rows, ?array $cols = null): string
    {
        $cols ??= array_map(fn ($k) => ['key' => $k, 'label' => $k], array_keys($rows[0] ?? []));
        $lines = [implode(',', array_map(fn ($c) => self::esc($c['label']), $cols))];
        foreach ($rows as $r) {
            $lines[] = implode(',', array_map(fn ($c) => self::esc($r[$c['key']] ?? null), $cols));
        }

        return implode("\r\n", $lines);
    }

    public static function response(string $filename, string $csv): Response
    {
        return new Response("\u{FEFF}".$csv, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="'.preg_replace('/[^\w.-]/', '_', $filename).'"',
        ]);
    }

    /** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
    public static function parse(string $text): array
    {
        $t = preg_replace('/^\x{FEFF}/u', '', $text);
        $rows = [];
        $row = [];
        $field = '';
        $q = false;
        $len = strlen($t);
        for ($i = 0; $i < $len; $i++) {
            $ch = $t[$i];
            if ($q) {
                if ($ch === '"' && ($t[$i + 1] ?? '') === '"') {
                    $field .= '"';
                    $i++;
                } elseif ($ch === '"') {
                    $q = false;
                } else {
                    $field .= $ch;
                }
            } elseif ($ch === '"') {
                $q = true;
            } elseif ($ch === ',') {
                $row[] = $field;
                $field = '';
            } elseif ($ch === "\n" || $ch === "\r") {
                if ($ch === "\r" && ($t[$i + 1] ?? '') === "\n") {
                    $i++;
                }
                $row[] = $field;
                $field = '';
                if (array_filter($row, fn ($c) => $c !== '')) {
                    $rows[] = $row;
                }
                $row = [];
            } else {
                $field .= $ch;
            }
        }
        $row[] = $field;
        if (array_filter($row, fn ($c) => $c !== '')) {
            $rows[] = $row;
        }
        if (! $rows) {
            return [];
        }
        $keys = array_map('trim', array_shift($rows));

        return array_map(fn ($r) => array_combine($keys, array_map(fn ($i) => trim($r[$i] ?? ''), array_keys($keys))), $rows);
    }
}
