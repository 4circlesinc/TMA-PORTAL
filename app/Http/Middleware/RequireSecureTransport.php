<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Nothing the portal serves travels in the clear.
 *
 * The briefing tells service providers that someone watching the network
 * cannot read the pages or the files. HSTS in ApplySecurityPolicyHeaders
 * keeps that promise for every browser that has already been here once; this
 * covers the visit that comes before it, and anything that is not a browser.
 *
 * A plain-http GET is answered with a 301 to the same URL on https rather
 * than served. Anything else — a POST carrying a password, a PUT of a file —
 * is refused outright with a 400, because the bytes have already crossed the
 * network by the time we could redirect, and a redirect would invite the
 * client to send them a second time. There is no safe way to honour that
 * request; the only honest answer is that it should never have been made.
 *
 * Only in environments that actually have TLS. Local http development, the
 * Docker stack and the test suite are left alone, so this cannot be the
 * reason a dev box stops answering.
 */
class RequireSecureTransport
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->enforced() || $request->isSecure()) {
            return $next($request);
        }

        /*
         * The container health check runs inside the platform's network,
         * where there is no TLS to terminate. Redirecting it makes the
         * platform read a working container as unhealthy and recycle it.
         */
        if ($request->path() === 'up') {
            return $next($request);
        }

        if ($request->isMethodSafe()) {
            return redirect()->secure($request->getRequestUri(), 301);
        }

        abort(400, 'This request must be made over a secure connection.');
    }

    /**
     * Whether this environment is meant to be reachable over https at all.
     *
     * Mirrors ApplySecurityPolicyHeaders::secure() minus its isSecure() arm:
     * that one asks "is this request secure", and the answer here has to be
     * the same for a request that is not.
     */
    private function enforced(): bool
    {
        return app()->environment('production')
            || str_starts_with((string) config('app.url'), 'https://');
    }
}
