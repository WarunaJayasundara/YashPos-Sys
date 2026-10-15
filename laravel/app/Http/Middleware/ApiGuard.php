<?php

namespace App\Http\Middleware;

use App\Support\ApiError;
use App\Support\Auth;
use Closure;
use Illuminate\Http\Request;

/** Every /api request: rejects malformed JSON, attaches the session user, and requires the CSRF header on writes. */
class ApiGuard
{
    public function handle(Request $request, Closure $next)
    {
        $type = (string) $request->headers->get('Content-Type');
        if (str_contains($type, 'application/json') && trim($request->getContent()) !== '') {
            json_decode($request->getContent());
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new ApiError(400, 'Malformed JSON body', 'BAD_JSON');
            }
        }
        Auth::attach($request);
        if (! in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true) && $request->headers->get('X-Requested-With') !== 'yash-pos') {
            throw new ApiError(403, 'Missing CSRF header', 'CSRF');
        }

        return $next($request);
    }
}
