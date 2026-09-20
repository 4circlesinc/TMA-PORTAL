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
        /*
         * The health check, the way out, and the screen a refused visitor is
         * sent to. That last one has to be reachable or the redirect below
         * would point at a page that refuses itself, which is a loop.
         *
         * Matched on the path, not routeIs(): this middleware is prepended to
         * the web group, so it runs before the router has resolved a route
         * and routeIs() has nothing to match against yet.
         */
        if ($request->is('up', 'not-available') || $request->routeIs('logout')) {
            return $next($request);
        }

        if ($reason = GeoAccess::refuse($request)) {
            return $this->refuse(
                $request,
                'security.geo_blocked',
                ['country' => $reason],
                GeoAccess::policy()['message'],
                'geo-blocked',
            );
        }

        // Checked after the country: the country test is two array lookups,
        // while this one may reach a reputation API. Somebody already refused
        // for where they are should not also cost a paid lookup.
        if ($anonymiser = GeoAccess::refuseAnonymiser($request)) {
            return $this->refuse(
                $request,
                'security.vpn_blocked',
                ['detected' => $anonymiser, 'ip' => $request->ip()],
                GeoAccess::policy()['vpnMessage'],
                'vpn-blocked',
            );
        }

        return $next($request);
    }

    /**
     * Turn somebody away, and leave a record that says why.
     *
     * Recorded every time, without exception. A refusal nobody can see
     * afterwards is indistinguishable from the portal being broken, and with
     * no allowlist to rescue a wrongly-refused client the audit trail is the
     * only way to answer "why can't I get in?". {@see Anonymiser} explains
     * why that question will be asked.
     *
     * @param  array<string, mixed>  $context
     */
    private function refuse(Request $request, string $event, array $context, string $message, string $code): Response
    {
        SecurityAudit::record($event, $context + [
            'path' => $request->path(),
            'user_id' => $request->user()?->id,
        ]);

        if ($request->expectsJson()) {
            return response()->json([
                'message' => $message,
                'code' => $code,
            ], 403);
        }

        /*
         * Send the browser somewhere it can sit.
         *
         * Rendering the screen in place of the requested URL left the address
         * bar on a page that refuses itself: every reload re-ran the refusal,
         * and the portal's scripts kept firing XHRs behind it that each came
         * back 403. One redirect, to one address that reloads cleanly.
         *
         * This is presentation only. The request that got here was refused,
         * and the next one will be refused too — /not-available is a static
         * page and reaching it is not access to anything.
         */
        // Not redirect()->guest(): that parks the refused URL as url.intended
        // so a later sign-in would bounce them straight back to it.
        return redirect()->to(route('geo.blocked'));
    }
}
