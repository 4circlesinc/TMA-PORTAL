<?php

namespace App\Support;

use App\Models\AuthEvent;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Whether this sign-in needs a second factor, and which kind.
 *
 * Email codes are always on for returning accounts: a new browser or location
 * must confirm. An authenticator app, when enrolled, is preferred. A device
 * the user already trusted (same cookie, same IP, still in date) skips both.
 */
final class LoginChallenge
{
    public static function needsAuthenticator(User $user, Request $request): bool
    {
        return $user->hasTwoFactorEnabled() && ! TrustedDevices::trusts($user, $request);
    }

    public static function needsEmail(User $user, Request $request): bool
    {
        if ($user->hasTwoFactorEnabled() || TrustedDevices::trusts($user, $request)) {
            return false;
        }

        return self::hasPriorLogin($user);
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
