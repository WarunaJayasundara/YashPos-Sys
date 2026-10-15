<?php

namespace Tests;

use App\Services\Setup;
use App\Support\Auth;
use App\Support\Clock;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Tests share one database built once per run (like the original suite); each test creates its own data. */
abstract class TestCase extends BaseTestCase
{
    private static bool $ready = false;

    private static int $n = 0;

    protected function setUp(): void
    {
        parent::setUp();
        if (! self::$ready) {
            Setup::run('Owner@12345');
            self::$ready = true;
        }
    }

    protected function login(string $username, string $password): Agent
    {
        $r = (new Agent($this))->post('/api/auth/login', ['username' => $username, 'password' => $password]);
        if ($r->status() !== 200) {
            $this->fail("login $username failed: {$r->status()} {$r->getContent()}");
        }
        $cookie = collect($r->headers->getCookies())->first(fn ($c) => $c->getName() === Auth::COOKIE);

        return new Agent($this, $cookie->getValue());
    }

    protected function owner(): Agent
    {
        return $this->login('owner', 'Owner@12345');
    }

    protected function ensureUser(string $username, string $role, string $password = 'Passw0rd!x'): Agent
    {
        $roleId = DB::table('roles')->where('code', $role)->value('id');
        $row = ['roleId' => $roleId, 'isActive' => 1, 'passwordHash' => Auth::hashPassword($password), 'updatedAt' => Clock::now()];
        if (DB::table('users')->where('username', $username)->exists()) {
            DB::table('users')->where('username', $username)->update($row);
        } else {
            DB::table('users')->insert($row + ['username' => $username, 'fullName' => "Test $username", 'createdAt' => Clock::now()]);
        }

        return $this->login($username, $password);
    }

    protected function makeProduct(array $overrides = []): object
    {
        self::$n++;
        DB::table('categories')->insertOrIgnore(['name' => 'Test category', 'isActive' => 1, 'createdAt' => Clock::now()]);
        $id = DB::table('products')->insertGetId(array_merge([
            'sku' => 'T-'.(int) (microtime(true) * 1000).'-'.self::$n, 'name' => 'Test product '.self::$n,
            'categoryId' => DB::table('categories')->where('name', 'Test category')->value('id'),
            'purchasePrice' => 1200, 'avgCost' => 1200, 'sellingPrice' => 1800, 'minSellingPrice' => 1500, 'qtyOnHand' => 20,
            'createdAt' => Clock::now(), 'updatedAt' => Clock::now(),
        ], $overrides));

        return DB::table('products')->find($id);
    }

    protected function sale(int $productId, int $qty = 1, array $extra = []): array
    {
        return array_merge(['clientRequestId' => (string) Str::uuid(), 'items' => [['productId' => $productId, 'qty' => $qty]],
            'payments' => [['method' => 'CASH', 'amount' => 1000000]]], $extra);
    }

    protected function qty(int $productId): int
    {
        return (int) DB::table('products')->where('id', $productId)->value('qtyOnHand');
    }
}
