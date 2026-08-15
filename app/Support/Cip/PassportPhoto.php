<?php

namespace App\Support\Cip;

use App\Models\CipPerson;
use App\Support\AvatarService;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The passport-sized photo (§2), and the profile picture that comes with it.
 *
 * A passport photo is 2×2 inches, square, and printed — so the rule here is
 * square at 600 pixels or better, which is two inches at 300dpi. Anything
 * smaller cannot be filed however good it looks on screen, and a portrait
 * snapshot centre-cropped to square would cut the head the government wants
 * framed. Both are refused with the measurement rather than a shrug.
 *
 * What is stored is two things from one upload. The bytes that arrived are
 * kept as they arrived, because that copy is the one that gets filed; the
 * avatar is a 320px square derived from it by the same service every other
 * photo in the portal goes through, so an applicant looks the same in a table
 * row as everybody else. Uploading a new photo replaces both.
 *
 * The wire format is a data URL, matching the client form: the intake posts
 * one JSON body and an application that exists without its applicant's photo
 * is a record §2 does not allow. Nothing is stored as base64 — it is decoded
 * here and written as a file.
 */
class PassportPhoto
{
    /** 2 inches at 300dpi. The print floor, not a preference. */
    public const MIN_PIXELS = 600;

    /** Enough for a 300dpi photo from any camera; past this it is a scan. */
    public const MAX_BYTES = 8 * 1024 * 1024;

    /** Cameras and croppers land a pixel or two out; a face does not. */
    private const SQUARE_TOLERANCE = 0.02;

    /**
     * The bytes behind a data URL, or null if this is not one.
     *
     * Deliberately strict about the prefix: a bare base64 blob could be
     * anything, and the only producer is our own file reader.
     */
    public static function decode(string $value): ?string
    {
        if (! preg_match('#^data:image/(jpeg|jpg|png|webp);base64,#i', $value, $m)) {
            return null;
        }

        $binary = base64_decode(substr($value, strlen($m[0])), true);

        return $binary === false || $binary === '' ? null : $binary;
    }

    /**
     * Why these bytes are not a passport photo, or null if they are.
     *
     * Returns the message rather than throwing so the validator, the intake
     * and any later importer all refuse for the same stated reason.
     */
    public static function reject(string $binary): ?string
    {
        if (strlen($binary) > self::MAX_BYTES) {
            return 'That photo is too large. Keep it under '.(self::MAX_BYTES / 1024 / 1024).'MB.';
        }

        $size = @getimagesizefromstring($binary);
        if (! $size) {
            return 'That image could not be read. Try a JPG, PNG, or WebP.';
        }

        [$width, $height] = $size;

        if ($width < self::MIN_PIXELS || $height < self::MIN_PIXELS) {
            return 'A passport photo has to be at least '.self::MIN_PIXELS.'×'.self::MIN_PIXELS
                .' pixels — this one is '.$width.'×'.$height.'.';
        }

        // Square, because 2×2 inches is square. Checked as a ratio so a
        // 601×600 crop passes and a portrait photo does not.
        if (abs($width - $height) / max($width, $height) > self::SQUARE_TOLERANCE) {
            return 'A passport photo has to be square (2×2 inches) — this one is '
                .$width.'×'.$height.'.';
        }

        return null;
    }

    /**
     * Keep the photo and the avatar it produces, replacing whatever the person
     * had before.
     *
     * @return array{path: string, url: string}
     */
    public static function store(string $binary, ?CipPerson $previous = null): array
    {
        // The avatar first: it is the half that can refuse (GD reads the
        // bytes), and failing before anything is written leaves no orphan.
        $url = AvatarService::storeBinary($binary, $previous?->photo_url);
        abort_if($url === null, 422, 'That image could not be read. Try a JPG, PNG, or WebP.');

        $path = 'cip/passport-photos/'.Str::uuid()->toString().'.'.self::extension($binary);

        // No visibility argument: the bucket is private and the photo is
        // served through the app, so an applicant's likeness is never a
        // guessable public URL.
        Storage::disk(self::disk())->put($path, $binary);

        if ($previous?->photo_path) {
            Storage::disk(self::disk())->delete($previous->photo_path);
        }

        return ['path' => $path, 'url' => $url];
    }

    /** The archival copy, as bytes and mime, or null if it has gone missing. */
    public static function read(CipPerson $person): ?array
    {
        if (! $person->photo_path || ! Storage::disk(self::disk())->exists($person->photo_path)) {
            return null;
        }

        return [
            'body' => Storage::disk(self::disk())->get($person->photo_path),
            'mime' => Storage::disk(self::disk())->mimeType($person->photo_path) ?: 'image/jpeg',
        ];
    }

    /** The same disk avatars use — one bucket for likenesses. */
    private static function disk(): string
    {
        return config('filesystems.avatar_disk', 'public');
    }

    private static function extension(string $binary): string
    {
        return match (@getimagesizefromstring($binary)[2] ?? null) {
            IMAGETYPE_PNG => 'png',
            IMAGETYPE_WEBP => 'webp',
            default => 'jpg',
        };
    }
}
