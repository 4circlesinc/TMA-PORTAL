<?php

namespace App\Support\Security;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Is this request coming through a VPN, proxy, or Tor?
 *
 * ── Read this before trusting it ─────────────────────────────────────────
 *
 * There is no header that says "this is a VPN", and there is no way to be
 * certain. Every method here is inference from the address:
 *
 *   - Cloudflare's own verdict, when the edge is configured to send one;
 *   - whether the address belongs to a hosting company rather than a
 *     consumer ISP, which is where almost every commercial VPN exits;
 *   - a reputation provider's opinion, when one is configured.
 *
 * That catches the ordinary case — somebody switching on NordVPN — and it
 * will also catch, sooner or later:
 *
 *   - a client whose employer forces all traffic down a corporate VPN;
 *   - iCloud Private Relay and some mobile carriers;
 *   - a traveller on a hotel or airline network.
 *
 * The firm chose to block anyway, with no exception list. That is a real
 * decision with a real cost: the failure mode is a client who cannot file
 * their documents and has no way to tell you why. Everything refused is
 * recorded ({@see SecurityAudit}) precisely so that when somebody says "the
 * portal won't let me in", the answer is one query away.
 *
 * What this does NOT do is stop a determined attacker. A residential-proxy
 * service looks exactly like a home broadband connection, and nothing here
 * will see it. Treat this as policy enforcement against ordinary users, not
 * as a security boundary.
 */
final class Anonymiser
{
    /** Reasons, in the order they are checked. */
    public const TOR = 'tor';

    public const CLOUDFLARE = 'cloudflare';

    public const HOSTING = 'hosting';

    public const REPUTATION = 'reputation';

    /**
     * Networks that serve machines, not households.
     *
     * Commercial VPNs rent from these. Kept deliberately short and made of
     * ranges that are unambiguously datacentre: a list padded with
     * "probably hosting" CIDRs buys a little more coverage and a lot more
     * refused clients, and there is no allowlist to rescue them with.
     *
     * Not exhaustive by design — the reputation provider is what covers the
     * long tail, and Cloudflare covers what it knows.
     *
     * @var list<array{0: string, 1: int}> [network, prefix length]
     */
    private const HOSTING_RANGES = [
        // M247 / M247 Europe — the exit network behind a large share of
        // consumer VPN brands.
        ['5.253.204.0', 22],
        ['37.120.128.0', 17],
        ['77.243.176.0', 20],
        ['185.180.12.0', 22],
        // Choopa / Vultr
        ['45.32.0.0', 12],
        ['108.61.0.0', 16],
        ['149.28.0.0', 16],
        // DigitalOcean
        ['104.131.0.0', 16],
        ['138.68.0.0', 16],
        ['159.65.0.0', 16],
        ['165.227.0.0', 16],
        ['167.99.0.0', 16],
        // OVH
        ['51.75.0.0', 16],
        ['51.83.0.0', 16],
        ['54.36.0.0', 16],
        ['145.239.0.0', 16],
        // Linode
        ['139.162.0.0', 16],
        ['172.104.0.0', 15],
        ['45.79.0.0', 16],
        // Hetzner
        ['5.9.0.0', 16],
        ['88.99.0.0', 16],
        ['95.216.0.0', 15],
        ['116.202.0.0', 15],
        // Leaseweb
        ['5.79.64.0', 18],
        ['37.48.64.0', 18],
        ['95.211.0.0', 16],
    ];

    /**
     * Why this request should be refused, or null to let it through.
     *
     * Ordered cheapest-first: the free signals decide most requests, and the
     * paid lookup is only reached when they have nothing to say.
     */
    public static function detect(Request $request): ?string
    {
        $ip = (string) $request->ip();

        if ($ip === '' || ! self::isPublic($ip)) {
            // Loopback, private ranges, CLI: nothing in front of these, and
            // no visitor behind them.
            return null;
        }

        if (self::isTor($request)) {
            return self::TOR;
        }

        if (self::cloudflareSaysAnonymiser($request)) {
            return self::CLOUDFLARE;
        }

        if (self::inHostingRange($ip)) {
            return self::HOSTING;
        }

        if (self::reputationSaysAnonymiser($ip)) {
            return self::REPUTATION;
        }

        return null;
    }

