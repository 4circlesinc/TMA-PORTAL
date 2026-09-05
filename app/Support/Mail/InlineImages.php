<?php

namespace App\Support\Mail;

/**
 * Splits data:-URI images out of outgoing HTML into inline attachment parts.
 *
 * The signature importer and the compose editor both hold images as data:
 * URIs, self-contained is right for *storage*, but most receiving clients
 * (Gmail above all) refuse to render data: images in mail, so a signature
 * logo sent that way arrives as a broken-image icon. Real clients send the
 * bytes as an inline attachment and reference it from the HTML by cid:,
 * which every receiver renders; this produces that shape for both providers.
 */
final class InlineImages
{
    /**
     * Rewrite data:-URI <img> tags to cid: references and hand back the bytes.
     *
     * Identical images (a signature repeated in the quoted history, say)
     * collapse to one part referenced from every tag. Anything that does not
     * decode is left alone, an unrenderable src beats a corrupt attachment.
     *
     * @return array{0: string, 1: list<array{cid: string, mime: string, name: string, bytes: string}>}
     */
    public static function extract(string $html): array
    {
        if ($html === '' || stripos($html, 'data:image/') === false) {
            return [$html, []];
        }

        $parts = [];
        $seen = [];
        $index = 0;

        $rewritten = preg_replace_callback(
            '/(<img\b[^>]*?\bsrc=)(["\'])data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+\/=\s]+)\2/i',
            function (array $match) use (&$parts, &$seen, &$index): string {
                $key = sha1($match[4]);

                if (! isset($seen[$key])) {
                    $bytes = base64_decode(preg_replace('/\s+/', '', $match[4]) ?? '', true);

                    if ($bytes === false || $bytes === '') {
                        return $match[0];
                    }

                    $index++;
                    $type = strtolower($match[3]) === 'jpg' ? 'jpeg' : strtolower($match[3]);
                    $host = parse_url((string) config('app.url'), PHP_URL_HOST);
                    $host = is_string($host) && $host !== '' ? $host : 'localhost';
                    $seen[$key] = 'tma-inline-'.$index.'-'.substr(sha1($bytes), 0, 12).'@'.$host;
                    $parts[] = [
                        'cid' => $seen[$key],
                        'mime' => 'image/'.$type,
                        'name' => 'inline-'.$index.'.'.($type === 'jpeg' ? 'jpg' : $type),
                        'bytes' => $bytes,
                    ];
                }

                return $match[1].$match[2].'cid:'.$seen[$key].$match[2];
            },
            $html
        );

        // A regex engine giving up (pathological input) must not eat the body.
        return $rewritten === null ? [$html, []] : [$rewritten, $parts];
    }
}
