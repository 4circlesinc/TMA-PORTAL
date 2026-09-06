<?php

namespace App\Http\Middleware;

use App\Support\Security\Turnstile;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Turnstile only on the unauthenticated POSTs that create a session or
 * a reset. GET pages, JSON APIs, and signed-in traffic are untouched.
 */
class VerifyTurnstile
{
    private const ROUTES = [
        'login',
        'register',
        'password.email',
        'password.update',
        'login-code.store',
        'login-code.resend',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('POST') && $request->routeIs(...self::ROUTES)) {
            Turnstile::assert($request);
        }

        return $next($request);
    }
}
