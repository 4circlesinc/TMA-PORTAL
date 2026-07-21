<?php

namespace App\Support\Messaging;

use App\Models\Conversation;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\FileValidationException;
use App\Support\Files\Vault;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/**
 * Takes an uploaded file and stages it as a message attachment.
 *
 * Storage and validation are the File Library's, not a parallel set: the same
 * Vault (so the disk switch to R2 applies here too) and the same FileType
 * rules, which sniff the real MIME from the bytes rather than trusting the
 * filename and refuse the executable/script types outright.
 *
 * Messaging tightens one thing: a much smaller size ceiling than the library's
 * 2 GB. A chat attachment is not a document deposit, and every recipient's
 * client will try to fetch it.
 */
class AttachmentIntake
{
    /**
     * What messaging would *like* to allow per file.
     *
     * The real ceiling is whichever is smaller: this, or what PHP itself will
     * accept — see effectiveMaxBytes(). Advertising 100 MB while
     * `upload_max_filesize` is 2 MB means a 5 MB photo fails with a confusing
     * error, so the limit shown to the user is always the one that will
     * actually apply.
     */
    public const MAX_BYTES = 100 * 1024 * 1024;

    /** How many files may ride on one message. */
    public const MAX_PER_MESSAGE = 10;

    /**
     * The largest upload this installation can genuinely accept.
     *
     * PHP rejects anything over `upload_max_filesize` (and a whole request over
     * `post_max_size`) before the application sees a usable file at all, so
     * those are hard caps no application setting can raise.
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
    public static function stage(UploadedFile $file, Conversation $conversation, User $user): MessageAttachment
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

        // Measure *before* storing: Vault::store() unlinks the source once the
        // bytes are written, so anything that needs to read the original file
        // has to do it first.
        $dimensions = self::imageDimensions($absolute, $inspected['mime'] ?? '');

        // Render the thumbnail from the original too, for the same reason —
        // once Vault::store() runs, the source is gone. Held in memory rather
        // than written yet, because the row it belongs to does not exist.
        $thumbBytes = Thumbnailer::renderFor($absolute, $inspected['mime'] ?? '', $dimensions);

        $stored = Vault::store($absolute, $inspected['extension'] ?? '');

        $attachment = MessageAttachment::create([
            'uuid' => (string) Str::uuid(),
            'message_id' => null,
            'conversation_id' => $conversation->id,
            'uploaded_by' => $user->id,
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            'name' => $originalName,
            'mime' => $inspected['mime'] ?? $file->getMimeType(),
            'extension' => $inspected['extension'] ?? '',
            'status' => MessageAttachment::STATUS_STAGED,
            'size' => $stored['size'] ?? $file->getSize(),
            'width' => $dimensions['width'] ?? null,
            'height' => $dimensions['height'] ?? null,
        ]);

        Thumbnailer::attach($attachment, $thumbBytes);

        // Opportunistic tidy-up of this uploader's own abandoned files.
        // The scheduled prune is the real mechanism; this keeps storage from
        // growing unbounded on an environment where the scheduler is not
        // running, which has been a recurring problem for this portal.
        Thumbnailer::pruneStaged(24, $user->id);

        return $attachment;
    }

    /**
     * Pixel dimensions for images, so the bubble can reserve the right box
     * before the file loads and the thread doesn't jump while scrolling.
     *
     * Video and audio duration needs a media probe the portal doesn't have;
     * those stay null rather than being guessed at.
     */
    private static function imageDimensions(string $absolute, string $mime): array
    {
        if (! str_starts_with($mime, 'image/')) {
            return [];
        }

        // getimagesize returns false for a non-image or a corrupt one rather
        // than throwing, which is exactly the behaviour wanted here.
        $size = @getimagesize($absolute);

        if (! is_array($size) || ($size[0] ?? 0) <= 0) {
            return [];
        }

        return ['width' => (int) $size[0], 'height' => (int) $size[1]];
    }

    /**
     * Strip directory components and control characters from the client's
     * filename. It is shown to every participant and used as the download
     * name, so it must not be able to carry a path or terminal escapes.
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
