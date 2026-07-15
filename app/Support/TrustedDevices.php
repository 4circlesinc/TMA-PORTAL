<?php

namespace App\Support;

use App\Models\TrustedDevice;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie as SymfonyCookie;

/**
 * "Trust this device" for two-factor authentication.
 *
 * A trusted device holds a random token in a long-lived, httpOnly cookie;
 * only its hash is stored. The device is bound to the browser that earned it
 * (a different browser, machine, or a cleared cookie jar has no token), and
 * a sign-in from an unfamiliar IP still asks for a code.
 */
class TrustedDevices
{
    public const COOKIE = 'tma_trusted_device';

    public const DAYS = 30;

    public static function issue(User $user, Request $request): SymfonyCookie
    {
        $token = Str::random(64);

        $user->trustedDevices()->create([
            'token_hash' => hash('sha256', $token),
            'device' => DeviceName::describe((string) $request->userAgent()),
            'ip' => $request->ip(),
            'last_used_at' => now(),
            'expires_at' => now()->addDays(self::DAYS),
        ]);

        return Cookie::make(
            name: self::COOKIE,
            value: $token,
            minutes: self::DAYS * 24 * 60,
            httpOnly: true,
            secure: $request->isSecure(),
            sameSite: 'lax',
        );
    }

    /**
     * Is this browser a device the user already vouched for?
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

        // A trusted cookie replayed from somewhere else still gets challenged.
        if ($device->ip && $device->ip !== $request->ip()) {
            return false;
        }

        $device->forceFill([
            'last_used_at' => now(),
            'device' => DeviceName::describe((string) $request->userAgent()),
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
}
