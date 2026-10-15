<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class Audit
{
    public static function log(?Request $req, string $action, string $entity, string|int|null $entityId, mixed $details = null): void
    {
        $user = $req ? Auth::user($req) : null;
        DB::table('audit_logs')->insert([
            'userId' => $user?->id,
            'username' => $user?->username,
            'action' => $action,
            'entity' => $entity,
            'entityId' => $entityId === null ? null : (string) $entityId,
            'details' => $details === null ? null : json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'ip' => $req?->ip(),
            'createdAt' => Clock::now(),
        ]);
    }
}
