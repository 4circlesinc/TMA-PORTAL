<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Cookie as SymfonyCookie;

/**
 * Post-login "Stay signed in?" prompt — separate from TrustedDevices (2FA skip).
 *
 * After Google, Microsoft, or email sign-in, browsers that have not answered
 * yet are asked whether they trust this device to keep them signed in.
 * Choosing yes issues Laravel's remember cookie; choosing no leaves the
 * normal SESSION_LIFETIME session alone. The answer is stored in a cookie
 * so we don't re-prompt on every visit.
 */
class StaySignedIn
{
    public const COOKIE = 'tma_device_trust';

    /** @deprecated Cleared when a real answer is recorded; do not read. */
    public const LEGACY_COOKIE = 'tma_stay_prompted';

    public const SESSION_KEY = 'stay_signed_in.needed';

    public const DAYS = 30;

    public static function minutes(): int
    {
        return self::DAYS * 24 * 60;
    }

    /**
     * Has this browser not answered the trust prompt yet?
     */
    public static function shouldAsk(Request $request): bool
    {
        $value = (string) $request->cookie(self::COOKIE);

        return $value !== 'yes' && $value !== 'no';
    }

    public static function markNeeded(Request $request): void
    {
        $request->session()->put(self::SESSION_KEY, true);
    }

    public static function isNeeded(Request $request): bool
    {
        return (bool) $request->session()->get(self::SESSION_KEY);
    }

    public static function clearNeeded(Request $request): void
    {
        $request->session()->forget(self::SESSION_KEY);
    }

    /**
     * Re-login with the remember flag so the portal restores after reopen.
     */
    public static function applyRemember(Request $request): void
    {
        $user = $request->user();

        if (! $user) {
            return;
        }

        Auth::login($user, true);
        $request->session()->regenerate();
    }

    /**
     * @return list<SymfonyCookie>
     */
    public static function answerCookies(Request $request, string $answer): array
    {
        $minutes = self::minutes();
        $secure = $request->isSecure();

        return [
            Cookie::make(
                name: self::COOKIE,
                value: $answer,
                minutes: $minutes,
                httpOnly: true,
                secure: $secure,
                sameSite: 'lax',
            ),
            // Drop the old checkbox-era cookie that skipped this screen.
            Cookie::forget(self::LEGACY_COOKIE),
        ];
    }
}
