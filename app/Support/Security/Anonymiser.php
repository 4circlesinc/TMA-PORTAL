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
        /*
         * The big cloud platforms.
         *
         * Added 20 Sep 2026 after a browser-extension VPN walked straight
         * through: the free tiers of those extensions mostly run on AWS,
         * Google Cloud and Azure rather than on the VPN-specialist networks
         * above, so a list without them missed the kind of VPN a person is
         * most likely to have installed.
         *
         * These are the broad public ranges, not the whole of each provider —
         * the point is coverage of the common exits, and every one of these
         * is a datacentre either way. Nothing a household connects from.
         */
        // Amazon AWS
        ['3.0.0.0', 8],
        ['13.32.0.0', 12],
        ['18.32.0.0', 11],
        ['34.192.0.0', 10],
        ['35.152.0.0', 13],
        ['52.0.0.0', 8],
        ['54.64.0.0', 10],
        ['99.77.128.0', 17],
        // Google Cloud
        ['34.64.0.0', 11],
        ['34.96.0.0', 12],
        ['34.128.0.0', 10],
        ['35.184.0.0', 13],
        ['35.192.0.0', 11],
        ['35.224.0.0', 12],
        ['104.154.0.0', 15],
        ['104.196.0.0', 14],
        ['130.211.0.0', 16],
        ['146.148.0.0', 16],
        // Microsoft Azure
        ['13.64.0.0', 11],
        ['20.0.0.0', 8],
        ['40.64.0.0', 10],
        ['51.4.0.0', 15],
        ['52.224.0.0', 11],
        ['104.40.0.0', 13],
        ['168.61.0.0', 16],
        ['191.232.0.0', 13],
        // Oracle Cloud
        ['129.146.0.0', 15],
        ['132.145.0.0', 16],
        ['140.238.0.0', 16],
        ['150.230.0.0', 16],
        // Scaleway / Online.net
        ['51.15.0.0', 16],
        ['51.158.0.0', 15],
        ['163.172.0.0', 16],
        ['212.129.0.0', 18],
        // Contabo, Alibaba, Tencent — the cheap tiers behind many free VPNs.
        ['161.97.0.0', 16],
        ['173.212.192.0', 18],
        ['207.180.192.0', 18],
        ['47.52.0.0', 14],
        ['47.240.0.0', 14],
        ['119.28.0.0', 15],
        ['170.106.0.0', 16],
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
     * Every header here has to be turned on at the edge, and which ones are
     * available depends on the plan. When none of them arrive this says
     * nothing at all, which is why the hosting check sits beside it.
     *
     * ── Why three headers and not one ────────────────────────────────────
     *
     * `CF-Anonymiser` is ours, not Cloudflare's: a WAF custom rule can be set
     * to add a request header on whatever expression the plan supports, so
     * this is the escape hatch for a firm to express "this is a VPN" using
     * fields we cannot know about from here. It is checked first because it
     * is the only one that is a deliberate statement rather than an inference.
     *
     * `cf-bot-score` comes from the "Add bot protection headers" managed
     * transform, which is Enterprise with Bot Management. 1 means certainly
     * automated, 99 means certainly human. A VPN does not make a request a
     * bot, so this is set low — it is here to catch scripted abuse, not to
     * second-guess a person on a corporate VPN.
     *
     * `CF-Threat-Score` is legacy and dying: Cloudflare removed it from the
     * dashboard in March 2025 and expects to disable the underlying rules
     * during 2026. It is still read so that an edge already configured for it
     * keeps working, and it must not be the header anybody is told to set up.
     */
    private static function cloudflareSaysAnonymiser(Request $request): bool
    {
        $verdict = strtolower(trim((string) $request->header('CF-Anonymiser', '')));
        if (in_array($verdict, ['1', 'true', 'vpn', 'proxy', 'tor', 'yes'], true)) {
            return true;
        }

        $bot = $request->header('CF-Bot-Score');
        if ($bot !== null && is_numeric($bot) && (int) $bot > 0 && (int) $bot <= 5) {
            return true;
        }

        $threat = $request->header('CF-Threat-Score');

        return $threat !== null && is_numeric($threat) && (int) $threat >= 30;
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