    /** Human wording for the audit trail and the admin screen. */
    public static function describe(string $reason): string
    {
        return match ($reason) {
            self::TOR => 'Tor exit node',
            self::CLOUDFLARE => 'Flagged by Cloudflare as an anonymiser',
            self::HOSTING => 'Hosting or datacentre network',
            self::REPUTATION => 'Flagged by IP reputation as VPN or proxy',
            default => 'Anonymised connection',
        };
    }

    /**
     * Cloudflare's own read on the connection.
     *
     * Two headers, both of which have to be turned on at the edge — a
     * managed transform or a WAF rule copying the bot-management fields into
     * request headers. When neither is present this simply says nothing,
     * which is why the hosting check exists beside it.
     */
    private static function cloudflareSaysAnonymiser(Request $request): bool
    {
        // Cloudflare's threat score: 0 is clean, higher is worse. Anything at
        // or above this has a reputation for abuse. Set conservatively: this
        // header also rises for shared residential addresses behind CGNAT.
        $threat = $request->header('CF-Threat-Score');
        if ($threat !== null && is_numeric($threat) && (int) $threat >= 30) {
            return true;
        }

        // A WAF rule can be set to pass its verdict through directly.
        $verdict = strtolower(trim((string) $request->header('CF-Anonymiser', '')));

        return in_array($verdict, ['1', 'true', 'vpn', 'proxy', 'tor', 'yes'], true);
    }

    private static function isTor(Request $request): bool
    {
        // Cloudflare labels Tor traffic with the pseudo-country T1.
        return strtoupper(trim((string) $request->header('CF-IPCountry', ''))) === 'T1';
    }

    /** Does this address belong to a network that serves machines? */
    public static function inHostingRange(string $ip): bool
    {
        $addr = ip2long($ip);

        if ($addr === false) {
            // IPv6: not range-checked here. The reputation provider and
            // Cloudflare still see it; claiming otherwise would be worse
            // than admitting the gap.
            return false;
        }

        foreach (self::HOSTING_RANGES as [$network, $bits]) {
            $base = ip2long($network);
            if ($base === false) {
                continue;
            }

            $mask = -1 << (32 - $bits);

            if (($addr & $mask) === ($base & $mask)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Ask a reputation provider, if one is configured.
     *
     * Every failure path returns false — no key, a timeout, a 500, a shape
     * we do not recognise. A sign-in page must not go down because a
     * third-party API did, and "we could not check" is not "this is a VPN".
     */
    private static function reputationSaysAnonymiser(string $ip): bool
    {
        $driver = strtolower(trim((string) config('services.ip_reputation.driver', '')));
        $key = (string) config('services.ip_reputation.key', '');

        if ($driver === '' || $key === '') {
            return false;
        }

        $hours = (int) config('services.ip_reputation.cache_hours', 24);

        return (bool) Cache::remember(
            'ip-reputation.'.$driver.'.'.md5($ip),
            now()->addHours($hours),
            function () use ($driver, $key, $ip) {
                try {
                    return match ($driver) {
                        'ipqualityscore' => self::askIpQualityScore($key, $ip),
                        'ipapi' => self::askIpApi($key, $ip),
                        default => false,
                    };
                } catch (\Throwable) {
                    return false;
                }
            },
        );
    }

    private static function askIpQualityScore(string $key, string $ip): bool
    {
        $response = Http::timeout((int) config('services.ip_reputation.timeout', 2))
            ->get('https://ipqualityscore.com/api/json/ip/'.urlencode($key).'/'.urlencode($ip), [
                'strictness' => 1,
                'allow_public_access_points' => 'true',
            ]);

        if (! $response->successful()) {
            return false;
        }

        $body = $response->json();

        if (! is_array($body) || ($body['success'] ?? false) !== true) {
            return false;
        }

        return (bool) ($body['vpn'] ?? false)
            || (bool) ($body['proxy'] ?? false)
            || (bool) ($body['tor'] ?? false);
    }

    private static function askIpApi(string $key, string $ip): bool
    {
        $response = Http::timeout((int) config('services.ip_reputation.timeout', 2))
            ->get('https://ipapi.co/'.urlencode($ip).'/json/', ['key' => $key]);

        if (! $response->successful()) {
            return false;
        }

        $body = $response->json();

        if (! is_array($body)) {
            return false;
        }

        return (bool) ($body['proxy'] ?? false)
            || (bool) ($body['hosting'] ?? false)
            || (bool) ($body['tor'] ?? false);
    }

    /** A routable address a real visitor could be sitting behind. */
    private static function isPublic(string $ip): bool
    {
        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) !== false;
    }
}
