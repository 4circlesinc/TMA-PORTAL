<?php

namespace App\Support\Security;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Where an address sits, as far as anyone can tell from the address alone.
 *
 * ── What this can and cannot tell you ────────────────────────────────────
 *
 * This is not a street address and never will be. An IP resolves to where the
 * ISP routes the block, which is a city-level guess: right for a home
 * broadband line in a large city, wrong by tens of kilometres for a rural
 * one, and wrong by a whole country for a corporate VPN egress or a mobile
 * carrier that backhauls to one gateway. Postal code and coordinates come
 * from the same guess and inherit the same error — coordinates are the
 * centroid of a city or region, never a building, so never present them on a
 * map as if they pinned a person's door.
 *
 * Read it as "this sign-in came from roughly here", which is what an audit
 * trail needs: enough to notice that an account that always signs in from
 * Toronto suddenly signed in from Lagos.
 *
 * ── Why it reuses the reputation lookup ──────────────────────────────────
 *
 * {@see Anonymiser} already calls a provider per address for the VPN policy,
 * and both providers return location in the very same response it throws
 * away. Asking a second service for what we already have in hand would double
 * the cost and the latency to learn nothing new, so this parses the answer
 * that call already paid for, under its own cache key.
 *
 * ── Never on the request path ────────────────────────────────────────────
 *
 * Like the reputation lookup, every failure returns null: no driver, no key,
 * a timeout, an outage, a shape we do not recognise. A sign-in must not wait
 * on, or fail because of, a geo API. Unresolved location is an empty column
 * and a dash in the UI, which is the honest answer.
 */
final class IpLocation
{
    /**
     * Resolve an address to a location, or null when it cannot be known.
     *
     * @return array{city: ?string, region: ?string, postal: ?string, country: ?string, latitude: ?float, longitude: ?float}|null
     */
    public static function lookup(?string $ip): ?array
    {
        $ip = trim((string) $ip);

        if ($ip === '' || ! self::isPublic($ip)) {
            // Loopback, private ranges and CLI have no location to find. The
            // container's own address is not where anybody signed in from.
            return null;
        }

        $driver = strtolower(trim((string) config('services.ip_reputation.driver', '')));
        $key = (string) config('services.ip_reputation.key', '');

        if ($driver === '' || $key === '') {
            return null;
        }

        $hours = (int) config('services.ip_reputation.cache_hours', 24);

        $found = Cache::remember(
            'ip-location.'.$driver.'.'.md5($ip),
            now()->addHours($hours),
            function () use ($driver, $key, $ip) {
                try {
                    return match ($driver) {
                        'ipqualityscore' => self::askIpQualityScore($key, $ip),
                        'ipapi' => self::askIpApi($key, $ip),
                        default => null,
                    } ?? false;
                } catch (\Throwable) {
                    // Cache the miss too: an address that could not be resolved
                    // this hour will not resolve on the next sign-in either,
                    // and retrying every time turns one outage into a stampede.
                    return false;
                }
            },
        );

        return is_array($found) ? $found : null;
    }

    /**
     * A one-line rendering of a location, for a log row or an email.
     *
     * Only the parts that resolved, so a provider that knew the country but
     * not the city reads "Canada" rather than "—, —, Canada".
     */
    public static function describe(?array $location): ?string
    {
        if (! is_array($location)) {
            return null;
        }

        $parts = array_values(array_filter([
            $location['city'] ?? null,
            $location['region'] ?? null,
            $location['country'] ?? null,
        ], fn ($part) => is_string($part) && trim($part) !== ''));

        return $parts === [] ? null : implode(', ', $parts);
    }

    /** @return array<string, mixed>|null */
    private static function askIpQualityScore(string $key, string $ip): ?array
    {
        $response = Http::timeout((int) config('services.ip_reputation.timeout', 2))
            ->get('https://ipqualityscore.com/api/json/ip/'.urlencode($key).'/'.urlencode($ip), [
                'strictness' => 1,
                'allow_public_access_points' => 'true',
            ]);

        if (! $response->successful()) {
            return null;
        }

        $body = $response->json();

        if (! is_array($body) || ($body['success'] ?? false) !== true) {
            return null;
        }

        return self::shape(
            city: $body['city'] ?? null,
            region: $body['region'] ?? null,
            postal: $body['zip_code'] ?? null,
            // IPQS reports the country as a two-letter code, same as the edge.
            country: $body['country_code'] ?? null,
            latitude: $body['latitude'] ?? null,
            longitude: $body['longitude'] ?? null,
        );
    }

    /** @return array<string, mixed>|null */
    private static function askIpApi(string $key, string $ip): ?array
    {
        $response = Http::timeout((int) config('services.ip_reputation.timeout', 2))
            ->get('https://ipapi.co/'.urlencode($ip).'/json/', ['key' => $key]);

        if (! $response->successful()) {
            return null;
        }

        $body = $response->json();

        if (! is_array($body) || ($body['error'] ?? false)) {
            return null;
        }

        return self::shape(
            city: $body['city'] ?? null,
            region: $body['region'] ?? null,
            postal: $body['postal'] ?? null,
            country: $body['country_code'] ?? null,
            latitude: $body['latitude'] ?? null,
            longitude: $body['longitude'] ?? null,
        );
    }

    /**
     * Normalise a provider's answer, or null when it carried no location at
     * all — an all-null row is worth neither a column nor a cache entry.
     *
     * @return array{city: ?string, region: ?string, postal: ?string, country: ?string, latitude: ?float, longitude: ?float}|null
     */
    private static function shape(
        mixed $city,
        mixed $region,
        mixed $postal,
        mixed $country,
        mixed $latitude,
        mixed $longitude,
    ): ?array {
        $location = [
            'city' => self::text($city, 120),
            'region' => self::text($region, 120),
            'postal' => self::text($postal, 20),
            'country' => self::countryCode($country),
            'latitude' => self::coordinate($latitude, 90),
            'longitude' => self::coordinate($longitude, 180),
        ];

        $known = array_filter($location, fn ($value) => $value !== null);

        return $known === [] ? null : $location;
    }

    private static function text(mixed $value, int $limit): ?string
    {
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }

        $text = trim((string) $value);

        // Providers say "N/A" and "Unknown" rather than omitting the field.
        if ($text === '' || in_array(strtolower($text), ['n/a', 'na', 'unknown', 'null', '-'], true)) {
            return null;
        }

        return mb_substr($text, 0, $limit);
    }

    private static function countryCode(mixed $value): ?string
    {
        $text = self::text($value, 8);

        if ($text === null) {
            return null;
        }

        $code = strtoupper($text);

        return strlen($code) === 2 && $code !== 'XX' ? $code : null;
    }

    private static function coordinate(mixed $value, float $bound): ?float
    {
        if (! is_numeric($value)) {
            return null;
        }

        $number = (float) $value;

        // 0,0 is the Atlantic null island: every provider's "we don't know".
        if ($number === 0.0 || abs($number) > $bound) {
            return null;
        }

        return round($number, 4);
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
