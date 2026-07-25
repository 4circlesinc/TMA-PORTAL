<?php

namespace App\Actions\Fortify;

use App\Support\TrustedDevices;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable as FortifyAction;
use Laravel\Fortify\TwoFactorAuthenticatable;

/**
 * Mirrors Fortify's action, with one addition: a sign-in from a device the
 * user already chose to trust skips the two-factor challenge. Any other
 * browser, machine, or IP is still challenged.
 */
class RedirectIfTwoFactorAuthenticatable extends FortifyAction
{
    public function handle($request, $next)
    {
        // Validated exactly once - it also drives the rate limiter.
        $user = $this->validateCredentials($request);

        $usesTwoFactor = $user
            && $user->two_factor_secret
            && ! is_null($user->two_factor_confirmed_at)
            && in_array(TwoFactorAuthenticatable::class, class_uses_recursive($user));

        if (! $usesTwoFactor) {
            return $next($request);
        }

        if (TrustedDevices::trusts($user, $request)) {
            return $next($request);
        }

        return $this->twoFactorChallengeResponse($request, $user);
    }
}
