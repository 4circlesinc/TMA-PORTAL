<?php

namespace App\Support\Calendar;

/**
 * Validates a user-supplied calendar subscription URL before the server
 * fetches it.
 *
 * This exists because "subscribe to this URL" is a server-side request to an
 * address an outsider chose — classic SSRF. Without a guard, someone could
 * point a subscription at the cloud metadata endpoint, at an internal admin
 * service, or at localhost, and read the response back out through the
 * calendar. Every host is therefore resolved and checked against private and
 * reserved ranges *before* any request is made, and again on each redirect.
 */
class SubscriptionUrl
{
    /** webcal:// is the conventional scheme for calendar subscriptions. */
    private const ALLOWED_SCHEMES = ['http', 'https', 'webcal'];

    /**
     * Normalise and validate. Returns an https/http URL safe to fetch.
     *
     * @throws IcsException
     */
    public static function validate(string $url): string
    {
        $url = trim($url);

        $parts = parse_url($url);
        if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
            throw new IcsException('That doesn’t look like a valid calendar URL.');
        }

        $scheme = strtolower($parts['scheme']);
        if (! in_array($scheme, self::ALLOWED_SCHEMES, true)) {
            throw new IcsException('Calendar URLs must start with http, https or webcal.');
        }

        // webcal is just https by another name.
        if ($scheme === 'webcal') {
            $url = 'https://'.substr($url, strpos($url, '://') + 3);
            $scheme = 'https';
        }

        self::assertHostIsPublic($parts['host']);

        return $url;
    }

    /**
     * Reject anything that resolves into a private, loopback, link-local or
     * otherwise reserved range.
     *
     * @throws IcsException
     */
    public static function assertHostIsPublic(string $host): void
    {
        $host = trim($host, '[]');

        // A literal IP needs no lookup; anything else is resolved first.
        $addresses = filter_var($host, FILTER_VALIDATE_IP)
            ? [$host]
            : self::resolve($host);

        if (! $addresses) {
            throw new IcsException('That calendar host could not be found.');
        }

        foreach ($addresses as $ip) {
            /*
             * FILTER_FLAG_NO_PRIV_RANGE and NO_RES_RANGE together cover
             * 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 (the cloud
             * metadata address), ::1, fc00::/7 and friends.
             */
            $public = filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
            );

            if ($public === false) {
                throw new IcsException('That calendar URL points to a private address, which isn’t allowed.');
            }
        }
    }

    /**
     * @return array<int, string>
     */
    private static function resolve(string $host): array
    {
        $records = @dns_get_record($host, DNS_A | DNS_AAAA) ?: [];

        $out = [];
        foreach ($records as $record) {
            if (! empty($record['ip'])) {
                $out[] = $record['ip'];
            }
            if (! empty($record['ipv6'])) {
                $out[] = $record['ipv6'];
            }
        }

        return $out;
    }
}
