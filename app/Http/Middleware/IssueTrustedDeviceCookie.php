<?php

namespace App\Http\Middleware;

use App\Support\TrustedDevices;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * After a successful sign-in, remember this browser so the next visit from
 * it skips the email / authenticator challenge. Fortify owns the password
 * and authenticator controllers, so the cookie is attached here. A public
 * computer can opt out from the challenge screens.
 */
class IssueTrustedDeviceCookie
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (! Auth::check() || ! $this->shouldRemember($request)) {
            return $response;
        }

        return $response->withCookie(TrustedDevices::remember(Auth::user(), $request));
    }

    private function shouldRemember(Request $request): bool
    {
        if ($request->routeIs('login-code.store', 'two-factor.login', 'two-factor.login.store')) {
            return $request->isMethod('POST') && $request->boolean('trust_device');
        }

        if ($request->isMethod('POST') && $request->routeIs('login.store')) {
            return true;
        }

        return $request->routeIs('social.callback');
    }
}
