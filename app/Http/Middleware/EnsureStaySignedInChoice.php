<?php

namespace App\Http\Middleware;

use App\Support\StaySignedIn;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * After a fresh sign-in, keep the user on the trust-this-device screen until
 * they answer Yes or No. Prevents bouncing straight into the portal.
 */
class EnsureStaySignedInChoice
{
    public function handle(Request $request, Closure $next): Response
    {
        if (
            $request->user()
            && StaySignedIn::isNeeded($request)
            && ! $request->routeIs('stay-signed-in.*')
            && ! $request->routeIs('logout')
            && ! $request->routeIs('two-factor.*')
        ) {
            return redirect()->route('stay-signed-in.show');
        }

        return $next($request);
    }
}
