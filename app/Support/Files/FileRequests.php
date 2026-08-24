<?php

namespace App\Support\Files;

use App\Models\FileRequest;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * The rules behind a document request, in one place.
 *
 * A request link is the only part of the portal a stranger can write to, so
 * every rule about it, where the bytes may land, what may be sent, how big,
 * how many, for how long, is decided here and re-checked on every upload.
 * The public controller reads nothing from the visitor except the bytes and
 * (optionally) their name; the destination, the limits and the owner all come
 * from the record the requester created while signed in.
 *
 * Two limits are deliberately *not* configurable away:
 *
 *   - FileType::inspect still runs, so a renamed executable is refused even if
 *     the requester allowed "any file type";
 *   - FileType::MAX_BYTES still caps the size, so "no maximum" means the
 *     library's maximum, not unbounded.
 */
final class FileRequests
{
    /** Per-file ceiling offered in the modal, in bytes. */
    public const SIZE_CHOICES = [
        10 * 1024 * 1024,
        25 * 1024 * 1024,
        100 * 1024 * 1024,
        500 * 1024 * 1024,
    ];

    /** Named bundles the modal offers instead of making people type extensions. */
    public const TYPE_GROUPS = [
        'documents' => ['pdf', 'doc', 'docx', 'rtf', 'odt', 'txt', 'md'],
        'spreadsheets' => ['xls', 'xlsx', 'ods', 'csv'],
        'presentations' => ['ppt', 'pptx', 'odp'],
        'images' => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'avif'],
        'archives' => ['zip', 'rar', '7z', 'tar', 'gz'],
    ];

    /** Hard ceiling on files per link, whatever the requester asks for. */
    public const MAX_FILES_CEILING = 200;

    /** A long, unguessable link token. Same shape as a public share's. */
    public static function token(): string
    {
        return Str::random(48);
    }

    public static function url(FileRequest $request): string
    {
        return url('/r/'.$request->token);
    }

    /**
     * May this user see and manage the request?
     *
     * The person who created it, or an administrator. Deliberately not
     * "anyone who can upload to the destination": a request carries a live
     * write token, and handing the ability to re-issue or re-point it to
     * everyone with folder access is a wider door than folder access is.
     */
    public static function canManage(User $user, FileRequest $request): bool
    {
        return $request->created_by === $user->id || FileAccess::isAdmin($user);
    }

    /**
     * Normalise the extension list the modal sends.
     *
     * Accepts group keys ("documents") and bare extensions ("pdf", ".PDF")
     * alike, and returns null for "anything", an empty list would otherwise
     * read as "nothing is allowed" on the upload page.
     *
     * @param  array<int, string>|null  $input
     * @return array<int, string>|null
     */
    public static function normalizeExtensions(?array $input): ?array
    {
        if ($input === null) {
            return null;
        }

        $out = [];

        foreach ($input as $entry) {
            $key = strtolower(trim((string) $entry));
            if ($key === '') {
                continue;
            }

            if (isset(self::TYPE_GROUPS[$key])) {
                $out = array_merge($out, self::TYPE_GROUPS[$key]);

                continue;
            }

            $ext = ltrim($key, '.');
            // Same shape FileType::extensionOf produces, so the check at upload
            // time is comparing like with like.
            if (preg_match('/^[a-z0-9]{1,16}$/', $ext)) {
                $out[] = $ext;
            }
        }

        $out = array_values(array_unique($out));

        return $out === [] ? null : $out;
    }

    /** Cap the per-file size at something the library would accept anyway. */
    public static function normalizeMaxBytes(mixed $bytes): ?int
    {
        $n = (int) $bytes;

        if ($n <= 0) {
            return null;
        }

        return min($n, FileType::MAX_BYTES);
    }

    /** The effective per-file ceiling, whether or not one was chosen. */
    public static function maxBytes(FileRequest $request): int
    {
        return $request->max_bytes ? min((int) $request->max_bytes, FileType::MAX_BYTES) : FileType::MAX_BYTES;
    }

    public static function setPassword(FileRequest $request, ?string $password): void
    {
        if ($password === null) {
            return;
        }

        // An empty string is how the modal says "remove the password", a null
        // means "leave whatever is there alone".
        $request->password_hash = $password === '' ? null : Hash::make($password);
    }

    public static function verifyPassword(FileRequest $request, ?string $password): bool
    {
        if ($request->password_hash === null) {
            return true;
        }

        return $password !== null && $password !== '' && Hash::check($password, $request->password_hash);
    }

    /**
     * Is this filename acceptable to *this* request?
     *
     * Returns null when it is, or the sentence to show the visitor when it is
     * not. Content inspection happens separately and afterwards, this is the
     * requester's own list, not the safety check.
     */
    public static function rejectExtension(FileRequest $request, string $filename): ?string
    {
        $allowed = $request->allowed_extensions;

        if (! is_array($allowed) || $allowed === []) {
            return null;
        }

        $ext = FileType::extensionOf($filename);

        if ($ext !== '' && in_array($ext, $allowed, true)) {
            return null;
        }

        return 'Only '.self::describeExtensions($allowed).' can be uploaded here.';
    }

    /** "PDF, DOCX or PNG files", the allow-list as a sentence. */
    public static function describeExtensions(array $allowed): string
    {
        $labels = array_map(fn ($e) => strtoupper((string) $e), array_slice($allowed, 0, 8));
        $more = count($allowed) - count($labels);

        if ($more > 0) {
            return implode(', ', $labels).' and '.$more.' other file '.($more === 1 ? 'type' : 'types');
        }

        if (count($labels) === 1) {
            return $labels[0].' files';
        }

        $last = array_pop($labels);

        return implode(', ', $labels).' or '.$last.' files';
    }

    /**
     * Safe JSON for the portal side. Includes the link, because the person
     * asking is the person who needs to send it.
     */
    public static function present(FileRequest $request): array
    {
        $folder = $request->folder;

        return [
            'id' => $request->uuid,
            'title' => $request->title,
            'message' => $request->message,
            'link' => self::url($request),
            'destination' => [
                'id' => $folder?->uuid,
                'name' => $folder?->name ?? 'File Box',
                'isFileBox' => $folder === null,
            ],
            'client' => $request->client ? [
                'id' => $request->client->uid,
                'name' => $request->client->name,
            ] : null,
            'recipientEmail' => $request->recipient_email,
            'recipientName' => $request->recipient_name,
            'allowedExtensions' => $request->allowed_extensions,
            'maxBytes' => $request->max_bytes ? (int) $request->max_bytes : null,
            'maxFiles' => (int) $request->max_files,
            'allowMultiple' => (bool) $request->allow_multiple,
            'hasPassword' => $request->password_hash !== null,
            'expiresAt' => optional($request->expires_at)->toIso8601String(),
            'open' => $request->isOpen(),
            'closedReason' => $request->closedReason(),
            'uploadCount' => (int) $request->upload_count,
            'lastUploadAt' => optional($request->last_upload_at)->toIso8601String(),
            'createdAt' => optional($request->created_at)->toIso8601String(),
            'createdBy' => $request->creator?->name,
        ];
    }

    /**
     * The destination a signed-in user is allowed to point a request at.
     *
     * Resolved once, here, from the requester's own permissions. Nothing on
     * the public route ever chooses a folder, which is what keeps a leaked
     * link from becoming a way to write anywhere in the library.
     */
    public static function resolveDestination(User $user, ?string $folderUuid): ?Folder
    {
        if ($folderUuid === null || $folderUuid === '' || $folderUuid === 'filebox') {
            return null;
        }

        $folder = Folder::where('uuid', $folderUuid)->first();
        abort_unless($folder, 404, 'That folder no longer exists.');
        abort_unless(
            FileAccess::canUploadTo($user, $folder),
            403,
            'You can’t collect files into that folder.'
        );

        return $folder;
    }
}
