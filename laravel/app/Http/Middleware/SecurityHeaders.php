<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** The same protective headers the Node server sent (Content-Security-Policy and friends). */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next)
    {
        $res = $next($request);
        $csp = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; "
            ."frame-src 'self'; object-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; script-src-attr 'none'"
            .(config('pos.cookie_secure') ? '; upgrade-insecure-requests' : '');
        $h = $res->headers;
        $h->set('Content-Security-Policy', $csp);
        $h->set('X-Content-Type-Options', 'nosniff');
        $h->set('X-Frame-Options', 'SAMEORIGIN');
        $h->set('Referrer-Policy', 'no-referrer');
        $h->set('Cross-Origin-Opener-Policy', 'same-origin');
        $h->set('Cross-Origin-Resource-Policy', 'same-origin');
        $h->remove('X-Powered-By');
        if (config('pos.cookie_secure')) {
            $h->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $res;
    }
}
