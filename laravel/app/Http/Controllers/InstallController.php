<?php

namespace App\Http\Controllers;

use App\Services\Setup;
use Illuminate\Http\Request;

/**
 * One-time setup from the browser, for hosts without a terminal: /install?key=INSTALL_KEY creates or updates
 * the tables, roles and the owner account. Disabled while INSTALL_KEY is empty.
 */
class InstallController
{
    public function __invoke(Request $req)
    {
        $key = (string) config('pos.install_key');
        if ($key === '' || ! hash_equals($key, (string) $req->query('key'))) {
            abort(404);
        }
        try {
            $r = Setup::run();
        } catch (\Throwable $e) {
            report($e);

            return response("Setup failed: {$e->getMessage()}\n\nCheck the database settings in .env.", 500, ['Content-Type' => 'text/plain; charset=utf-8']);
        }
        $lines = ['YASH MOBILE POS setup', '', trim(preg_replace('/\e\[[\d;]*m/', '', $r['migrations'])) ?: 'Database is up to date.', ''];
        $lines[] = $r['ownerCreated'] ? 'Owner account created. Sign in as "owner" with the SEED_ADMIN_PASSWORD from .env.' : 'Roles and settings are up to date.';
        if ($r['warning']) {
            $lines[] = 'WARNING: '.$r['warning'];
        }
        $lines[] = '';
        $lines[] = 'Done. Now empty SEED_ADMIN_PASSWORD in .env. Keep INSTALL_KEY secret: open this page again after each update.';

        return response(implode("\n", $lines), 200, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}
