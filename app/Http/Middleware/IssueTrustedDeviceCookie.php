<?php

namespace App\Http\Middleware;

use App\Support\StaySignedIn;
use App\Support\TrustedDevices;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * After a successful sign-in, remember this browser so the next visit from
 * it skips the email / authenticator challenge and stays signed in. Fortify
 * owns the password and authenticator controllers, so the cookie is attached
 * here. A public computer opts out from the challenge screens or by answering
 * "Not this time" on Stay signed in.
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

        if ($request->routeIs('stay-signed-in.store')) {
            return $request->isMethod('POST') && $request->input('stay') === 'yes';
        }

        if (! $request->isMethod('POST') && ! $request->routeIs('social.callback')) {
            return false;
        }

        if (! $request->routeIs('login.store', 'social.callback')) {
            return false;
        }

        return StaySignedIn::wantsRemember($request)
            || (string) $request->cookie(TrustedDevices::COOKIE) !== '';
    }
}
