<?php

namespace App\Support\Mail;

use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Signature images, out of the settings blob and into object storage.
 *
 * A signature is HTML the person pastes or imports, and people paste
 * pictures: a firm logo, a scanned handwritten name, a set of social icons.
 * Held as `data:` URIs those pictures live inside `users.preferences`, which
 * is a JSON column read by everything that loads a user. One 2.6 MB logo on
 * one account made that row 5.4 MB, and every listing that touched it paid
 * json_decode on the lot — 55ms of a 59ms presence board, for green dots.
 *
 * So the bytes go to the same private bucket as avatars and file-manager
 * documents, and the signature keeps a `/media/signatures/…` URL. The column
 * goes back to being the kilobyte of settings it is meant to be.
 *
 * Two rules make that safe:
 *
 * - The bucket stays private. These are served by
 *   {@see \App\Http\Controllers\SignatureImageController}, to signed-in
 *   people only, exactly as avatars are.
 * - Outbound mail never sends the URL. A recipient has no session here, so a
 *   private URL would render as a broken image in their client. {@see
 *   self::inline()} puts the bytes back as `data:` before a message is built,
 *   and {@see InlineImages} then turns those into proper CID attachments,
 *   which is the path that already worked.
 */
class SignatureImages
{
    /** Where the objects live on the disk, and in the served path. */
    public const PREFIX = 'signatures';

    /** Pictures small enough to be a signature, not an attachment. */
    public const MAX_BYTES = 2_097_152;

    /** What a browser may be told these are. */
    private const MIME = [
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
    ];

    private static function disk(): string
    {
        return config('filesystems.avatar_disk', 'local');
    }

    /**
     * Rewrite every `data:` image in a signature to a stored URL.
     *
     * Called on the way in, so nothing large is ever written to the column.
     * An image that cannot be decoded, or is larger than {@see self::MAX_BYTES},
     * is left exactly as it was: a signature that still renders beats one
     * silently emptied, and the length cap upstream still applies.
     */
    public static function store(string $html): string
    {
        if ($html === '' || stripos($html, 'data:image/') === false) {
            return $html;
        }

        $seen = [];

        return (string) preg_replace_callback(
            '/(<img\b[^>]*?\bsrc=)(["\'])data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+\/=\s]+)\2/i',
            function (array $match) use (&$seen): string {
                $raw = preg_replace('/\s+/', '', $match[4]) ?? '';
                $key = sha1($raw);

                // The same picture twice in one signature is one object.
                if (isset($seen[$key])) {
                    return $match[1].$match[2].$seen[$key].$match[2];
                }

                $bytes = base64_decode($raw, true);

                if ($bytes === false || $bytes === '' || strlen($bytes) > self::MAX_BYTES) {
                    return $match[0];
                }

                $ext = strtolower($match[3]) === 'jpg' ? 'jpeg' : strtolower($match[3]);
                $name = self::PREFIX.'/'.Str::uuid()->toString().'.'.$ext;

                // No visibility argument: the bucket is private, and these are
                // served through the app the way avatars are.
                Storage::disk(self::disk())->put($name, $bytes);

                $seen[$key] = '/media/'.$name;

                return $match[1].$match[2].$seen[$key].$match[2];
            },
            $html,
        );
    }

    /**
     * Put the bytes back, for a message about to be sent.
     *
     * The recipient is not signed in here, so a `/media/…` URL would be a
     * broken image in their client. This restores the `data:` form that
     * {@see InlineImages::extract()} already knows how to turn into CID
     * attachments. An object that has gone missing is left as it is rather
     * than dropped, so the failure is a missing picture, not a mangled
     * signature.
     */
    public static function inline(string $html): string
    {
        if ($html === '' || ! str_contains($html, '/media/'.self::PREFIX.'/')) {
            return $html;
        }

        $cache = [];

        return (string) preg_replace_callback(
            '#(<img\b[^>]*?\bsrc=)(["\'])(?:[^"\']*?)?/media/('.preg_quote(self::PREFIX, '#').'/[a-f0-9-]{36}\.(?:png|jpe?g|gif|webp))\2#i',
            function (array $match) use (&$cache): string {
                $path = $match[3];

                if (! array_key_exists($path, $cache)) {
                    $cache[$path] = self::dataUri($path);
                }

                return $cache[$path] === null
                    ? $match[0]
                    : $match[1].$match[2].$cache[$path].$match[2];
            },
            $html,
        );
    }

    /** One stored object as a `data:` URI, or null when it is not there. */
    private static function dataUri(string $path): ?string
    {
        $disk = Storage::disk(self::disk());

        if (! $disk->exists($path)) {
            return null;
        }

        $bytes = $disk->get($path);

        if ($bytes === null || $bytes === '') {
            return null;
        }

        return 'data:'.self::mimeFor($path).';base64,'.base64_encode($bytes);
    }

    /** The media type for a stored object, from its own extension. */
    public static function mimeFor(string $path): string
    {
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        return self::MIME[$ext] ?? 'application/octet-stream';
    }

    /** Is this one of ours? Blocks path traversal and anything else. */
    public static function isStoredName(string $name): bool
    {
        return preg_match('/^[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/', $name) === 1;
    }
}
