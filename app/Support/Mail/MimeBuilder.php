<?php

namespace App\Support\Mail;

/**
 * Builds the RFC 2822 message Gmail's send/draft endpoints expect.
 *
 * Graph takes JSON instead, so only the Gmail provider uses this. Kept
 * separate because MIME assembly is fiddly enough to want testing on its own.
 */
class MimeBuilder
{
    /**
     * @param  array<string, mixed>  $message
     */
    public static function build(array $message): string
    {
        $lines = [];

        $lines[] = 'MIME-Version: 1.0';
        $lines[] = 'To: '.self::addressList($message['to'] ?? []);

        if (! empty($message['cc'])) {
            $lines[] = 'Cc: '.self::addressList($message['cc']);
        }
        if (! empty($message['bcc'])) {
            $lines[] = 'Bcc: '.self::addressList($message['bcc']);
        }

        $lines[] = 'Subject: '.self::encodeHeader((string) ($message['subject'] ?? ''));

        // Threading. Without these two headers a reply starts a new
        // conversation in every client that receives it.
        if (! empty($message['messageId'])) {
            $lines[] = 'In-Reply-To: '.$message['messageId'];
            $lines[] = 'References: '.$message['messageId'];
        }

        $lines[] = 'Content-Type: text/html; charset=UTF-8';
        $lines[] = 'Content-Transfer-Encoding: base64';
        $lines[] = '';
        $lines[] = chunk_split(base64_encode((string) ($message['bodyHtml'] ?? '')), 76, "\r\n");

        return implode("\r\n", $lines);
    }

    /** Gmail wants the message base64url-encoded, unpadded. */
    public static function encode(string $mime): string
    {
        return rtrim(strtr(base64_encode($mime), '+/', '-_'), '=');
    }

    /**
     * @param  array<int, mixed>|string  $addresses
     */
    private static function addressList(array|string $addresses): string
    {
        if (is_string($addresses)) {
            return $addresses;
        }

        $parts = [];

        foreach ($addresses as $address) {
            if (is_string($address)) {
                $parts[] = $address;

                continue;
            }

            $email = $address['email'] ?? null;
            if (! $email) {
                continue;
            }

            $name = $address['name'] ?? null;
            $parts[] = $name
                ? self::encodeHeader($name).' <'.$email.'>'
                : $email;
        }

        return implode(', ', $parts);
    }

    /** Non-ASCII headers need RFC 2047 encoding or they arrive as mojibake. */
    private static function encodeHeader(string $value): string
    {
        if (preg_match('/^[\x20-\x7E]*$/', $value)) {
            return $value;
        }

        return '=?UTF-8?B?'.base64_encode($value).'?=';
    }
}
