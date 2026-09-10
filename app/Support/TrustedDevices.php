<?php

namespace App\Support;

use App\Models\TrustedDevice;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie as SymfonyCookie;

/**
 * Remember this browser so a returning sign-in does not ask for a code.
 *
 * A trusted device is a random token in a long-lived httpOnly cookie; only
 * its hash is stored. That binds trust to this browser (a different browser,
 * phone, or a cleared cookie jar has no token and must confirm). IP is
 * recorded for the security screen, not used as a gate — a laptop that
 * moves networks is still the same browser.
 */
class TrustedDevices
{
    public const COOKIE = 'tma_trusted_device';

    public const DAYS = 7;

    public static function days(): int
    {
        return SecurityPolicies::sessionDays();
    }

    public static function issue(User $user, Request $request): SymfonyCookie
    {
        $token = Str::random(64);

        $user->trustedDevices()->create([
            'token_hash' => hash('sha256', $token),
            'device' => DeviceName::describe((string) $request->userAgent()),
            'ip' => $request->ip(),
            'last_used_at' => now(),
            'expires_at' => now()->addDays(self::days()),
        ]);

        return self::cookie($token, $request);
    }

    /**
     * Issue a cookie for this browser, or slide the expiry if it already has one.
     */
    public static function remember(User $user, Request $request): SymfonyCookie
    {
        $token = (string) $request->cookie(self::COOKIE);

        if ($token !== '') {
            $device = $user->trustedDevices()
                ->where('token_hash', hash('sha256', $token))
                ->first();

            if ($device) {
                $device->forceFill([
                    'last_used_at' => now(),
                    'device' => DeviceName::describe((string) $request->userAgent()),
                    'ip' => $request->ip(),
                    'expires_at' => now()->addDays(self::days()),
                ])->save();

                return self::cookie($token, $request);
            }
        }

        return self::issue($user, $request);
    }

    /**
     * Is this the same browser the user already signed in on?
     */
    public static function trusts(User $user, Request $request): bool
    {
        $token = (string) $request->cookie(self::COOKIE);

        if ($token === '') {
            return false;
        }

        $device = $user->trustedDevices()
            ->where('token_hash', hash('sha256', $token))
            ->where('expires_at', '>', now())
            ->first();

        if (! $device) {
            return false;
        }

        $device->forceFill([
            'last_used_at' => now(),
            'device' => DeviceName::describe((string) $request->userAgent()),
            'ip' => $request->ip(),
        ])->save();

        return true;
    }

    public static function forget(Request $request): SymfonyCookie
    {
        $token = (string) $request->cookie(self::COOKIE);

        if ($token !== '') {
            TrustedDevice::where('token_hash', hash('sha256', $token))->delete();
        }

        return Cookie::forget(self::COOKIE);
    }

    private static function cookie(string $token, Request $request): SymfonyCookie
    {
        return Cookie::make(
            name: self::COOKIE,
            value: $token,
            minutes: self::days() * 24 * 60,
            httpOnly: true,
            secure: $request->isSecure(),
            sameSite: 'lax',
        );
    }
}
