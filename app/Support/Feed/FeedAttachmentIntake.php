<?php

namespace App\Support\Feed;

use App\Models\FeedAttachment;
use App\Models\FeedChannel;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\FileValidationException;
use App\Support\Files\Vault;
use App\Support\Messaging\Thumbnailer;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Takes an uploaded file and stages it as a post or comment attachment (§18).
 *
 * Storage and validation are the File Library's, not a parallel set: the same
 * Vault (so the disk switch to R2 applies here too) and the same FileType
 * rules, which sniff the real MIME from the bytes rather than trusting the
 * filename and refuse executables and scripts outright.
 *
 * The Feed tightens the size ceiling the same way messaging does, and for the
 * same reason: a post attachment is not a document deposit, and everyone who
 * reads the channel will try to fetch it.
 */
final class FeedAttachmentIntake
{
    /** What the Feed would like to allow per file. */
    public const MAX_BYTES = 100 * 1024 * 1024;

    /** How many files may ride on one post. */
    public const MAX_PER_POST = 20;

    /** How many may ride on one comment. */
    public const MAX_PER_COMMENT = 5;

    /**
     * The largest upload this installation can genuinely accept.
     *
     * PHP rejects anything over `upload_max_filesize` before the application
     * sees a usable file, so that is a hard cap no application setting raises.
     * Advertising 100 MB while PHP allows 2 MB means a photo fails with a
     * confusing error, so the number shown is the one that will actually apply.
     */
    public static function effectiveMaxBytes(): int
    {
        $limits = [self::MAX_BYTES];

        foreach (['upload_max_filesize', 'post_max_size'] as $key) {
            $bytes = self::iniBytes((string) ini_get($key));
            if ($bytes > 0) {
                $limits[] = $bytes;
            }
        }

        return min($limits);
    }

    /** Turn a php.ini shorthand size ("2M", "512K", "1G") into bytes. */
    private static function iniBytes(string $value): int
    {
        $value = trim($value);

        if ($value === '') {
            return 0;
        }

        $unit = strtolower(substr($value, -1));
        $number = (int) $value;

        return match ($unit) {
            'g' => $number * 1024 * 1024 * 1024,
            'm' => $number * 1024 * 1024,
            'k' => $number * 1024,
            default => $number,
        };
    }

    /** Human-readable form of the effective limit, for messages and the UI. */
    public static function maxBytesLabel(): string
    {
        $bytes = self::effectiveMaxBytes();
        $mb = $bytes / (1024 * 1024);

        return $mb >= 1
            ? rtrim(rtrim(number_format($mb, 1, '.', ''), '0'), '.').' MB'
            : max(1, (int) round($bytes / 1024)).' KB';
    }

    /**
     * Validate and store one upload, returning a staged attachment row.
     *
     * @throws FileValidationException with a message meant for the user
     */
    public static function stage(UploadedFile $file, FeedChannel $channel, User $user): FeedAttachment
    {
        if (! $file->isValid()) {
            throw new FileValidationException('That file did not finish uploading. Try again.');
        }

        if ($file->getSize() > self::effectiveMaxBytes()) {
            throw new FileValidationException(
                'Attachments are limited to '.self::maxBytesLabel().'.'
            );
        }

        $originalName = self::safeName($file->getClientOriginalName());
        $absolute = $file->getRealPath();

        // Sniffs the bytes and throws on blocked extensions/MIME types.
        $inspected = FileType::inspect($absolute, $originalName);

        // Measure and render the thumbnail *before* storing: Vault::store()
        // unlinks the source once the bytes are written, so anything that needs
        // to read the original has to do it first.
        $dimensions = self::imageDimensions($absolute, $inspected['mime'] ?? '');
        $thumbBytes = Thumbnailer::renderFor($absolute, $inspected['mime'] ?? '', $dimensions);

        $stored = Vault::store($absolute, $inspected['extension'] ?? '');

        $attachment = FeedAttachment::create([
            'uuid' => (string) Str::uuid(),
            'post_id' => null,
            'comment_id' => null,
            'channel_id' => $channel->id,
            'uploaded_by' => $user->id,
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            'name' => $originalName,
            'mime' => $inspected['mime'] ?? $file->getMimeType(),
            'extension' => $inspected['extension'] ?? '',
            'size' => $stored['size'] ?? $file->getSize(),
            'width' => $dimensions['width'] ?? null,
            'height' => $dimensions['height'] ?? null,
            'status' => FeedAttachment::STATUS_STAGED,
        ]);

        self::attachThumbnail($attachment, $thumbBytes);
        self::pruneStaged($user);

        return $attachment;
    }

