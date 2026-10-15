<?php

namespace Tests\Feature;

use App\Support\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

/** Opens every GET endpoint as owner, manager and cashier: nothing may crash, and the owner may open everything. */
class RouteSmokeTest extends TestCase
{
    public function test_every_get_endpoint_answers_for_every_role(): void
    {
        $owner = $this->owner();
        $p = $this->makeProduct(['warrantyMonths' => 6]);
        $sup = DB::table('suppliers')->insertGetId(['name' => 'Smoke supplier', 'isActive' => 1, 'createdAt' => Clock::now(), 'updatedAt' => Clock::now()]);
        $po = $owner->post('/api/purchases', ['supplierId' => $sup, 'purchaseDate' => '2026-10-01', 'items' => [['productId' => $p->id, 'qtyOrdered' => 2, 'unitCost' => 1000]]])->json('id');
        $sale = $owner->post('/api/sales', $this->sale($p->id, 1, ['customer' => ['name' => 'Smoke', 'phone' => '0711111111']]))->json('sale');
        $ids = ['products' => $p->id, 'suppliers' => $sup, 'purchases' => $po, 'sales' => $sale['id'], 'customers' => $sale['customerId']];

        $urls = [];
        foreach (Route::getRoutes() as $route) {
            if (! in_array('GET', $route->methods(), true) || ! str_starts_with($route->uri(), 'api/')) {
                continue;
            }
            $uri = '/'.$route->uri();
            if (str_contains($uri, '{key}')) {
                foreach (array_column($owner->get('/api/reports')->json(), 'key') as $k) {
                    $urls[] = str_replace('{key}', $k, $uri);
                }

                continue;
            }
            $section = explode('/', $route->uri())[1];
            $url = str_replace('{id}', (string) ($ids[$section] ?? 1), $uri);
            $urls[] = $url === '/api/returns/lookup' ? $url.'?invoice='.$sale['invoiceNumber'] : $url;
        }
        $this->assertGreaterThan(50, count($urls));

        $agents = ['owner' => $owner, 'manager' => $this->ensureUser('t_manager', 'manager'), 'cashier' => $this->ensureUser('t_cashier', 'cashier')];
        foreach ($agents as $role => $agent) {
            foreach ($urls as $url) {
                $s = $agent->get($url)->getStatusCode();
                $this->assertLessThan(500, $s, "$role $url crashed");
                if ($role === 'owner') {
                    $this->assertSame(200, $s, "owner $url");
                } else {
                    $this->assertContains($s, [200, 403], "$role $url");
                }
            }
        }
    }
}
