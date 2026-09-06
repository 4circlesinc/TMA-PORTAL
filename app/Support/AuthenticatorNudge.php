<?php

namespace App\Support;

use App\Models\User;
use Carbon\Carbon;

/**
 * Weekly reminder to set up an authenticator app. Email codes already cover
 * unusual sign-ins; this is the push toward the stronger method.
 *
 * Shown at most once per 7 days, at most 5 times, and never when the app is
 * already on or the sign-in policy requires it (those people are sent to
 * set-up instead of being asked).
 */
final class AuthenticatorNudge
{
    public const MAX_SHOWS = 5;

    public const INTERVAL_DAYS = 7;

    public const PREF = 'authenticatorNudge';

    /** @return array{show: bool, remaining: int} */
    public static function payload(User $user): array
    {
        $count = self::count($user);

        return [
            'show' => self::shouldShow($user),
            'remaining' => max(0, self::MAX_SHOWS - $count),
        ];
    }

    public static function shouldShow(User $user): bool
    {
        if ($user->hasTwoFactorEnabled() || SecurityPolicies::authenticatorRequired()) {
            return false;
        }

        if (self::count($user) >= self::MAX_SHOWS) {
            return false;
        }

        $last = self::pref($user)['lastShownAt'] ?? null;

        if (is_string($last) && $last !== '' && now()->lt(Carbon::parse($last)->addDays(self::INTERVAL_DAYS))) {
            return false;
        }

        return true;
    }

    public static function markShown(User $user): void
    {
        if ($user->hasTwoFactorEnabled()) {
            return;
        }

        $prefs = $user->preferences ?? [];
        $nudge = $prefs[self::PREF] ?? [];
        $count = (int) ($nudge['count'] ?? 0);

        if ($count >= self::MAX_SHOWS) {
            return;
        }

        $last = $nudge['lastShownAt'] ?? null;

        if (is_string($last) && $last !== '' && now()->lt(Carbon::parse($last)->addDays(self::INTERVAL_DAYS))) {
            return;
        }

        $nudge['count'] = $count + 1;
        $nudge['lastShownAt'] = now()->toIso8601String();
        $prefs[self::PREF] = $nudge;
        $user->forceFill(['preferences' => $prefs])->save();
    }

    public static function count(User $user): int
    {
        return (int) (self::pref($user)['count'] ?? 0);
    }

    /** @return array<string, mixed> */
    private static function pref(User $user): array
    {
        $value = ($user->preferences ?? [])[self::PREF] ?? [];

        return is_array($value) ? $value : [];
    }
}
