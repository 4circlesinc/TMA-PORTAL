<?php

namespace App\Support\Security;

use App\Support\SecurityPolicies;
use Illuminate\Http\Request;

/**
 * Where the portal may be reached from.
 *
 * One decision, taken in one place, so "is this country allowed" cannot drift
 * between the sign-in form, an API call and a public upload link. The rules
 * themselves are the firm's, edited in Account settings › Security; nothing is
 * hard-coded here but the safety rails.
 *
 * ── Why "block unknown" is not applied everywhere ────────────────────────
 *
 * The country comes from the CDN edge (`CF-IPCountry`). That header exists
 * only when the request actually came through Cloudflare, so "no country"
 * means one of two very different things:
 *
 *   - a real visitor whose country Cloudflare could not resolve, which is
 *     what the firm wants refused; or
 *   - a request that never touched the edge at all — local development, a
 *     health check on the container, an internal cron hitting the app
 *     directly. Every one of the 38 localhost sign-ins on this database has
 *     no country, and none of them are foreign traffic.
 *
 * Refusing the second kind would lock the firm out of its own portal the
 * first time Cloudflare was bypassed or misconfigured, with no way back in
 * through the UI — the setting that is supposed to protect the portal would
 * be the thing that took it down. So `blockUnknown` bites only where a
 * country could genuinely have been reported: a public, routable client
 * address. Loopback, private ranges and CLI have no edge in front of them
 * and are judged unknown-but-allowed, and that is recorded either way.
 *
 * This is a control, not the control. It is one signal beside authentication,
 * MFA and the capability matrix, and it is trivially defeated by a VPN. Treat
 * it as compliance evidence and friction, never as the thing keeping an
 * attacker out.
 */
final class GeoAccess
{
    public const MODE_OFF = 'off';

    public const MODE_ALLOW = 'allow';

    public const MODE_BLOCK = 'block';

    /** @return array{mode: string, countries: list<string>, blockUnknown: bool, message: string} */
    public static function policy(): array
    {
        $policy = SecurityPolicies::get('geo');

        $mode = (string) ($policy['mode'] ?? self::MODE_OFF);
        if (! in_array($mode, [self::MODE_OFF, self::MODE_ALLOW, self::MODE_BLOCK], true)) {
            $mode = self::MODE_OFF;
        }

        return [
            'mode' => $mode,
            'countries' => self::normalizeCountries($policy['countries'] ?? []),
            'blockUnknown' => (bool) ($policy['blockUnknown'] ?? false),
            'message' => trim((string) ($policy['message'] ?? '')) ?: 'The portal is not available from your location.',
        ];
    }

    /**
     * Clean a country list into unique ISO 3166-1 alpha-2 codes.
     *
     * @param  mixed  $countries
     * @return list<string>
     */
    public static function normalizeCountries($countries): array
    {
        if (is_string($countries)) {
            $countries = preg_split('/[\s,;]+/', $countries) ?: [];
        }

        if (! is_array($countries)) {
            return [];
        }

        $clean = [];
        foreach ($countries as $code) {
            $code = strtoupper(trim((string) $code));
            if (preg_match('/^[A-Z]{2}$/', $code) && ! in_array($code, $clean, true)) {
                $clean[] = $code;
            }
        }

        sort($clean);

        return $clean;
    }

    /**
     * Should this request be refused?
     *
     * Returns the reason to record when it should, or null to let it through.
     * Deliberately total: every branch is spelled out, because a geo check
     * that silently falls through is worse than none.
     */
    public static function refuse(Request $request): ?string
    {
        $policy = self::policy();

        if ($policy['mode'] === self::MODE_OFF) {
            return null;
        }

        $country = Detectors::countryFromRequest();

        if ($country === null) {
            // No country, and no edge that could have supplied one: this is
            // not foreign traffic, it is traffic that never passed the CDN.
            if (! $policy['blockUnknown'] || ! self::edgeCouldResolve($request)) {
                return null;
            }

            return 'unknown';
        }

        $listed = in_array($country, $policy['countries'], true);

        // An allow-list with nothing in it would refuse the world, including
        // the administrator trying to fix it. Treat it as not yet configured.
        if ($policy['mode'] === self::MODE_ALLOW) {
            if ($policy['countries'] === []) {
                return null;
            }

            return $listed ? null : $country;
        }

        return $listed ? $country : null;
    }

    /**
     * Could the edge have told us a country for this client?
     *
     * Only a public, routable address reaches the app through Cloudflare. A
     * loopback or private-range client is the container talking to itself, a
     * health check, or a developer — none of which Cloudflare ever saw.
     */
    private static function edgeCouldResolve(Request $request): bool
    {
        $ip = (string) $request->ip();

        if ($ip === '') {
            return false;
        }

        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) !== false;
    }
}
