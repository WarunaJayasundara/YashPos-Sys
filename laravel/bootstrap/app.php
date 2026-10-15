<?php

use App\Http\Controllers\InstallController;
use App\Http\Controllers\SpaController;
use App\Http\Middleware\ApiGuard;
use App\Http\Middleware\SecurityHeaders;
use App\Support\ApiError;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        then: function () {
            Route::get('/install', InstallController::class);
            // the React app handles every other path
            // (never for /api or hidden paths like /.env, which stay 404)
            Route::get('/{any?}', SpaController::class)->where('any', '^(?!api(/|$))(?!(.*/)?\.).*$');
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->api(prepend: [ApiGuard::class]);
        $middleware->append(SecurityHeaders::class);
        if (env('TRUST_PROXY', '0') === '1') {
            $middleware->trustProxies(at: '*');
        }
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api') && ! $request->is('api/*')) {
                return null;
            }
            $out = fn (int $s, string $code, string $msg, mixed $details = null) => response()->json(
                ['error' => array_filter(['code' => $code, 'message' => $msg, 'details' => $details], fn ($v) => $v !== null)], $s);
            if ($e instanceof ApiError) {
                return $out($e->status, $e->errorCode, $e->getMessage(), $e->details);
            }
            if ($e instanceof NotFoundHttpException || $e instanceof MethodNotAllowedHttpException) {
                return $out(404, 'NOT_FOUND', 'Unknown API route');
            }
            if ($e instanceof PostTooLargeException) {
                return $out(413, 'TOO_LARGE', 'The upload is too large');
            }
            if ($e instanceof QueryException) {
                $code = $e->errorInfo[1] ?? null;
                if ($code === 1062) {
                    preg_match("/for key '([^']+)'/", $e->getMessage(), $m);

                    return $out(409, 'DUPLICATE', 'Duplicate value for '.($m[1] ?? 'a unique field'));
                }
                if ($code === 1451 || $code === 1452) {
                    return $out(409, 'IN_USE', 'Record is referenced by other data');
                }
            }
            if ($e instanceof HttpExceptionInterface) {
                return $out($e->getStatusCode(), 'ERROR', $e->getMessage() ?: 'Request failed');
            }
            report($e);

            return $out(500, 'SERVER_ERROR', 'Unexpected server error');
        });
    })->create();
