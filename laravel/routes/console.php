<?php

use App\Services\Setup;
use App\Services\StockAlerts;
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

// php artisan pos:stock-alerts [--summary] -> email low-stock alerts not sent yet (or the full list, e.g. each morning)
Artisan::command('pos:stock-alerts {--summary : email the full list of low items}', function () {
    $n = $this->option('summary') ? StockAlerts::emailSummary() : StockAlerts::emailPending();
    $this->info($n ? "Low-stock email sent ($n item(s))." : 'Nothing to send (no new alerts, or no alert email in Settings).');
})->purpose('Email low-stock alerts to the owner');
