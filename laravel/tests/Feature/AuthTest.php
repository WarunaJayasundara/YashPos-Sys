<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\Agent;
use Tests\TestCase;

class AuthTest extends TestCase
{
    public function test_rejects_a_wrong_password_and_records_the_attempt(): void
    {
        $r = (new Agent($this))->post('/api/auth/login', ['username' => 'owner', 'password' => 'nope']);
        $r->assertStatus(401);
        $this->assertGreaterThan(0, DB::table('audit_logs')->where('action', 'auth.login_failed')->count());
    }

    public function test_signs_in_with_an_httponly_samesite_strict_cookie_and_returns_permissions(): void
    {
        $r = (new Agent($this))->post('/api/auth/login', ['username' => 'owner', 'password' => 'Owner@12345']);
        $r->assertOk();
        $this->assertContains('reports.financial', $r->json('user.permissions'));
        $cookie = (string) collect($r->headers->getCookies())->first(fn ($c) => $c->getName() === 'yash_sid');
        $this->assertMatchesRegularExpression('/httponly/i', $cookie);
        $this->assertMatchesRegularExpression('/samesite=strict/i', $cookie);
    }

    public function test_answers_malformed_ids_and_unknown_records_with_4xx_never_500(): void
    {
        $owner = $this->owner();
        foreach (['/api/sales/abc', '/api/products/xyz', '/api/purchases/1.5', '/api/sales/abc/invoice.pdf', '/api/customers/-'] as $url) {
            $s = $owner->get($url)->status();
            $this->assertTrue($s >= 400 && $s < 500, "$url gave $s");
        }
        $owner->get('/api/sales/999999')->assertStatus(404);
        $owner->get('/api/purchases/1.5')->assertStatus(404);
        $owner->get('/api/products/0')->assertStatus(404);
        $owner->get('/api/nope')->assertStatus(404);
    }

    public function test_requires_a_session_for_api_routes(): void
    {
        (new Agent($this))->get('/api/products')->assertStatus(401);
    }

    public function test_blocks_state_changing_requests_without_the_csrf_header(): void
    {
        $r = $this->owner()->post('/api/categories', ['name' => 'No header'], csrf: false);
        $r->assertStatus(403);
        $this->assertSame('CSRF', $r->json('error.code'));
    }

    public function test_malformed_json_is_a_400(): void
    {
        $r = $this->call('POST', '/api/auth/login', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_REQUESTED_WITH' => 'yash-pos'], '{"username":');
        $r->assertStatus(400);
        $this->assertSame('BAD_JSON', $r->json('error.code'));
    }

    public function test_logout_invalidates_the_session_server_side(): void
    {
        $agent = $this->owner();
        $agent->post('/api/auth/logout')->assertOk();
        $agent->get('/api/auth/me')->assertStatus(401);
    }

    public function test_rate_limits_repeated_failed_logins(): void
    {
        $statuses = [];
        for ($i = 0; $i < 7; $i++) {
            $statuses[] = (new Agent($this))->post('/api/auth/login', ['username' => 'ratelimit', 'password' => 'x'])->status();
        }
        $this->assertContains(429, $statuses);
    }

    public function test_change_password_keeps_this_session_and_ends_others(): void
    {
        $this->ensureUser('t_pw', 'cashier', 'First-pass1');
        $other = $this->login('t_pw', 'First-pass1');
        $me = $this->login('t_pw', 'First-pass1');
        $me->post('/api/auth/change-password', ['currentPassword' => 'wrong', 'newPassword' => 'Second-pass2'])->assertStatus(400);
        $me->post('/api/auth/change-password', ['currentPassword' => 'First-pass1', 'newPassword' => 'Second-pass2'])->assertOk();
        $me->get('/api/auth/me')->assertOk();
        $other->get('/api/auth/me')->assertStatus(401);
        $this->login('t_pw', 'Second-pass2');
    }

    // ---- role-based access (enforced by the API) ----

    public function test_cashier_never_receives_buying_price_cost_or_margin(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $p = $this->makeProduct();
        $row = $cashier->get('/api/products', ['q' => $p->sku])->assertOk()->json('data.0');
        $this->assertArrayHasKey('sellingPrice', $row);
        foreach (['purchasePrice', 'avgCost', 'marginPercent'] as $k) {
            $this->assertArrayNotHasKey($k, $row);
        }
        $one = $cashier->get("/api/products/$p->id")->json();
        $this->assertArrayNotHasKey('avgCost', $one);
        $this->assertArrayNotHasKey('lifetime', $one);
    }

    public function test_cashier_cannot_open_financial_reports_staff_management_or_settings_changes(): void
    {
        $cashier = $this->ensureUser('t_cashier', 'cashier');
        $cashier->get('/api/reports/net-profit')->assertStatus(403);
        $cashier->get('/api/reports/profit-by-product')->assertStatus(403);
        $cashier->get('/api/users')->assertStatus(403);
        $cashier->put('/api/settings', ['shopName' => 'Hacked'])->assertStatus(403);
        $cashier->post('/api/products', [])->assertStatus(403);
        $cashier->get('/api/audit-logs')->assertStatus(403);
    }

    public function test_manager_sees_cost_but_not_owner_only_financial_reports_by_default(): void
    {
        $manager = $this->ensureUser('t_manager', 'manager');
        $p = $this->makeProduct();
        $this->assertArrayHasKey('avgCost', $manager->get("/api/products/$p->id")->json());
        $manager->get('/api/reports/net-profit')->assertStatus(403);
        $manager->get('/api/users')->assertStatus(403);
        $this->assertArrayNotHasKey('grossProfit', $manager->get('/api/dashboard')->json('period'));
    }

    public function test_changing_a_role_removes_the_staff_members_sessions(): void
    {
        $owner = $this->owner();
        $cashier = $this->ensureUser('t_demote', 'cashier');
        $id = DB::table('users')->where('username', 't_demote')->value('id');
        $mgr = DB::table('roles')->where('code', 'manager')->value('id');
        $owner->put("/api/users/$id", ['roleId' => $mgr])->assertOk();
        $cashier->get('/api/auth/me')->assertStatus(401);
    }

    public function test_owner_cannot_deactivate_themselves_and_admin_keeps_every_permission(): void
    {
        $owner = $this->owner();
        $me = $owner->get('/api/auth/me')->json('user.id');
        $owner->put("/api/users/$me", ['isActive' => false])->assertStatus(400);
        $admin = DB::table('roles')->where('code', 'admin')->value('id');
        $owner->put("/api/roles/$admin", ['permissions' => ['sales.create']])->assertStatus(409);
    }

    public function test_spa_pages_are_served_and_unknown_api_paths_are_json(): void
    {
        $this->get('/pos')->assertStatus(is_file(public_path('index.html')) ? 200 : 503);
        $this->get('/api/health')->assertOk()->assertJson(['ok' => true]);
        foreach (['/.env', '/storage/.git/config'] as $hidden) {
            $this->assertContains($this->get($hidden)->status(), [403, 404], $hidden);
        }
    }
}
