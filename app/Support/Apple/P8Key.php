<?php

namespace App\Support\Apple;

/**
 * An Apple .p8 key (APNs, Sign in with Apple) from an environment variable,
 * however it survived being pasted there.
 *
 * Environment editors flatten line breaks into spaces, escape them as \n or
 * \\n, or keep stray quotes, and OpenSSL refuses a key whose base64 is not on
 * lines of its own ("OpenSSL unable to validate key"). Only the text between
 * the BEGIN and END lines matters, so the key is rebuilt from that: every
 * character that is not base64 dropped, the rest wrapped at 64. A path to the
 * .p8 file works too.
 */
final class P8Key
{
    /** The key as OpenSSL wants it, or null when there is none it can use. */
    public static function from(?string $raw): ?string
    {
        $pem = self::rebuild((string) $raw);

        return $pem !== null && openssl_pkey_get_private($pem) !== false ? $pem : null;
    }

    /**
     * Why a value that is set cannot be used, or null when it can (or is not
     * set at all). For push:status, which should say this rather than crash.
     */
    public static function problem(?string $raw): ?string
    {
        if (trim((string) $raw) === '') {
            return null;
        }

        $pem = self::rebuild((string) $raw);
        if ($pem === null) {
            return 'it has no -----BEGIN PRIVATE KEY----- / -----END PRIVATE KEY----- lines; paste the whole .p8 file';
        }
        if (openssl_pkey_get_private($pem) === false) {
            return 'OpenSSL cannot read it; it may be cut short or not a .p8 from Apple';
        }

        return null;
    }

    private static function rebuild(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }
        if (! str_contains($raw, 'PRIVATE KEY') && is_file($raw)) {
            $raw = (string) file_get_contents($raw);
        }

        // Escaped line breaks first, so their backslashes do not leave stray
        // letters in the base64 below.
        $raw = str_replace(['\\\\n', '\\\\r', '\\n', '\\r'], "\n", $raw);

        if (! preg_match('/-----BEGIN ([A-Z ]*PRIVATE KEY)-----(.*?)-----END \1-----/s', $raw, $match)) {
            return null;
        }

        $body = (string) preg_replace('/[^A-Za-z0-9+\/=]/', '', $match[2]);
        if ($body === '') {
            return null;
        }

        return '-----BEGIN '.$match[1]."-----\n".chunk_split($body, 64, "\n").'-----END '.$match[1]."-----\n";
    }
}
