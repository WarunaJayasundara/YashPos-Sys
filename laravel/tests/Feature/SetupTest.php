<?php

namespace Tests\Feature;

use App\Services\Setup;
use App\Support\SqlFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SetupTest extends TestCase
{
    public function test_splits_the_schema_file_into_single_statements(): void
    {
        $this->assertSame(['CREATE TABLE `x` (`a` INT)', 'ALTER TABLE `x` ADD `b` INT'], SqlFile::split("-- a\nCREATE TABLE `x` (`a` INT);\n\n-- b\nALTER TABLE `x` ADD `b` INT;\n"));
        $steps = SqlFile::split(file_get_contents(database_path('schema/2026_10_14_init.sql')));
        $this->assertGreaterThan(30, count($steps));
        foreach ($steps as $s) {
            $this->assertMatchesRegularExpression('/^(CREATE|ALTER)\s/i', $s);
        }
    }

    public function test_is_safe_to_run_again_and_never_replaces_the_owner_password(): void
    {
        $roles = DB::table('roles')->count();
        $perms = DB::table('role_permissions')->count();
        $hash = DB::table('users')->where('username', 'owner')->value('passwordHash');
        Setup::run('Another-Pass1!');
        Setup::run();
        $this->assertSame($roles, DB::table('roles')->count());
        $this->assertSame($perms, DB::table('role_permissions')->count());
        $this->assertSame($hash, DB::table('users')->where('username', 'owner')->value('passwordHash'));
    }

    public function test_install_page_is_hidden_without_the_key_and_runs_with_it(): void
    {
        config(['pos.install_key' => '']);
        $this->get('/install?key=')->assertStatus(404);
        config(['pos.install_key' => 'secret-key-123']);
        $this->get('/install?key=wrong')->assertStatus(404);
        $this->get('/install?key=secret-key-123')->assertOk()->assertSee('Roles and settings are up to date.');
    }

    public function test_passwords_hashed_by_the_original_node_server_still_work(): void
    {
        // bcryptjs writes $2a$ hashes; PHP must accept them so existing staff keep their passwords
        $node = '$2a$12$'.substr(password_hash('Node-pass1', PASSWORD_BCRYPT, ['cost' => 12]), 7);
        $this->ensureUser('t_node', 'cashier');
        DB::table('users')->where('username', 't_node')->update(['passwordHash' => $node]);
        $this->login('t_node', 'Node-pass1')->get('/api/auth/me')->assertOk()->assertJsonPath('user.username', 't_node');
    }
}
