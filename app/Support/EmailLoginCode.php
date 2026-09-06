<?php

namespace App\Support;

use App\Models\User;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * 6-digit email codes for unusual sign-ins (new device or location).
 *
 * The hash lives on the parked login session, not a cache key that includes
 * the session id — a new request can keep the challenge data and still get a
 * different id, which would make a valid code look expired.
 */
final class EmailLoginCode
{
    public const TTL_MINUTES = 10;

    public const RESEND_SECONDS = 30;

    public const HASH_KEY = 'login.email_code';

    public const EXPIRES_KEY = 'login.email_code_expires';

    public static function send(User $user, Request $request): void
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        $request->session()->put([
            self::HASH_KEY => Hash::make($code),
            self::EXPIRES_KEY => now()->addMinutes(self::TTL_MINUTES)->getTimestamp(),
        ]);

        Deliveries::send(
            Postcards::loginCode($user, $code),
            $user->email,
            $user,
            'loginCode',
            immediate: true,
        );

        RateLimiter::hit(self::resendKey($user), self::RESEND_SECONDS);
    }

    public static function canResend(User $user): bool
    {
        return ! RateLimiter::tooManyAttempts(self::resendKey($user), 1);
    }

    public static function resendAvailableIn(User $user): int
    {
        return RateLimiter::availableIn(self::resendKey($user));
    }

    public static function check(User $user, Request $request, string $code): bool
    {
        $hash = $request->session()->get(self::HASH_KEY);
        $expires = (int) $request->session()->get(self::EXPIRES_KEY);

        if (! is_string($hash) || $hash === '' || $expires < now()->getTimestamp()) {
            return false;
        }

        if (! Hash::check($code, $hash)) {
            return false;
        }

        $request->session()->forget([self::HASH_KEY, self::EXPIRES_KEY]);

        return true;
    }

    private static function resendKey(User $user): string
    {
        return 'login-code-send:'.$user->id;
    }
}
