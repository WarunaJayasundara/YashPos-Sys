<?php

use App\Services\Setup;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

// php artisan pos:setup  -> tables, roles, settings and the owner account (uses SEED_ADMIN_PASSWORD)
Artisan::command('pos:setup', function () {
    $r = Setup::run();
    $this->line($r['migrations']);
    $this->info($r['ownerCreated'] ? 'Owner account created (username: owner).' : 'Roles and settings are up to date.');
    if ($r['warning']) {
        $this->warn($r['warning']);
    }
})->purpose('Create or update the POS database and owner account');

// php artisan pos:prune-sessions -> drop expired sign-in sessions (optional cron job)
Artisan::command('pos:prune-sessions', function () {
    $this->info(DB::table('sessions')->where('expiresAt', '<', now('UTC')->format('Y-m-d H:i:s.v'))->delete().' expired session(s) removed');
})->purpose('Delete expired sessions');
