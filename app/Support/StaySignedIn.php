<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Cookie as SymfonyCookie;

/**
 * "Stay signed in for 30 days" — separate from TrustedDevices (2FA skip).
 *
 * A long-lived cookie records that this browser was already asked, so OAuth
 * sign-ins don't re-prompt. Choosing yes issues Laravel's remember cookie
 * (duration set in AppServiceProvider); choosing no leaves the normal
 * SESSION_LIFETIME session alone.
 */
class StaySignedIn
{
    public const COOKIE = 'tma_stay_prompted';

    public const DAYS = 30;

    public static function minutes(): int
    {
        return self::DAYS * 24 * 60;
    }

    /**
     * Has this device not been asked yet?
     */
    public static function shouldAsk(Request $request): bool
    {
        return (string) $request->cookie(self::COOKIE) === '';
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

    public static function promptedCookie(Request $request): SymfonyCookie
    {
        return Cookie::make(
            name: self::COOKIE,
            value: '1',
            minutes: self::minutes(),
            httpOnly: true,
            secure: $request->isSecure(),
            sameSite: 'lax',
        );
    }
}
