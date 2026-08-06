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
            // A browser that has already answered is never held here again.
            // The cookie *is* the answer; the session flag is only how we
            // remember to ask. If the flag ever outlives the answer — a submit
            // that didn't validate, a write that didn't land — this gate would
            // otherwise pin the account to one screen for the rest of the
            // session, bouncing every URL back with nothing on the page to
            // explain it. That is not a state a user can get themselves out of.
            if (! StaySignedIn::shouldAsk($request)) {
                StaySignedIn::clearNeeded($request);

                return $next($request);
            }

            return redirect()->route('stay-signed-in.show');
        }

        return $next($request);
    }
}
