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
 *
 * This guards the whole portal group, so it sees every XHR as well as every
 * page load — and the two need different answers. A redirect is meaningless to
 * `fetch()`: it follows the 302 silently, hands the caller a 200 carrying an
 * HTML page, and `res.json()` throws "SyntaxError: The string did not match
 * the expected pattern" somewhere far away. Every JSON endpoint in the portal
 * failed that way, reported as a parse bug rather than as the policy it is.
 * JSON callers therefore get JSON, with a code the client can act on.
 *
 * Fortify's own two-factor routes sit outside this group (`web`, `auth:web`,
 * `password.confirm` only), so enabling 2FA is always reachable — this can
 * never lock the last administrator out of satisfying it.
 */
class EnforceTwoFactor
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            ! $user
            || $user->two_factor_confirmed_at !== null
            || $this->exempt($request)
            || ! SecurityPolicies::authenticatorRequired()
        ) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            return response()->json([
                'message' => 'Set up two-factor authentication to continue.',
                'code' => 'mfa-required',
                'redirect' => route('security-settings'),
            ], 403);
        }

        return redirect()->route('security-settings')->with('status', 'mfa-required');
    }

    /**
     * Requests that must keep working, or the screen we are sending people to
     * cannot render itself.
     *
     * `me` is the shell's own hydration call — the settings page paints the
     * reader's name, avatar and capabilities from it, so blocking it leaves
     * them on a half-drawn page with no way to finish. It returns nothing but
     * the caller's own account.
     */
    private function exempt(Request $request): bool
    {
        return $request->routeIs('security-settings*')
            || $request->routeIs('me')
            || $request->is('settings', 'account-settings');
    }
}
