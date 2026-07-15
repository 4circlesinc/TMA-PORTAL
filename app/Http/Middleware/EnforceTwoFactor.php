<?php

namespace App\Http\Middleware;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * When the administrator's sign-in policy requires multi-factor
 * authentication, approved users without a confirmed authenticator are
 * routed to Security settings to set one up.
 */
class EnforceTwoFactor
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            $user
            && $user->two_factor_confirmed_at === null
            && ! $request->routeIs('security-settings*')
            && ! $request->is('settings', 'account-settings')
            && SecurityPolicies::get('sign-in')['requireMfa']
        ) {
            return redirect()->route('security-settings')->with('status', 'mfa-required');
        }

        return $next($request);
    }
}
