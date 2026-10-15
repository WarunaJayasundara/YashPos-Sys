<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\Data;
use App\Support\Fmt;
use App\Support\Money;
use App\Support\Perms;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PeopleController
{
    // ---------- customers ----------

    /** Outstanding = credit given on sales - payments received - store-credit refunds. */
    public static function balance(int $customerId): string
    {
        $r = DB::selectOne("SELECT
            (SELECT SUM(balanceDue) FROM sales WHERE customerId = ? AND status <> 'VOIDED') credit,
            (SELECT SUM(amount) FROM customer_payments WHERE customerId = ?) paid,
            (SELECT SUM(rf.amount) FROM refunds rf JOIN returns r ON r.id = rf.returnId JOIN sales s ON s.id = r.saleId
              WHERE s.customerId = ? AND rf.method = 'CREDIT') refunded", [$customerId, $customerId, $customerId]);

        return Money::fromCents(Money::toCents($r->credit) - Money::toCents($r->paid) - Money::toCents($r->refunded));
    }

    private static function customerRules(bool $partial): array
    {
        return [
            'name' => ($partial ? 'sometimes' : 'required').'|string|min:2|max:120',
            'phone' => ['sometimes', 'nullable', 'string', 'regex:/^[0-9+ -]{7,20}$/'],
            'email' => ['sometimes', 'nullable', 'string', 'max:120', fn ($a, $v, $fail) => $v === '' || filter_var($v, FILTER_VALIDATE_EMAIL) || $fail('Invalid email')],
            'notes' => 'sometimes|nullable|string|max:255',
        ];
    }

    public function customers(Request $req): JsonResponse
    {
        Auth::require($req, 'customers.view');
        $q = trim((string) $req->query('q', ''));
        $b = DB::table('customers');
        if ($q !== '') {
            $like = '%'.addcslashes($q, '%_\\').'%';
            $b->where(fn ($w) => $w->where('name', 'like', $like)->orWhere('phone', 'like', $like));
        }

        return response()->json($b->orderBy('name')->limit(100)->get()->map(fn ($c) => Fmt::row('customers', $c) + [
            '_count' => ['sales' => DB::table('sales')->where('customerId', $c->id)->count()],
            'balance' => self::balance((int) $c->id),
        ])->all());
    }

    public function customer(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'customers.view');
        $id = V::id($id);
        $c = DB::table('customers')->find($id);
        if (! $c) {
            throw ApiError::notFound('Customer not found');
        }

        return response()->json(Fmt::row('customers', $c) + [
            'sales' => Fmt::rows('sales', DB::table('sales')->where('customerId', $id)->orderByDesc('id')->limit(100)->get(['id', 'invoiceNumber', 'createdAt', 'total', 'balanceDue', 'status'])),
            'payments' => Fmt::rows('customer_payments', DB::table('customer_payments')->where('customerId', $id)->orderByDesc('id')->limit(100)->get()),
            'balance' => self::balance($id),
        ]);
    }

    public function customerStore(Request $req): JsonResponse
    {
        Auth::require($req, 'customers.manage');
        $d = V::check(V::trim($req->all(), ['name', 'phone']), self::customerRules(false));
        $id = Data::insert('customers', $d, true);
        Audit::log($req, 'customer.create', 'customer', $id);

        return response()->json(Fmt::row('customers', DB::table('customers')->find($id)), 201);
    }

    public function customerUpdate(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'customers.manage');
        $id = V::id($id);
        if (! DB::table('customers')->where('id', $id)->exists()) {
            throw ApiError::notFound('Record not found');
        }
        $d = V::check(V::trim($req->all(), ['name', 'phone']), self::customerRules(true));
        Data::update('customers', $id, $d, true);
        Audit::log($req, 'customer.update', 'customer', $id);

        return response()->json(Fmt::row('customers', DB::table('customers')->find($id)));
    }

    public function customerPay(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'customers.manage');
        $id = V::id($id);
        $d = V::check($req->all(), ['amount' => 'required|numeric|gt:0', 'method' => 'required|in:CASH,CARD,BANK_TRANSFER,QR', 'reference' => 'sometimes|nullable|string|max:80']);
        $bal = Money::toCents(self::balance($id));
        if (Money::toCents($d['amount']) > $bal) {
            throw ApiError::badRequest('Payment exceeds the outstanding balance of '.Money::fromCents($bal));
        }
        $pid = Data::insert('customer_payments', ['customerId' => $id, 'amount' => Money::fromCents(Money::toCents($d['amount'])), 'method' => $d['method'],
            'reference' => $d['reference'] ?? null, 'recordedById' => Auth::id($req)]);
        Audit::log($req, 'customer.payment', 'customer', $id, $req->only(['amount', 'method', 'reference']));

        return response()->json(Fmt::row('customer_payments', DB::table('customer_payments')->find($pid)), 201);
    }

    // ---------- warranties ----------

    public function warranties(Request $req): JsonResponse
    {
        Auth::require($req, 'warranty.manage', 'sales.view_all');
        $q = trim((string) $req->query('q', ''));
        $status = $req->query('status');
        $b = DB::table('warranties as w')->join('sales as s', 's.id', '=', 'w.saleId')->join('products as p', 'p.id', '=', 'w.productId')
            ->select('w.*', 'p.name as _pname', 'p.sku as _psku', 's.invoiceNumber as _inv', 's.customerName as _cname', 's.customerPhone as _cphone');
        if (is_string($status) && $status !== '') {
            $status === 'ACTIVE' ? $b->where('w.expiresAt', '>', Clock::now()) : $b->where('w.claimStatus', $status);
        }
        if ($q !== '') {
            $like = '%'.addcslashes($q, '%_\\').'%';
            $b->where(fn ($w) => $w->where('w.serialNumber', 'like', $like)->orWhere('s.invoiceNumber', 'like', $like)->orWhere('s.customerPhone', 'like', $like));
        }
        $now = Clock::now();

        return response()->json($b->orderByDesc('w.id')->limit(200)->get()->map(fn ($w) => Fmt::row('warranties', collect((array) $w)->reject(fn ($v, $k) => $k[0] === '_')->all()) + [
            'product' => ['name' => $w->_pname, 'sku' => $w->_psku],
            'sale' => ['invoiceNumber' => $w->_inv, 'customerName' => $w->_cname, 'customerPhone' => $w->_cphone],
            'isActive' => $w->expiresAt > $now,
        ])->all());
    }

    public function warrantyUpdate(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'warranty.manage');
        $id = V::id($id);
        $d = V::check($req->all(), ['claimStatus' => 'sometimes|in:NONE,OPEN,IN_REPAIR,REPLACED,REJECTED,CLOSED', 'claimNotes' => 'sometimes|nullable|string|max:5000',
            'resolution' => 'sometimes|nullable|string|max:5000', 'serialNumber' => 'sometimes|nullable|string|max:80']);
        if (! DB::table('warranties')->where('id', $id)->exists()) {
            throw ApiError::notFound('Record not found');
        }
        Data::update('warranties', $id, $d, true);
        Audit::log($req, 'warranty.update', 'warranty', $id, $d);

        return response()->json(Fmt::row('warranties', DB::table('warranties')->find($id)));
    }

    // ---------- staff, roles and permissions ----------

    public function users(Request $req): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $rows = DB::table('users as u')->join('roles as r', 'r.id', '=', 'u.roleId')->orderBy('u.fullName')
            ->get(['u.id', 'u.username', 'u.fullName', 'u.isActive', 'u.lastLoginAt', 'u.createdAt', 'r.id as rid', 'r.code as rcode', 'r.name as rname']);

        return response()->json($rows->map(fn ($u) => Fmt::row('users', collect((array) $u)->only(['id', 'username', 'fullName', 'isActive', 'lastLoginAt', 'createdAt'])->all())
            + ['role' => ['id' => (int) $u->rid, 'code' => $u->rcode, 'name' => $u->rname]])->all());
    }

    /** Minimal staff list (id + name) for report filters. */
    public function staff(Request $req): JsonResponse
    {
        Auth::require($req, 'reports.sales', 'sales.view_all', 'audit.view');

        return response()->json(DB::table('users')->orderBy('fullName')->get(['id', 'fullName'])->map(fn ($u) => ['id' => (int) $u->id, 'fullName' => $u->fullName])->all());
    }

    private static function userRules(bool $partial): array
    {
        $s = $partial ? 'sometimes' : 'required';

        return [
            'username' => [$s, 'string', 'regex:/^[a-z0-9._-]{3,50}$/'],
            'fullName' => "$s|string|min:2|max:120",
            'roleId' => "$s|integer|min:1",
            'password' => "$s|string|min:8|max:200",
            'isActive' => 'sometimes|boolean',
        ];
    }

    private static function userInput(Request $req): array
    {
        $in = V::trim($req->all(), ['username', 'fullName']);
        if (isset($in['username']) && is_string($in['username'])) {
            $in['username'] = strtolower($in['username']);
        }

        return $in;
    }

    public function userStore(Request $req): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $d = V::check(self::userInput($req), self::userRules(false), ['username.regex' => '3-50 characters: letters, digits, . _ -']);
        if (! DB::table('roles')->where('id', $d['roleId'])->exists()) {
            throw new ApiError(409, 'Record is referenced by other data', 'IN_USE');
        }
        $id = Data::insert('users', ['username' => $d['username'], 'fullName' => $d['fullName'], 'roleId' => (int) $d['roleId'],
            'passwordHash' => Auth::hashPassword($d['password']), 'isActive' => (int) ($d['isActive'] ?? true)], true);
        Audit::log($req, 'user.create', 'user', $id, ['username' => $d['username'], 'roleId' => (int) $d['roleId']]);

        return response()->json(['id' => $id, 'username' => $d['username']], 201);
    }

    public function userUpdate(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $id = V::id($id);
        $d = V::check(self::userInput($req), self::userRules(true), ['username.regex' => '3-50 characters: letters, digits, . _ -']);
        $password = $d['password'] ?? null;
        unset($d['password']);
        if (isset($d['isActive'])) {
            $d['isActive'] = (int) filter_var($d['isActive'], FILTER_VALIDATE_BOOLEAN);
        }
        if ($id === Auth::id($req) && ((isset($d['isActive']) && ! $d['isActive']) || isset($d['roleId']))) {
            throw ApiError::badRequest('You cannot deactivate or change the role of your own account');
        }
        if (! DB::table('users')->where('id', $id)->exists()) {
            throw ApiError::notFound('Record not found');
        }
        $data = $d + ($password ? ['passwordHash' => Auth::hashPassword($password)] : []);
        Data::update('users', $id, $data, true);
        if ($password || (isset($d['isActive']) && ! $d['isActive']) || isset($d['roleId'])) {
            DB::table('sessions')->where('userId', $id)->delete();
        }
        Audit::log($req, 'user.update', 'user', $id, $d + ['passwordChanged' => (bool) $password]);
        $u = DB::table('users')->find($id);

        return response()->json(['id' => (int) $u->id, 'username' => $u->username, 'isActive' => (bool) $u->isActive]);
    }

    public function roles(Request $req): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $roles = DB::table('roles')->orderBy('id')->get()->map(fn ($r) => [
            'id' => (int) $r->id, 'code' => $r->code, 'name' => $r->name, 'isSystem' => (bool) $r->isSystem, 'maxDiscountPercent' => Fmt::dec($r->maxDiscountPercent),
            'users' => DB::table('users')->where('roleId', $r->id)->count(),
            'permissions' => DB::table('role_permissions as rp')->join('permissions as p', 'p.id', '=', 'rp.permissionId')->where('rp.roleId', $r->id)->orderBy('rp.permissionId')->pluck('p.code')->all(),
        ]);

        return response()->json(['roles' => $roles->all(), 'permissions' => array_map(fn ($c) => ['code' => $c, 'description' => Perms::ALL[$c]], Perms::codes())]);
    }

    private static function roleRules(bool $partial): array
    {
        $s = $partial ? 'sometimes' : 'required';

        return ['name' => "$s|string|min:2|max:80", 'code' => [$s, 'string', 'regex:/^[a-z0-9_]{2,40}$/'], 'maxDiscountPercent' => "$s|numeric|min:0|max:100",
            'permissions' => "$s|array", 'permissions.*' => 'string|in:'.implode(',', Perms::codes())];
    }

    private static function setRolePerms(int $roleId, array $codes): void
    {
        DB::transaction(function () use ($roleId, $codes) {
            DB::table('role_permissions')->where('roleId', $roleId)->delete();
            $ids = DB::table('permissions')->whereIn('code', $codes)->pluck('id');
            DB::table('role_permissions')->insert($ids->map(fn ($p) => ['roleId' => $roleId, 'permissionId' => $p])->all());
        });
    }

    public function roleStore(Request $req): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $in = V::trim($req->all(), ['name', 'code']);
        if (isset($in['code']) && is_string($in['code'])) {
            $in['code'] = strtolower($in['code']);
        }
        $d = V::check($in, self::roleRules(false));
        $id = Data::insert('roles', ['name' => $d['name'], 'code' => $d['code'], 'maxDiscountPercent' => number_format((float) $d['maxDiscountPercent'], 2, '.', ''), 'isSystem' => 0], true);
        self::setRolePerms($id, $d['permissions']);
        Audit::log($req, 'role.create', 'role', $id, ['name' => $d['name'], 'code' => $d['code'], 'maxDiscountPercent' => (float) $d['maxDiscountPercent'], 'permissions' => $d['permissions']]);

        return response()->json(Fmt::row('roles', DB::table('roles')->find($id)), 201);
    }

    public function roleUpdate(Request $req, string $id): JsonResponse
    {
        Auth::require($req, 'users.manage');
        $id = V::id($id);
        $role = DB::table('roles')->find($id);
        if (! $role) {
            throw ApiError::notFound();
        }
        $in = V::trim($req->all(), ['name', 'code']);
        if (isset($in['code']) && is_string($in['code'])) {
            $in['code'] = strtolower($in['code']);
        }
        $d = V::check($in, self::roleRules(true));
        $perms = $d['permissions'] ?? null;
        if ($role->code === 'admin' && $perms !== null && array_diff(Perms::codes(), $perms)) {
            throw ApiError::conflict('The Admin / Owner role always keeps every permission');
        }
        $data = array_filter(['name' => $d['name'] ?? null, 'code' => $role->isSystem ? null : ($d['code'] ?? null),
            'maxDiscountPercent' => isset($d['maxDiscountPercent']) ? number_format((float) $d['maxDiscountPercent'], 2, '.', '') : null], fn ($v) => $v !== null);
        Data::update('roles', $id, $data, true);
        if ($perms !== null) {
            self::setRolePerms($id, $perms);
        }
        Audit::log($req, 'role.update', 'role', $id, collect($d)->except('permissions')->all() + ['permissions' => $perms]);

        return response()->json(['ok' => true]);
    }

    // ---------- audit log ----------

    public function audit(Request $req): JsonResponse
    {
        Auth::require($req, 'audit.view');
        $q = V::check($req->query(), ['entity' => 'sometimes|string', 'action' => 'sometimes|string', 'userId' => 'sometimes|integer',
            'from' => 'sometimes|string', 'to' => 'sometimes|string', 'limit' => 'sometimes|integer|max:1000']);
        $b = DB::table('audit_logs');
        if (! empty($q['entity'])) {
            $b->where('entity', $q['entity']);
        }
        if (! empty($q['action'])) {
            $b->where('action', 'like', '%'.addcslashes($q['action'], '%_\\').'%');
        }
        if (! empty($q['userId'])) {
            $b->where('userId', (int) $q['userId']);
        }
        if (! empty($q['from']) || ! empty($q['to'])) {
            $r = Clock::range($q['from'] ?? null, $q['to'] ?? null);
            $b->where('createdAt', '>=', $r['gte'])->where('createdAt', '<', $r['lt']);
        }

        return response()->json(Fmt::rows('audit_logs', $b->orderByDesc('id')->limit((int) ($q['limit'] ?? 200))->get()));
    }
}
