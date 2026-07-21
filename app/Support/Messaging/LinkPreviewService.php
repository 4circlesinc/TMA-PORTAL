<?php

namespace App\Support\Messaging;

use App\Models\LinkPreview;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Fetches Open Graph metadata for links shared in messages.
 *
 * This makes the server request a URL chosen by a user, which is the classic
 * SSRF shape: without care it becomes a way to probe the private network the
 * portal sits inside, or to reach cloud metadata endpoints. Every hop is
 * therefore resolved and checked against private/reserved address space before
 * a connection is made, redirects are followed manually so each new location
 * gets the same treatment, and only a small prefix of the response is read.
 *
 * Results are cached — including failures — because the composer asks for a
 * preview while the user is still typing.
 */
class LinkPreviewService
{
    /** How long a cached result stands before it is worth refetching. */
    public const TTL_DAYS = 14;

    /** Enough of the document to carry <head>; metadata lives near the top. */
    private const MAX_BYTES = 262144;

    private const TIMEOUT_SECONDS = 5;

    private const MAX_REDIRECTS = 3;

    /** Sent so site owners can identify (and block) this traffic. */
    private const USER_AGENT = 'TMAPortalLinkPreview/1.0 (+link preview for portal messaging)';

    /**
     * Preview for one URL, from cache when possible.
     *
     * Returns null when the link has no usable metadata — the caller renders a
     * plain link in that case rather than an empty card.
     */
    public static function for(string $url): ?LinkPreview
    {
        $url = self::normalise($url);

        if ($url === null) {
            return null;
        }

        $hash = hash('sha256', $url);
        $cached = LinkPreview::where('url_hash', $hash)->first();

        if ($cached && $cached->fetched_at && $cached->fetched_at->gt(now()->subDays(self::TTL_DAYS))) {
            return $cached->status === 'ok' ? $cached : null;
        }

        $data = self::fetch($url);

        $preview = LinkPreview::updateOrCreate(
            ['url_hash' => $hash],
            array_merge(
                ['url' => $url, 'fetched_at' => now()],
                $data ?? ['status' => 'failed']
            )
        );

        return $preview->status === 'ok' ? $preview : null;
    }

    /** Every http(s) URL in a message body, de-duplicated, in order. */
    public static function extract(?string $body): array
    {
        if (! $body) {
            return [];
        }

        preg_match_all('~\bhttps?://[^\s<>"\']+~i', $body, $matches);

        return array_values(array_unique($matches[0] ?? []));
    }

    /**
     * Reject anything that is not a plain http(s) URL, and strip credentials.
     *
     * A URL carrying a username/password would send those to whatever the host
     * resolves to; there is no legitimate reason for one in a shared link.
     */
    private static function normalise(string $url): ?string
    {
        $url = trim($url);

        if ($url === '' || mb_strlen($url) > 2048) {
            return null;
        }

        $parts = parse_url($url);

        if (! $parts || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        if (! in_array(strtolower($parts['scheme']), ['http', 'https'], true)) {
            return null;
        }

        if (isset($parts['user']) || isset($parts['pass'])) {
            return null;
        }

        return $url;
    }

    /**
     * Follow the URL by hand, validating each hop, and parse the result.
     *
     * Redirects are not delegated to the HTTP client: a permitted public URL
     * can redirect to `http://169.254.169.254/` or a private address, and only
     * checking the first URL would let that through.
     */
    private static function fetch(string $url): ?array
    {
        $current = $url;

        try {
            for ($hop = 0; $hop <= self::MAX_REDIRECTS; $hop++) {
                if (! self::isPubliclyRoutable($current)) {
                    return null;
                }

                $response = Http::withHeaders([
                    'User-Agent' => self::USER_AGENT,
                    'Accept' => 'text/html,application/xhtml+xml',
                ])
                    ->timeout(self::TIMEOUT_SECONDS)
                    ->connectTimeout(self::TIMEOUT_SECONDS)
                    ->withoutRedirecting()
                    ->get($current);

                if ($response->redirect()) {
                    $location = $response->header('Location');

                    if (! $location) {
                        return null;
                    }

                    // Relative redirects are legal; resolve against the current URL.
                    $current = self::normalise(self::absolutise($location, $current)) ?? '';

                    if ($current === '') {
                        return null;
                    }

                    continue;
                }

                if (! $response->successful()) {
                    return null;
                }

                $type = strtolower((string) $response->header('Content-Type'));

                // Only HTML carries Open Graph tags. Anything else - an image,
                // a PDF, a download - has nothing to read.
                if (! str_contains($type, 'html')) {
                    return null;
                }

                return self::parse(substr($response->body(), 0, self::MAX_BYTES), $current);
            }
        } catch (Throwable $e) {
            // A site being slow, down, or hostile is completely ordinary here.
            Log::info('Link preview fetch failed.', ['url' => $url, 'reason' => $e->getMessage()]);
        }

        return null;
    }

    /**
     * True only if the host resolves entirely to public addresses.
     *
     * Checks *every* resolved address: a hostname can return both a public and
     * a private record, and picking the public one to validate while the HTTP
     * client connects to the other is exactly the hole this closes.
     */
    private static function isPubliclyRoutable(string $url): bool
    {
        $host = parse_url($url, PHP_URL_HOST);

        if (! $host) {
            return false;
        }

        $host = trim($host, '[]');

        // A literal address needs no lookup, just the same verdict.
        $addresses = filter_var($host, FILTER_VALIDATE_IP)
            ? [$host]
            : self::resolve($host);

        if (empty($addresses)) {
            return false;
        }

        foreach ($addresses as $ip) {
            if (! self::isPublicAddress($ip)) {
                return false;
            }
        }

        return true;
    }

    private static function resolve(string $host): array
    {
        $records = @dns_get_record($host, DNS_A | DNS_AAAA) ?: [];

        $addresses = [];
        foreach ($records as $record) {
            if (! empty($record['ip'])) {
                $addresses[] = $record['ip'];
            }
            if (! empty($record['ipv6'])) {
                $addresses[] = $record['ipv6'];
            }
        }

        return $addresses;
    }

    private static function isPublicAddress(string $ip): bool
    {
        // Rejects private (10/8, 172.16/12, 192.168/16, fc00::/7) and reserved
        // (loopback, link-local incl. 169.254.169.254, multicast, 0.0.0.0)
        // ranges in one pass.
        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        ) !== false;
    }

