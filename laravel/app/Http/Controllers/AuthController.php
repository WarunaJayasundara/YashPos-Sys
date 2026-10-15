<?php

namespace App\Http\Controllers;

use App\Support\ApiError;
use App\Support\Audit;
use App\Support\Auth;
use App\Support\Clock;
use App\Support\V;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

class AuthController
{
    private const WINDOW = 15 * 60;

    public function login(Request $req): JsonResponse
    {
        $d = V::check($req->all(), ['username' => 'required|string|min:1|max:50', 'password' => 'required|string|min:1|max:200']);
        // per account (one mistyping cashier does not lock out the others) plus a looser per-IP cap; failures only
        $accountKey = 'login:'.$req->ip().'|'.strtolower($d['username']);
        $ipKey = 'login-ip:'.$req->ip();
        if (RateLimiter::tooManyAttempts($accountKey, config('pos.login_rate_limit', 10)) || RateLimiter::tooManyAttempts($ipKey, 100)) {
            throw new ApiError(429, 'Too many sign-in attempts. Try again in 15 minutes.', 'RATE_LIMITED');
        }
        $userId = Auth::verify($d['username'], $d['password']);
        if (! $userId) {
            RateLimiter::hit($accountKey, self::WINDOW);
            RateLimiter::hit($ipKey, self::WINDOW);
            Audit::log($req, 'auth.login_failed', 'user', null, ['username' => $d['username']]);
            throw new ApiError(401, 'Incorrect username or password', 'BAD_CREDENTIALS');
        }
        $user = Auth::load($userId);
        $res = response()->json(['user' => Auth::publicUser($user)]);
        Auth::createSession($req, $res, $userId);
        DB::table('users')->where('id', $userId)->update(['lastLoginAt' => Clock::now(), 'updatedAt' => Clock::now()]);
        $req->attributes->set('authUser', $user);
        Audit::log($req, 'auth.login', 'user', $userId);

        return $res;
    }

    public function logout(Request $req): JsonResponse
    {
        if ($u = Auth::user($req)) {
            Audit::log($req, 'auth.logout', 'user', $u->id);
        }
        $res = response()->json(['ok' => true]);
        Auth::destroySession($req, $res);

        return $res;
    }

    public function me(Request $req): JsonResponse
    {
        return response()->json(['user' => Auth::publicUser(Auth::user($req))]);
    }

    public function changePassword(Request $req): JsonResponse
    {
        $d = V::check($req->all(), ['currentPassword' => 'required|string|min:1', 'newPassword' => 'required|string|min:8|max:200']);
        $u = DB::table('users')->where('id', Auth::id($req))->first();
        if (! password_verify($d['currentPassword'], $u->passwordHash)) {
            throw new ApiError(400, 'Current password is incorrect', 'BAD_CREDENTIALS');
        }
        DB::table('users')->where('id', $u->id)->update(['passwordHash' => Auth::hashPassword($d['newPassword']), 'updatedAt' => Clock::now()]);
        DB::table('sessions')->where('userId', $u->id)->where('id', '<>', $req->attributes->get('sessionId'))->delete();
        Audit::log($req, 'auth.change_password', 'user', $u->id);

        return response()->json(['ok' => true]);
    }
}
