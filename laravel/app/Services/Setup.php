<?php

namespace App\Services;

use App\Support\Auth;
use App\Support\Clock;
use App\Support\Perms;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/** Creates or updates the tables, roles, settings and the owner account. Safe to run any number of times. */
class Setup
{
    /** @return array{migrations:string,ownerCreated:bool,warning:?string} */
    public static function run(?string $ownerPassword = null): array
    {
        Artisan::call('migrate', ['--force' => true]);
        $migrations = trim(Artisan::output());
        self::accessControl();
        $created = false;
        $warning = null;
        if (! DB::table('users')->exists()) {
            $pw = $ownerPassword ?: config('pos.seed_admin_password');
            if (! $pw) {
                $warning = 'No users yet: set SEED_ADMIN_PASSWORD in .env and run the setup again.';
            } else {
                $created = self::owner($pw);
            }
        }

        return ['migrations' => $migrations, 'ownerCreated' => $created, 'warning' => $warning];
    }

    /** Permissions and system roles. Admin always holds every permission; other roles get defaults only once. */
    public static function accessControl(): void
    {
        foreach (Perms::ALL as $code => $description) {
            DB::statement('INSERT INTO permissions (code, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE description = VALUES(description)', [$code, $description]);
        }
        $perms = DB::table('permissions')->pluck('id', 'code');
        foreach (Perms::defaultRoles() as $r) {
            $role = DB::table('roles')->where('code', $r['code'])->first();
            $roleId = $role ? (int) $role->id : (int) DB::table('roles')->insertGetId([
                'code' => $r['code'], 'name' => $r['name'], 'maxDiscountPercent' => number_format($r['maxDiscountPercent'], 2, '.', ''),
                'isSystem' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now(),
            ]);
            $existing = DB::table('role_permissions')->where('roleId', $roleId)->count();
            if ($r['code'] === 'admin' || $existing === 0) {
                DB::table('role_permissions')->insertOrIgnore(array_map(fn ($p) => ['roleId' => $roleId, 'permissionId' => $perms[$p]], $r['permissions']));
            }
        }
        DB::table('business_settings')->insertOrIgnore(['id' => 1, 'updatedAt' => Clock::now()]);
    }

    /** Creates the owner once; never changes an existing password. */
    public static function owner(string $password): bool
    {
        if (DB::table('users')->where('username', 'owner')->exists()) {
            return false;
        }
        DB::table('users')->insert([
            'username' => 'owner', 'fullName' => 'Shop Owner', 'roleId' => DB::table('roles')->where('code', 'admin')->value('id'),
            'passwordHash' => Auth::hashPassword($password), 'isActive' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now(),
        ]);

        return true;
    }
}
