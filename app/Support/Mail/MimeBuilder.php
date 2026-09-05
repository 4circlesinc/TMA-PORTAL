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

        // Threading. Other mailboxes group by In-Reply-To / References matching
        // the original RFC Message-ID, a Gmail/Graph internal id here would
        // land as a brand-new conversation on every client that receives it.
        $inReplyTo = self::rfcMessageId($message['inReplyTo'] ?? '');
        if ($inReplyTo !== '') {
            $lines[] = 'In-Reply-To: '.$inReplyTo;
            $references = trim((string) ($message['references'] ?? ''));
            $lines[] = 'References: '.($references !== '' ? $references : $inReplyTo);
        }

        // data:-URI images (the signature logo above all) must travel as cid:
        // inline parts. Gmail and Outlook render those and refuse data: URIs,
        // which otherwise arrive as a broken-image icon.
        [$bodyHtml, $inline] = InlineImages::extract((string) ($message['bodyHtml'] ?? ''));
        $files = self::fileParts($message['attachments'] ?? []);

        if ($inline === [] && $files === []) {
            $lines[] = 'Content-Type: text/html; charset=UTF-8';
            $lines[] = 'Content-Transfer-Encoding: base64';
            $lines[] = '';
            $lines[] = chunk_split(base64_encode($bodyHtml), 76, "\r\n");

            return implode("\r\n", $lines);
        }

        if ($files === []) {
            $boundary = '=_tma_'.bin2hex(random_bytes(12));
            $lines[] = 'Content-Type: multipart/related; boundary="'.$boundary.'"';
            $lines[] = '';
            array_push($lines, ...self::relatedParts($boundary, $bodyHtml, $inline));
            $lines[] = '--'.$boundary.'--';

            return implode("\r\n", $lines);
        }

        $mixed = '=_tma_mix_'.bin2hex(random_bytes(12));
        $lines[] = 'Content-Type: multipart/mixed; boundary="'.$mixed.'"';
        $lines[] = '';
        $lines[] = '--'.$mixed;
        if ($inline === []) {
            $lines[] = 'Content-Type: text/html; charset=UTF-8';
            $lines[] = 'Content-Transfer-Encoding: base64';
            $lines[] = '';
            $lines[] = chunk_split(base64_encode($bodyHtml), 76, "\r\n");
        } else {
            $related = '=_tma_'.bin2hex(random_bytes(12));
            $lines[] = 'Content-Type: multipart/related; boundary="'.$related.'"';
            $lines[] = '';
            array_push($lines, ...self::relatedParts($related, $bodyHtml, $inline));
            $lines[] = '--'.$related.'--';
        }

        foreach ($files as $file) {
            $lines[] = '--'.$mixed;
            $lines[] = 'Content-Type: '.$file['mime'].'; name="'.$file['name'].'"';
            $lines[] = 'Content-Transfer-Encoding: base64';
            $lines[] = 'Content-Disposition: attachment; filename="'.$file['name'].'"';
            $lines[] = '';
            $lines[] = chunk_split(base64_encode($file['bytes']), 76, "\r\n");
        }

        $lines[] = '--'.$mixed.'--';

        return implode("\r\n", $lines);
    }

    /**
     * @param  list<array{cid: string, mime: string, name: string, bytes: string}>  $inline
     * @return list<string>
     */
    private static function relatedParts(string $boundary, string $bodyHtml, array $inline): array
    {
        $lines = [];
        $lines[] = '--'.$boundary;
        $lines[] = 'Content-Type: text/html; charset=UTF-8';
        $lines[] = 'Content-Transfer-Encoding: base64';
        $lines[] = '';
        $lines[] = chunk_split(base64_encode($bodyHtml), 76, "\r\n");

        foreach ($inline as $part) {
            $lines[] = '--'.$boundary;
            $lines[] = 'Content-Type: '.$part['mime'];
            $lines[] = 'Content-Transfer-Encoding: base64';
            $lines[] = 'Content-ID: <'.$part['cid'].'>';
            $lines[] = 'Content-Disposition: inline; filename="'.$part['name'].'"';
            $lines[] = '';
            $lines[] = chunk_split(base64_encode($part['bytes']), 76, "\r\n");
        }

        return $lines;
    }

    /**
     * @return list<array{name: string, mime: string, bytes: string}>
     */
    private static function fileParts(mixed $attachments): array
    {
        if (! is_array($attachments)) {
            return [];
        }

        $out = [];
        foreach ($attachments as $item) {
            if (! is_array($item) || ! is_string($item['bytes'] ?? null) || $item['bytes'] === '') {
                continue;
            }
            $name = OutboundFiles::safeFilename((string) ($item['name'] ?? 'attachment'));
            $mime = trim((string) ($item['mime'] ?? ''));
            if ($mime === '' || ! str_contains($mime, '/')) {
                $mime = 'application/octet-stream';
            }
            $out[] = [
                'name' => $name,
                'mime' => $mime,
                'bytes' => $item['bytes'],
            ];
        }

        return $out;
    }

    /** Gmail wants the message base64url-encoded, unpadded. */
    public static function encode(string $mime): string
    {
        return rtrim(strtr(base64_encode($mime), '+/', '-_'), '=');
    }

    /**
     * Angle-bracketed RFC 5322 Message-ID, or empty when the value is not one
     * (Gmail's hex id, a Graph item id, a blank string).
     */
    public static function rfcMessageId(string $value): string
    {
        $value = trim($value);
        if ($value === '' || ! str_contains($value, '@')) {
            return '';
        }

        if (! str_starts_with($value, '<')) {
            $value = '<'.$value;
        }
        if (! str_ends_with($value, '>')) {
            $value .= '>';
        }

        return $value;
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
