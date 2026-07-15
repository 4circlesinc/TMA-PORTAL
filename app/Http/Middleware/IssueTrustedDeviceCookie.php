<?php

namespace App\Http\Middleware;

use App\Support\TrustedDevices;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * After a two-factor challenge is passed, remember the device if the user
 * ticked "Trust this device". Fortify owns the challenge controller, so the
 * cookie is attached to its response here.
 */
class IssueTrustedDeviceCookie
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (
            $request->isMethod('POST')
            && $request->routeIs('two-factor.login*')
            && Auth::check()
            && $request->boolean('trust_device')
        ) {
            $response->withCookie(TrustedDevices::issue(Auth::user(), $request));
        }

        return $response;
    }
}
