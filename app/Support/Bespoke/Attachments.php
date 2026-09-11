<?php

namespace App\Support\Bespoke;

use App\Models\BespokeAttachment;
use App\Models\BespokeConversation;
use App\Models\BespokeMessage;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\FileValidationException;
use App\Support\Files\Vault;
use App\Support\Security\Envelope;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * Files dropped into a Bespoke AI chat.
 *
 * The browser uploads each file as it is picked (a PDF arrives with the
 * text pdf.js read out of it, since nothing on the server reads PDFs);
 * the chat request then names up to five of them. Until that request lands
 * a row is staged, and staged rows older than a day are pruned. Bytes go
 * through the Vault like every other upload, so they are encrypted when
 * the library is, and they are served only to the reader who uploaded them.
 */
final class Attachments
{
    public const MAX_PER_MESSAGE = 5;

    public const MAX_BYTES = 10 * 1024 * 1024;

    /** What the model may be handed in one go. */
    public const MAX_TEXT_CHARS = 120000;

    /** Inline budget per chat turn; the rest is reachable via read_attachment. */
    public const INLINE_CHARS = 24000;

    public const KIND_UPLOAD = BespokeAttachment::KIND_UPLOAD;

    public const KIND_DERIVED = BespokeAttachment::KIND_DERIVED;

