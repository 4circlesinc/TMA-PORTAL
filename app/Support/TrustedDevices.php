<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Database\Eloquent\Relations\HasMany;
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

    /**
     * Trust this browser for this account. Reuses the browser's token when it
     * already has one (another account trusted it), so trusting it for one
     * account never takes the trust away from another.
     */
    public static function issue(User $user, Request $request, ?string $token = null): SymfonyCookie
    {
        $token ??= Str::random(64);

        $user->trustedDevices()->create([
            'token_hash' => self::hashFor($user, $token),
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

        if (! self::isToken($token)) {
            return self::issue($user, $request);
        }

        $device = self::rowFor($user, $token)->first();

        if ($device) {
            $device->forceFill([
                'last_used_at' => now(),
                'device' => DeviceName::describe((string) $request->userAgent()),
                'ip' => $request->ip(),
                'expires_at' => now()->addDays(self::days()),
            ])->save();

            return self::cookie($token, $request);
        }

        // The browser already holds a token for another account. Minting a
        // new one here replaced it, which is how one person with two accounts
        // kept being asked for a code: each trust undid the other.
        return self::issue($user, $request, $token);
    }

    /**
     * Is this the same browser the user already signed in on?
     */
    public static function trusts(User $user, Request $request): bool
    {
        $token = (string) $request->cookie(self::COOKIE);

        if (! self::isToken($token)) {
            return false;
        }

        $device = self::rowFor($user, $token)
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

    /**
     * Stop trusting this browser for this account. Other accounts that
     * trusted the same browser keep their own trust.
     */
    public static function forget(User $user, Request $request): SymfonyCookie
    {
        $token = (string) $request->cookie(self::COOKIE);

        if (self::isToken($token)) {
            self::rowFor($user, $token)->delete();
        }

        return Cookie::forget(self::COOKIE);
    }

    /**
     * Each account's row is filed under the browser's token and the account
     * together, so one token can stand for several accounts (the token_hash
     * column is unique) and no account's trust ever stands in for another's.
     */
    private static function hashFor(User $user, string $token): string
    {
        return hash('sha256', $user->getKey().'|'.$token);
    }

    /**
     * This account's row for this browser. Rows written before tokens were
     * scoped to the account were hashed from the token alone; still honoured.
     */
    private static function rowFor(User $user, string $token): HasMany
    {
        return $user->trustedDevices()->whereIn('token_hash', [
            self::hashFor($user, $token),
            hash('sha256', $token),
        ]);
    }

    /** Only a token this class minted is ever reused or looked up. */
    private static function isToken(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9]{64}$/', $token) === 1;
    }

    private static function cookie(string $token, Request $request): SymfonyCookie
    {
        return Cookie::make(
            name: self::COOKIE,
            value: $token,
            minutes: self::days() * 24 * 60,
            path: '/',
            httpOnly: true,
            secure: $request->isSecure() || (bool) config('session.secure'),
            sameSite: 'lax',
        );
    }
}
