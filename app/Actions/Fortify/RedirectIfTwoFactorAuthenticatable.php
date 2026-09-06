<?php

namespace App\Actions\Fortify;

use App\Support\EmailTwoFactor;
use App\Support\LoginChallenge;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable as FortifyAction;
use Laravel\Fortify\TwoFactorAuthenticatable;

/**
 * Mirrors Fortify's action, with two additions: a trusted device skips the
 * challenge, and accounts without an authenticator app still confirm unusual
 * sign-ins with an email code.
 */
class RedirectIfTwoFactorAuthenticatable extends FortifyAction
{
    public function handle($request, $next)
    {
        // Validated exactly once - it also drives the rate limiter.
        $user = $this->validateCredentials($request);

        if (! $user) {
            return $next($request);
        }

        if (LoginChallenge::needsAuthenticator($user, $request)
            && in_array(TwoFactorAuthenticatable::class, class_uses_recursive($user))) {
            return $this->twoFactorChallengeResponse($request, $user);
        }

        if (LoginChallenge::needsEmail($user, $request)) {
            return EmailTwoFactor::begin($request, $user);
        }

        return $next($request);
    }
}
