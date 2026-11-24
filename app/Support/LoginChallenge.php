<?php

namespace App\Support;

use App\Models\AuthEvent;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Whether this sign-in needs a second factor, and which kind.
 *
 * Email codes confirm a new browser (no trusted-device cookie). An
 * authenticator app, when enrolled, is preferred. The same browser the user
 * already signed in on skips both until the cookie expires.
 */
final class LoginChallenge
{
    public static function needsAuthenticator(User $user, Request $request): bool
    {
        return $user->hasTwoFactorEnabled() && ! TrustedDevices::trusts($user, $request);
    }

    public static function needsEmail(User $user, Request $request): bool
    {
        if ($user->hasTwoFactorEnabled() || TrustedDevices::trusts($user, $request) || self::isReviewAccount($user)) {
            return false;
        }

        return self::hasPriorLogin($user);
    }

    /**
     * The App Review demo account (auth.review_accounts). Apple's reviewers
     * sign in from devices it has never used and cannot read its inbox.
     */
    public static function isReviewAccount(User $user): bool
    {
        $email = strtolower(trim((string) $user->email));
        $listed = array_map(fn ($entry) => strtolower(trim((string) $entry)), (array) config('auth.review_accounts', []));

        return $email !== '' && in_array($email, $listed, true);
    }

    public static function hasPriorLogin(User $user): bool
    {
        return AuthEvent::query()
            ->where('user_id', $user->id)
            ->where('event', 'login')
            ->exists();
    }

    /**
     * Copy for the email-code screen: new location vs new device.
     */
    public static function emailReason(User $user, Request $request): string
    {
        $knownIp = AuthEvent::query()
            ->where('user_id', $user->id)
            ->where('event', 'login')
            ->where('ip', $request->ip())
            ->exists();

        return $knownIp ? 'new-device' : 'new-location';
    }

    public static function maskEmail(string $email): string
    {
        $at = strrpos($email, '@');

        if ($at === false || $at === 0) {
            return $email;
        }

        $local = substr($email, 0, $at);
        $domain = substr($email, $at);
        $keep = min(2, strlen($local));

        return substr($local, 0, $keep).str_repeat('•', max(strlen($local) - $keep, 1)).$domain;
    }
}
