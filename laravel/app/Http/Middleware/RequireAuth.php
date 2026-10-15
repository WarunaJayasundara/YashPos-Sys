<?php

namespace App\Http\Middleware;

use App\Support\ApiError;
use App\Support\Auth;
use Closure;
use Illuminate\Http\Request;

class RequireAuth
{
    public function handle(Request $request, Closure $next)
    {
        if (! Auth::user($request)) {
            throw ApiError::unauthenticated();
        }

        return $next($request);
    }
}