    private const ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'txt', 'md', 'csv'];

    private const TEXT_EXT = ['txt', 'md', 'csv'];

    /**
     * @param  array{text?: ?string, pages?: ?int, kind?: string}  $options
     */
    public static function stage(UploadedFile $file, BespokeConversation $conversation, User $user, array $options = []): BespokeAttachment
    {
        if (! $file->isValid()) {
            throw ValidationException::withMessages(['file' => 'That file did not finish uploading. Try again.']);
        }
        if ($file->getSize() > self::MAX_BYTES) {
            throw ValidationException::withMessages(['file' => 'Keep each file under 10 MB.']);
        }

        $name = self::safeName($file->getClientOriginalName());
        $absolute = $file->getRealPath();

        try {
            $inspected = FileType::inspect($absolute, $name);
        } catch (FileValidationException $e) {
            throw ValidationException::withMessages(['file' => $e->getMessage()]);
        }

        $extension = strtolower((string) ($inspected['extension'] ?? ''));
        $mime = (string) ($inspected['mime'] ?? $file->getMimeType());
        if (! in_array($extension, self::ALLOWED, true)) {
            throw ValidationException::withMessages(['file' => 'Attach a PDF, an image (JPG, PNG, WebP), or a text file.']);
        }
        if ($extension === 'pdf' && $mime !== 'application/pdf') {
            throw ValidationException::withMessages(['file' => 'That file is not a PDF.']);
        }

        $dimensions = null;
        if (str_starts_with($mime, 'image/')) {
            $info = @getimagesize($absolute);
            if (is_array($info) && $info[0] > 0 && $info[1] > 0) {
                $dimensions = ['width' => (int) $info[0], 'height' => (int) $info[1]];
            }
        }

        $text = null;
        if (in_array($extension, self::TEXT_EXT, true)) {
            $text = self::cleanText((string) @file_get_contents($absolute, false, null, 0, self::MAX_TEXT_CHARS * 2));
        } elseif ($extension === 'pdf') {
            $text = self::cleanText((string) ($options['text'] ?? ''));
        }

        try {
            $stored = Vault::store($absolute, $extension);
        } catch (FileValidationException $e) {
            throw ValidationException::withMessages(['file' => $e->getMessage()]);
        }

        $attachment = BespokeAttachment::create([
            'user_id' => $user->id,
            'conversation_id' => $conversation->id,
            'message_id' => null,
            'kind' => ($options['kind'] ?? '') === self::KIND_DERIVED ? self::KIND_DERIVED : self::KIND_UPLOAD,
            'name' => $name,
            'mime' => $mime,
            'extension' => $extension,
            'size' => $stored['size'] ?? $file->getSize(),
            'disk' => $stored['disk'],
            'path' => $stored['path'],
            'encrypted' => (bool) ($stored['encrypted'] ?? false),
            'checksum' => $stored['checksum'] ?? null,
            'width' => $dimensions['width'] ?? null,
            'height' => $dimensions['height'] ?? null,
            'pages' => $extension === 'pdf' && isset($options['pages']) ? max(0, (int) $options['pages']) : null,
            'text' => $text !== null && $text !== '' ? $text : null,
        ]);

        self::prune($user);

        return $attachment;
    }

    /**
     * The staged files this chat request names. Every uuid must be this
     * reader's, in this conversation, and not yet sent, or the request
     * is refused as a whole.
     *
     * @param  list<string>  $uuids
     * @return Collection<int, BespokeAttachment>
     */
    public static function claim(BespokeConversation $conversation, User $user, array $uuids): Collection
    {
        $uuids = array_values(array_unique(array_filter($uuids, 'is_string')));
        if ($uuids === []) {
            return collect();
        }
        if (count($uuids) > self::MAX_PER_MESSAGE) {
            throw ValidationException::withMessages(['attachments' => 'Up to five files per message.']);
        }

        $rows = BespokeAttachment::query()
            ->where('user_id', $user->id)
            ->where('conversation_id', $conversation->id)
            ->whereNull('message_id')
            ->whereIn('uuid', $uuids)
            ->get();

        if ($rows->count() !== count($uuids)) {
            throw ValidationException::withMessages(['attachments' => 'Some files are no longer available. Attach them again.']);
        }

        return $rows->sortBy(fn (BespokeAttachment $a) => array_search($a->uuid, $uuids, true))->values();
    }

    /** @param  Collection<int, BespokeAttachment>  $attachments */
    public static function attachTo(BespokeMessage $message, Collection $attachments): void
    {
        if ($attachments->isEmpty()) {
            return;
        }
        BespokeAttachment::query()
            ->whereIn('id', $attachments->pluck('id'))
            ->update(['message_id' => $message->id]);
    }

    public static function findOwned(User $user, string $uuid): ?BespokeAttachment
    {
        return BespokeAttachment::query()
            ->where('user_id', $user->id)
            ->where('uuid', $uuid)
            ->first();
    }

    public static function findOwnedOrFail(User $user, string $uuid): BespokeAttachment
    {
        $attachment = self::findOwned($user, $uuid);
        abort_unless($attachment !== null, 404);

        return $attachment;
    }

    /**
     * Every file in this conversation, newest last, for the prompt and for
     * read_attachment.
     *
     * @return Collection<int, BespokeAttachment>
     */
    public static function forConversation(BespokeConversation $conversation, User $user): Collection
    {
        return BespokeAttachment::query()
            ->where('user_id', $user->id)
            ->where('conversation_id', $conversation->id)
            ->orderBy('id')
            ->limit(40)
            ->get();
    }

    /** @return array<string, mixed> */
    public static function payload(BespokeAttachment $a): array
    {
        return [
            'id' => $a->uuid,
            'name' => $a->name,
            'mime' => $a->mime,
            'size' => (int) $a->size,
            'kind' => $a->kind,
            'isImage' => $a->isImage(),
            'isPdf' => $a->isPdf(),
            'pages' => $a->pages,
            'width' => $a->width,
            'height' => $a->height,
            'hasText' => $a->hasText(),
            'url' => '/portal/bespoke/attachments/'.$a->uuid,
        ];
    }

    /**
     * What rides with the question: each file's facts and, for text-bearing
     * files, as much of the text as the inline budget allows.
     *
     * @param  Collection<int, BespokeAttachment>  $attachments
     */
    public static function contextFor(Collection $attachments): string
    {
        $budget = self::INLINE_CHARS;
        $blocks = ['[Files attached to this message]'];
        foreach ($attachments as $i => $a) {
            $head = ($i + 1).'. '.$a->name.' — '.self::describe($a).' (id '.$a->uuid.')';
            if ($a->hasText()) {
                $share = (int) max(2000, $budget / max(1, $attachments->count() - $i));
                $excerpt = mb_substr((string) $a->text, 0, $share);
                $budget -= mb_strlen($excerpt);
                $more = mb_strlen((string) $a->text) > mb_strlen($excerpt)
                    ? "\n[… ".(mb_strlen((string) $a->text) - mb_strlen($excerpt)).' more characters; read_attachment with offset '.mb_strlen($excerpt).' continues]'
                    : '';
                $blocks[] = $head."\n---\n".$excerpt.$more."\n---";
            } elseif ($a->isPdf()) {
                $blocks[] = $head."\nNo text layer was found (a scanned PDF). Say so; do not guess its contents. If it holds a photo, resize_photo can make a 2×2 passport photo from page 1.";
            } elseif ($a->isImage()) {
                $blocks[] = $head."\nYou cannot see image contents. Do not describe them. You can offer resize_photo for a 2×2 passport photo.";
            } else {
                $blocks[] = $head;
            }
        }

        return implode("\n\n", $blocks);
    }

    public static function describe(BespokeAttachment $a): string
    {
        $parts = [];
        if ($a->isPdf()) {
            $parts[] = 'PDF';
            if ($a->pages) {
                $parts[] = $a->pages.' page'.($a->pages === 1 ? '' : 's');
            }
        } elseif ($a->isImage()) {
            $parts[] = 'image';
            if ($a->width && $a->height) {
                $parts[] = $a->width.'×'.$a->height;
            }
        } else {
            $parts[] = strtoupper($a->extension ?: 'file');
        }
        $parts[] = self::sizeLabel((int) $a->size);
        if ($a->kind === self::KIND_DERIVED) {
            $parts[] = 'made by the portal';
        }

        return implode(', ', $parts);
    }

    public static function stream(BespokeAttachment $a, bool $download = false): Response
    {
        $disk = Storage::disk($a->disk);
        abort_unless($disk->exists($a->path), 404);

        $disposition = $download || ! ($a->isImage() || $a->isPdf()) ? 'attachment' : 'inline';
        $name = str_replace('"', '', $a->name);
        $headers = [
            'Content-Type' => $a->mime ?: 'application/octet-stream',
            'Content-Disposition' => $disposition.'; filename="'.$name.'"',
            'Cache-Control' => 'private, max-age=3600',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($a->encrypted) {
            $plain = Envelope::materializeDisk($disk, $a->path);
            abort_unless($plain !== null, 404);

            return response()->file($plain, $headers)->deleteFileAfterSend(true);
        }

        return response()->stream(function () use ($disk, $a) {
            $handle = $disk->readStream($a->path);
            if ($handle === false || $handle === null) {
                return;
            }
            fpassthru($handle);
            fclose($handle);
        }, 200, $headers + ['Content-Length' => (string) $disk->size($a->path)]);
    }

    /** Uploaded, never sent, and a day old: gone, bytes included. */
    public static function prune(User $user, int $olderThanHours = 24): int
    {
        $stale = BespokeAttachment::query()
            ->where('user_id', $user->id)
            ->whereNull('message_id')
            ->where('created_at', '<', now()->subHours($olderThanHours))
            ->get();

        foreach ($stale as $a) {
            self::delete($a);
        }

        return $stale->count();
    }

    public static function delete(BespokeAttachment $a): void
    {
        try {
            Storage::disk($a->disk)->delete($a->path);
        } catch (\Throwable) {
            // The row goes regardless; an orphaned blob is cheaper than a dangling row.
        }
        $a->delete();
    }

    public static function sizeLabel(int $bytes): string
    {
        if ($bytes >= 1024 * 1024) {
            return round($bytes / (1024 * 1024), 1).' MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024).' KB';
        }

        return $bytes.' B';
    }

    private static function safeName(string $name): string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[\x00-\x1F\x7F]+/u', '', $name) ?? $name;
        $name = trim($name);
        if ($name === '' || $name === '.' || $name === '..') {
            $name = 'file';
        }

        return Str::limit($name, 180, '');
    }

    private static function cleanText(string $text): string
    {
        if ($text === '') {
            return '';
        }
        if (! mb_check_encoding($text, 'UTF-8')) {
            $text = mb_convert_encoding($text, 'UTF-8', 'UTF-8');
        }
        $text = str_replace("\0", '', $text);
        $text = preg_replace('/[ \t]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\n{3,}/u', "\n\n", $text) ?? $text;

        return mb_substr(trim($text), 0, self::MAX_TEXT_CHARS);
    }
}
