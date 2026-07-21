<?php

namespace App\Support\Messaging;

use App\Models\MessageAttachment;
use App\Support\Files\Vault;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

/**
 * Makes a small preview image for an uploaded picture.
 *
 * GD rather than a new dependency: it is already loaded, and this needs one
 * downscale and one re-encode. Imagick is not installed on this environment,
 * and pulling in an image package for a single resize would be a lot of
 * surface for very little.
 *
 * A thumbnail is an optimisation, never a requirement: every failure path here
 * leaves `thumb_path` null and the bubble falls back to the full image, which
 * is exactly how attachments behaved before thumbnails existed.
 */
class Thumbnailer
{
    /** Longest edge of a generated thumbnail, in pixels. */
    public const MAX_EDGE = 640;

    /**
     * Images below this are already cheap to send as-is; generating a
     * near-identical copy would cost storage and gain nothing.
     */
    public const MIN_SOURCE_BYTES = 100 * 1024;

    /**
     * …but bytes are not the only cost. A very large image can compress to
     * almost nothing and still force every recipient's device to decode tens
     * of millions of pixels to fill a 320px bubble. Past this pixel count a
     * thumbnail is worth making regardless of file size.
     */
    public const MAX_SOURCE_PIXELS = 4_000_000;

    /** Formats GD can both read and write here. */
    private const SUPPORTED = [
        'image/jpeg' => 'jpeg',
        'image/png' => 'png',
        'image/webp' => 'webp',
        'image/gif' => 'gif',
    ];

    /**
     * Render thumbnail bytes from a file that is still on local disk.
     *
     * Split from writing because Vault::store() unlinks its source: the bytes
     * have to be produced *before* the original is stored, but they cannot be
     * saved until the attachment row they belong to exists.
     *
     * Returns null whenever a thumbnail isn't warranted or can't be made.
     */
    public static function renderFor(string $sourceAbsPath, string $mime, array $dimensions): ?string
    {
        if (! extension_loaded('gd') || ! isset(self::SUPPORTED[$mime]) || ! is_file($sourceAbsPath)) {
            return null;
        }

        $width = (int) ($dimensions['width'] ?? 0);
        $height = (int) ($dimensions['height'] ?? 0);

        // Nothing to gain on an image already smaller than the thumbnail.
        if (max($width, $height) <= self::MAX_EDGE) {
            return null;
        }

        // Worth doing if it is heavy to download *or* heavy to decode. A
        // 1600x1000 screenshot can be 10 KB; a 12-megapixel photo can compress
        // well and still stall a phone rendering it into a chat bubble.
        $heavyBytes = filesize($sourceAbsPath) >= self::MIN_SOURCE_BYTES;
        $heavyPixels = ($width * $height) > self::MAX_SOURCE_PIXELS;

        if (! $heavyBytes && ! $heavyPixels) {
            return null;
        }

        try {
            return self::render($sourceAbsPath, $mime);
        } catch (Throwable $e) {
            Log::warning('Message attachment thumbnail failed; using the full image.', [
                'reason' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /** Persist rendered bytes against an attachment, on the attachment's disk. */
    public static function attach(MessageAttachment $attachment, ?string $bytes): void
    {
        if ($bytes === null || $bytes === '') {
            return;
        }

        try {
            // Derived files sit beside the originals on the same disk, so a
            // disk switch keeps the pair together.
            $path = 'messaging/thumbs/'.date('Y/m').'/'.Str::uuid()->toString().'.jpg';

            if (Storage::disk($attachment->disk)->put($path, $bytes)) {
                $attachment->forceFill(['thumb_path' => $path])->save();
            }
        } catch (Throwable $e) {
            // A thumbnail is a nicety; the full image still serves.
            Log::warning('Message attachment thumbnail could not be stored.', [
                'attachment' => $attachment->uuid,
                'reason' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Downscale to MAX_EDGE on the longest side and re-encode as JPEG.
     *
     * JPEG regardless of the source format: a thumbnail has no need of
     * transparency or animation, and one output format keeps the serving route
     * simple. Returns raw bytes, or null if GD could not read the image.
     */
    private static function render(string $source, string $mime): ?string
    {
        $reader = match (self::SUPPORTED[$mime] ?? null) {
            'jpeg' => 'imagecreatefromjpeg',
            'png' => 'imagecreatefrompng',
            'webp' => 'imagecreatefromwebp',
            'gif' => 'imagecreatefromgif',
            default => null,
        };

        if ($reader === null || ! function_exists($reader)) {
            return null;
        }

        // A corrupt or truncated image makes GD emit warnings and return
        // false rather than throwing; suppress and check the result.
        $image = @$reader($source);

        if ($image === false) {
            return null;
        }

        $width = imagesx($image);
        $height = imagesy($image);

        if ($width < 1 || $height < 1) {
            return null;
        }

        $scale = self::MAX_EDGE / max($width, $height);
        $targetW = max(1, (int) round($width * $scale));
        $targetH = max(1, (int) round($height * $scale));

        $canvas = imagecreatetruecolor($targetW, $targetH);

        // Flatten onto white: the output is JPEG, and an unflattened
        // transparent PNG would otherwise come out with black edges.
        $white = imagecolorallocate($canvas, 255, 255, 255);
        imagefilledrectangle($canvas, 0, 0, $targetW, $targetH, $white);

        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetW, $targetH, $width, $height);

        ob_start();
        imagejpeg($canvas, null, 82);
        $bytes = ob_get_clean();

        // GdImage objects free themselves when they go out of scope
        // (imagedestroy is deprecated in PHP 8.5 and has had no effect since
        // 8.0), so they are not released explicitly — same as finfo elsewhere.
        return $bytes ?: null;
    }

    /**
     * Remove staged attachments nobody ever sent, and their bytes.
     *
     * An upload that is chosen and then abandoned - the tab is closed, the
     * message never sent - leaves a row with no message. Without this they
     * accumulate silently in storage.
     *
     * Returns the number removed.
     */
    public static function pruneStaged(int $olderThanHours = 24, ?int $uploaderId = null): int
    {
        $query = MessageAttachment::query()
            ->whereNull('message_id')
            ->where('status', MessageAttachment::STATUS_STAGED)
            ->where('created_at', '<', now()->subHours($olderThanHours));

        // Scoped to one uploader for the cheap opportunistic prune on upload.
        if ($uploaderId !== null) {
            $query->where('uploaded_by', $uploaderId);
        }

        $removed = 0;

        // Chunked: a long-abandoned backlog should not be pulled into memory
        // all at once.
        $query->orderBy('id')->chunkById(100, function ($attachments) use (&$removed) {
            foreach ($attachments as $attachment) {
                try {
                    $disk = Storage::disk($attachment->disk ?: Vault::diskName());
                    $disk->delete($attachment->path);
                    if ($attachment->thumb_path) {
                        $disk->delete($attachment->thumb_path);
                    }
                } catch (Throwable $e) {
                    // Missing bytes are fine — the row still goes.
                    Log::info('Staged attachment bytes could not be deleted.', [
                        'attachment' => $attachment->uuid,
                        'reason' => $e->getMessage(),
                    ]);
                }

                $attachment->delete();
                $removed++;
            }
        });

        return $removed;
    }
}
