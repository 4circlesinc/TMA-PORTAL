<?php

namespace App\Http\Middleware;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * When the sign-in policy requires an authenticator app, Fortify's disable
 * route must not honour the request — hiding the button is not enough.
 */
class PreventDisablingRequiredAuthenticator
{
    public function handle(Request $request, Closure $next): Response
    {
        if (
            $request->isMethod('DELETE')
            && $request->is('auth/user/two-factor-authentication')
            && SecurityPolicies::authenticatorRequired()
        ) {
            if ($request->expectsJson()) {
                return response()->json([
                    'message' => 'Your organisation requires an authenticator app.',
                ], 403);
            }

            abort(403, 'Your organisation requires an authenticator app.');
        }

        return $next($request);
    }
}
