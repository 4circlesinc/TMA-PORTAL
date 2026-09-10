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
        $user = $request->user();

        if (
            $request->isMethod('DELETE')
            && $request->is('auth/user/two-factor-authentication')
            && $user?->mustUseAuthenticator()
        ) {
            $message = $user->require_two_factor && ! SecurityPolicies::authenticatorRequired()
                ? 'An administrator requires an authenticator app on this account.'
                : 'Your organisation requires an authenticator app.';

            if ($request->expectsJson()) {
                return response()->json(['message' => $message], 403);
            }

            abort(403, $message);
        }

        return $next($request);
    }
}