    /**
     * Claim staged files for a post or comment.
     *
     * Scoped to this channel *and* this uploader, so a uuid captured from
     * somewhere else cannot be attached here. Returns the rows claimed.
     *
     * @param  array<int, string>  $uuids
     * @return \Illuminate\Support\Collection<int, FeedAttachment>
     */
    public static function claim(array $uuids, FeedChannel $channel, User $user, array $owner): \Illuminate\Support\Collection
    {
        if ($uuids === []) {
            return collect();
        }

        $staged = FeedAttachment::query()
            ->where('channel_id', $channel->id)
            ->where('uploaded_by', $user->id)
            ->where('status', FeedAttachment::STATUS_STAGED)
            ->whereIn('uuid', $uuids)
            ->get();

        foreach ($staged as $attachment) {
            $attachment->forceFill(array_merge($owner, [
                'status' => FeedAttachment::STATUS_READY,
            ]))->save();
        }

        return $staged;
    }

    /** Write the rendered thumbnail next to the file it belongs to. */
    private static function attachThumbnail(FeedAttachment $attachment, ?string $bytes): void
    {
        if (! $bytes) {
            return;
        }

        try {
            $path = 'vault/thumbs/'.$attachment->uuid.'.jpg';
            Vault::disk()->put($path, $bytes);
            $attachment->forceFill(['thumb_path' => $path])->save();
        } catch (\Throwable) {
            // A missing thumbnail costs a placeholder, not the upload.
        }
    }

    /**
     * Opportunistic tidy-up of this uploader's own abandoned files.
     *
     * A staged attachment whose post was never saved is otherwise orphaned
     * bytes. The scheduled prune is the real mechanism; this keeps storage
     * from growing unbounded on an environment where the scheduler is not
     * running, which has been a recurring problem for this portal.
     */
    public static function pruneStaged(User $user, int $olderThanHours = 24): void
    {
        try {
            FeedAttachment::query()
                ->where('uploaded_by', $user->id)
                ->where('status', FeedAttachment::STATUS_STAGED)
                ->where('created_at', '<', Carbon::now()->subHours($olderThanHours))
                ->get()
                ->each(function (FeedAttachment $attachment) {
                    // Vault::delete() takes a FileItem; a Feed attachment
                    // stores its own disk and path, so the bytes are removed
                    // through the disk the row itself recorded.
                    Storage::disk($attachment->disk)->delete(array_filter([
                        $attachment->path,
                        $attachment->thumb_path,
                    ]));
                    $attachment->forceDelete();
                });
        } catch (\Throwable) {
            // Housekeeping must never fail the upload that triggered it.
        }
    }

    /**
     * Pixel dimensions for images, so a card reserves the right box before the
     * file loads and the stream doesn't jump while scrolling.
     *
     * Video and audio duration needs a media probe the portal doesn't have;
     * those stay null rather than being guessed at.
     */
    private static function imageDimensions(string $absolute, string $mime): array
    {
        if (! str_starts_with($mime, 'image/')) {
            return [];
        }

        $size = @getimagesize($absolute);

        if (! is_array($size) || ($size[0] ?? 0) <= 0) {
            return [];
        }

        return ['width' => (int) $size[0], 'height' => (int) $size[1]];
    }

    /**
     * Strip directory components and control characters from the client's
     * filename. It is shown to every reader and used as the download name, so
     * it must not be able to carry a path or terminal escapes.
     */
    private static function safeName(string $name): string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '';
        $name = trim($name);

        if ($name === '' || $name === '.' || $name === '..') {
            return 'attachment';
        }

        return Str::limit($name, 180, '');
    }
}