    private static function absolutise(string $location, string $base): string
    {
        if (preg_match('~^https?://~i', $location)) {
            return $location;
        }

        $parts = parse_url($base);
        $root = $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');

        return str_starts_with($location, '/')
            ? $root.$location
            : $root.'/'.ltrim($location, '/');
    }

    /**
     * Pull Open Graph (and sensible fallbacks) out of the document head.
     *
     * Returns null when there is nothing worth showing — a card with only a
     * domain is noise, so a plain link is better.
     */
    private static function parse(string $html, string $url): ?array
    {
        $meta = self::metaTags($html);
        $domain = (string) parse_url($url, PHP_URL_HOST);

        $title = $meta['og:title']
            ?? $meta['twitter:title']
            ?? self::firstTitleTag($html);

        $image = $meta['og:image']
            ?? $meta['og:image:url']
            ?? $meta['twitter:image']
            ?? null;

        if (! $title && ! $image) {
            return null;
        }

        return [
            'status' => 'ok',
            'site_name' => Str::limit($meta['og:site_name'] ?? $domain, 120, ''),
            'title' => $title ? Str::limit($title, 300, '') : null,
            'description' => isset($meta['og:description']) || isset($meta['description'])
                ? Str::limit($meta['og:description'] ?? $meta['description'], 500, '')
                : null,
            // Images may be relative; the client must never be handed a path
            // it cannot load.
            'image_url' => $image ? self::absolutise($image, $url) : null,
            'domain' => Str::limit(preg_replace('/^www\./', '', $domain), 180, ''),
            'favicon_url' => 'https://www.google.com/s2/favicons?sz=64&domain='.urlencode($domain),
        ];
    }

    /** All <meta> name/property values, lower-cased keys. */
    private static function metaTags(string $html): array
    {
        preg_match_all('~<meta\b[^>]*>~i', $html, $tags);

        $meta = [];
        foreach ($tags[0] ?? [] as $tag) {
            if (! preg_match('~(?:property|name)\s*=\s*["\']([^"\']+)["\']~i', $tag, $key)) {
                continue;
            }
            if (! preg_match('~content\s*=\s*["\']([^"\']*)["\']~i', $tag, $value)) {
                continue;
            }

            $meta[strtolower($key[1])] = html_entity_decode(
                $value[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'
            );
        }

        return $meta;
    }

    private static function firstTitleTag(string $html): ?string
    {
        if (! preg_match('~<title[^>]*>(.*?)</title>~is', $html, $m)) {
            return null;
        }

        $title = trim(html_entity_decode($m[1], ENT_QUOTES | ENT_HTML5, 'UTF-8'));

        return $title === '' ? null : $title;
    }
}
