<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * When an authenticator is required of an account - by the firm's sign-in
 * policy, or by an administrator on that one person - and it has not been set
 * up yet, every portal request is turned away to the screen that sets it up.
 *
 * That screen is a full-page stop, not Account settings. Sending people to
 * settings drew the whole portal shell around them, so the account looked
 * usable while every call inside it 403'd.
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
            || ! $user->mustUseAuthenticator()
        ) {
            return $next($request);
        }

        if ($request->expectsJson()) {
            return response()->json([
                'message' => 'Set up two-factor authentication to continue.',
                'code' => 'mfa-required',
                'redirect' => route('required-authenticator.show'),
            ], 403);
        }

        return redirect()->route('required-authenticator.show');
    }

    /**
     * Requests that must keep working, or the screen we are sending people to
     * cannot render itself.
     *
     * Account settings is no longer among them: it is a portal page like any
     * other, and leaving it open was a way around the gate — everything the
     * settings shell offers was reachable from it.
     *
     * `me` is the shell's own hydration call, and returns nothing but the
     * caller's own account.
     */
    private function exempt(Request $request): bool
    {
        return $request->routeIs('required-authenticator.*')
            || $request->routeIs('me');
    }
}
