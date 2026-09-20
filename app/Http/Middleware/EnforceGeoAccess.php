<?php

namespace App\Http\Middleware;

use App\Support\Security\GeoAccess;
use App\Support\Security\SecurityAudit;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Geographic restriction on the whole portal.
 *
 * Applied to every web request rather than only to sign-in: the firm asked
 * for the restriction to cover reaching the portal at all, which includes the
 * doors that never involve an account — a request-file upload link, a signing
 * link, the public pages.
 *
 * Two routes are exempt and both have to be:
 *
 *   - `/up`, the container health check. Failing it makes the platform
 *     recycle a container that is working perfectly.
 *   - `logout`. Someone caught by a policy change mid-session must be able to
 *     end their session cleanly rather than be held in it by a 403.
 *
 * The refusal is a plain 403 with the firm's own message. It does not say
 * which country was seen or what the policy is: someone being refused is the
 * one person who does not need to be told how the rule works.
 */
class EnforceGeoAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->is('up') || $request->routeIs('logout')) {
            return $next($request);
        }

        $reason = GeoAccess::refuse($request);

        if ($reason === null) {
            return $next($request);
        }

        // Recorded every time. A geo block that nobody can see afterwards is
        // indistinguishable from the portal being broken, and the first thing
        // asked when a client cannot get in is "did we refuse them?".
        SecurityAudit::record('security.geo_blocked', [
            'country' => $reason,
            'path' => $request->path(),
            'user_id' => $request->user()?->id,
        ]);

        $message = GeoAccess::policy()['message'];

        if ($request->expectsJson()) {
            return response()->json([
                'message' => $message,
                'code' => 'geo-blocked',
            ], 403);
        }

        return response()->view('errors.geo-blocked', ['message' => $message], 403);
    }
}
