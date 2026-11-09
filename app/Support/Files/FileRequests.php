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
        5 * 1024 * 1024,
        10 * 1024 * 1024,
    ];

    /**
     * The most a stranger may send through a request link, whatever was asked
     * for. A request link is the one door an unauthenticated visitor can push
     * bytes through, and every byte is scanned before it lands; a small cap
     * keeps that door narrow. It is deliberately far below FileType::MAX_BYTES,
     * which governs uploads from people who have already signed in.
     */
    public const MAX_BYTES_CEILING = 10 * 1024 * 1024;

    /**
     * Named bundles the modal used to offer in place of extensions.
     *
     * It now ticks one extension per chip, so nothing new arrives under these
     * keys. They stay because links issued while the chips were bundles stored
     * "documents", and narrowing the list would quietly change what an already
     * sent link accepts. New restrictions belong on the chip list, not here.
     */
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

    /** Cap the per-file size at what a request link is allowed to accept. */
    public static function normalizeMaxBytes(mixed $bytes): ?int
    {
        $n = (int) $bytes;

        if ($n <= 0) {
            return null;
        }

        return min($n, self::MAX_BYTES_CEILING);
    }

    /**
     * The effective per-file ceiling, whether or not one was chosen.
     *
     * An older request created before the ceiling dropped may still carry a
     * larger max_bytes, so the min() is applied on read as well as on write.
     */
    public static function maxBytes(FileRequest $request): int
    {
        return $request->max_bytes
            ? min((int) $request->max_bytes, self::MAX_BYTES_CEILING)
            : self::MAX_BYTES_CEILING;
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
    /**
     * How far a request has got, for the requester's own list (Workflows →
     * Requested Files): each document asked for and whether it arrived, or
     * for a folder request the files that came in, with where each was
     * filed so the row can open it.
     *
     * @return array{status: string, statusLabel: string, received: int, total: ?int, items: list<array<string, mixed>>}
     */
    public static function progress(FileRequest $request): array
    {
        $listed = \App\Support\Cip\DocumentRequests::listFor($request);
        $files = \App\Models\FileItem::query()
            ->with('folder:id,uuid')
            ->whereIn('id', $listed->isNotEmpty()
                ? $listed->pluck('fileId')->filter()->all()
                : $request->uploads()->latest('id')->limit(10)->pluck('file_id')->filter()->all())
            ->get()
            ->keyBy('id');
        $fileRef = fn (?int $id) => $id && $files->has($id) ? [
            'id' => $files[$id]->uuid,
            'name' => $files[$id]->name,
            'folderId' => $files[$id]->folder?->uuid,
        ] : null;

        if ($listed->isNotEmpty()) {
            $items = $listed->map(fn (array $row) => [
                'label' => \App\Support\Cip\DocumentTypes::present((string) $row['slot']->label),
                'person' => $row['slot']->person ? \App\Models\CipPerson::upperName($row['slot']->person->fullName()) : null,
                'received' => $row['received'],
                'closed' => $row['closed'],
                'uploadedAt' => $row['uploadedAt'] ? \Illuminate\Support\Carbon::parse($row['uploadedAt'])->toIso8601String() : null,
                'file' => $fileRef($row['fileId']),
            ])->values()->all();
            $received = count(array_filter($items, fn ($i) => $i['received']));
            $total = count($items);
            $complete = $received >= $total;
        } else {
            $items = $request->uploads()->latest('id')->limit(10)->get()->map(fn ($upload) => [
                'label' => $upload->name,
                'person' => $upload->uploader_name ?: $upload->uploader_email,
                'received' => true,
                'closed' => false,
                'uploadedAt' => optional($upload->created_at)->toIso8601String(),
                'file' => $fileRef($upload->file_id ? (int) $upload->file_id : null),
            ])->values()->all();
            $received = (int) $request->upload_count;
            $total = $request->allow_multiple ? (int) $request->max_files : 1;
            $complete = $request->isFull();
        }

        [$status, $label] = match (true) {
            $complete => ['complete', 'Complete'],
            $request->closedReason() === 'expired' => ['expired', 'Expired'],
            $request->closedReason() !== null => ['closed', 'Closed'],
            $received > 0 => ['partial', 'In progress'],
            default => ['waiting', 'Waiting'],
        };

        return [
            'status' => $status,
            'statusLabel' => $label,
            'received' => $received,
            'total' => $total,
            'items' => $items,
            'sentTo' => self::sentTo($request),
        ];
    }

    /**
     * Everyone this request has been emailed to, read off its deliveries,
     * so a resend reaches the same people the first email did.
     *
     * @return list<string>
     */
    public static function sentTo(FileRequest $request): array
    {
        $emails = \App\Models\EmailDelivery::query()
            ->where('related_type', FileRequest::class)
            ->where('related_id', $request->id)
            ->orderBy('id')
            ->pluck('recipient')
            ->all();

        if ($request->recipient_email) {
            array_unshift($emails, $request->recipient_email);
        }

        $seen = [];
        $out = [];
        foreach ($emails as $email) {
            $key = mb_strtolower(trim((string) $email));
            if ($key === '' || isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = trim((string) $email);
        }

        return $out;
    }

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
