<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/** Server-side sessions (hashed token in the database, httpOnly SameSite=Strict cookie) and permission checks. */
class Auth
{
    public const COOKIE = 'yash_sid';

    // timing-safe stand-in when the username does not exist
    private const DUMMY_HASH = '$2y$12$tkvgG8ZPM1lcIFcxtNbdhemJCSejsxgcn2L6iT/Ki4svWue3u/q4S';

    public static function ttlSeconds(): int
    {
        return config('pos.session_ttl_hours', 12) * 3600;
    }

    public static function hashPassword(string $p): string
    {
        return password_hash($p, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    public static function load(int $userId): ?object
    {
        $u = DB::table('users')->join('roles', 'roles.id', '=', 'users.roleId')
            ->where('users.id', $userId)
            ->select('users.id', 'users.username', 'users.fullName', 'users.isActive', 'roles.code as roleCode', 'roles.name as roleName', 'roles.maxDiscountPercent')
            ->first();
        if (! $u || ! $u->isActive) {
            return null;
        }
        $perms = DB::table('role_permissions')->join('permissions', 'permissions.id', '=', 'role_permissions.permissionId')
            ->join('users', 'users.roleId', '=', 'role_permissions.roleId')->where('users.id', $userId)->pluck('permissions.code')->all();

        return (object) [
            'id' => (int) $u->id, 'username' => $u->username, 'fullName' => $u->fullName,
            'roleCode' => $u->roleCode, 'roleName' => $u->roleName, 'maxDiscountPercent' => (float) $u->maxDiscountPercent,
            'permissions' => array_fill_keys($perms, true),
        ];
    }

    public static function publicUser(object $u): array
    {
        $perms = array_keys($u->permissions);
        sort($perms);

        return ['id' => $u->id, 'username' => $u->username, 'fullName' => $u->fullName, 'role' => $u->roleCode,
            'roleName' => $u->roleName, 'maxDiscountPercent' => $u->maxDiscountPercent, 'permissions' => $perms];
    }

    /** User id for a correct username/password of an active account, else null. */
    public static function verify(string $username, string $password): ?int
    {
        $u = DB::table('users')->where('username', strtolower(trim($username)))->first();
        $ok = password_verify($password, $u->passwordHash ?? self::DUMMY_HASH);

        return $ok && $u && $u->isActive ? (int) $u->id : null;
    }

    public static function createSession(Request $req, Response $res, int $userId): void
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        DB::table('sessions')->insert([
            'id' => hash('sha256', $token), 'userId' => $userId,
            'expiresAt' => Clock::db(microtime(true) + self::ttlSeconds()),
            'lastSeenAt' => Clock::now(), 'createdAt' => Clock::now(),
            'userAgent' => mb_substr((string) $req->userAgent(), 0, 255) ?: null, 'ip' => $req->ip(),
        ]);
        $res->headers->setCookie(Cookie::create(self::COOKIE, $token, time() + self::ttlSeconds(), '/', null,
            config('pos.cookie_secure'), true, true, Cookie::SAMESITE_STRICT));
    }

    public static function destroySession(Request $req, Response $res): void
    {
        if ($id = $req->attributes->get('sessionId')) {
            DB::table('sessions')->where('id', $id)->delete();
        }
        $res->headers->clearCookie(self::COOKIE, '/');
    }

    /** Attaches the signed-in user (sliding expiry). */
    public static function attach(Request $req): void
    {
        if (random_int(1, 100) === 1) {
            DB::table('sessions')->where('expiresAt', '<', Clock::now())->delete();
        }
        $token = $req->cookies->get(self::COOKIE);
        if (! $token || ! is_string($token)) {
            return;
        }
        $id = hash('sha256', $token);
        $s = DB::table('sessions')->where('id', $id)->first();
        if (! $s) {
            return;
        }
        if ($s->expiresAt <= Clock::now()) {
            DB::table('sessions')->where('id', $id)->delete();

            return;
        }
        $user = self::load((int) $s->userId);
        if (! $user) {
            return;
        }
        $req->attributes->set('authUser', $user);
        $req->attributes->set('sessionId', $id);
        if (strtotime($s->lastSeenAt.' UTC') < time() - 60) {
            DB::table('sessions')->where('id', $id)->update(['lastSeenAt' => Clock::now(), 'expiresAt' => Clock::db(microtime(true) + self::ttlSeconds())]);
        }
    }

    public static function user(Request $req): ?object
    {
        return $req->attributes->get('authUser');
    }

    public static function id(Request $req): int
    {
        return self::user($req)->id;
    }

    public static function can(Request $req, string $perm): bool
    {
        return isset(self::user($req)?->permissions[$perm]);
    }

    /** Throws unless the user holds at least one of $perms. */
    public static function require(Request $req, string ...$perms): void
    {
        $u = self::user($req);
        if (! $u) {
            throw ApiError::unauthenticated();
        }
        foreach ($perms as $p) {
            if (isset($u->permissions[$p])) {
                return;
            }
        }
        throw ApiError::forbidden();
    }

    /**
     * Supervisor override: the user approves their own action when they hold $perm; otherwise a
     * supervisor's credentials are required. Returns the approver's user id.
     */
    public static function approval(Request $req, string $perm, ?array $approval, string $what): int
    {
        if (self::can($req, $perm)) {
            return self::id($req);
        }
        if (empty($approval['username']) || empty($approval['password'])) {
            throw new ApiError(403, "$what needs supervisor approval", 'APPROVAL_REQUIRED', ['permission' => $perm]);
        }
        $id = self::verify((string) $approval['username'], (string) $approval['password']);
        $approver = $id ? self::load($id) : null;
        if (! $approver || ! isset($approver->permissions[$perm])) {
            throw new ApiError(403, 'Approver credentials are invalid or lack permission', 'APPROVAL_INVALID', ['permission' => $perm]);
        }

        return $approver->id;
    }
}
