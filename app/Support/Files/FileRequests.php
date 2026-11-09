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

    /** What a new request asks for unless told otherwise (item 8). */
    public const DEFAULT_MAX_FILES = 5;

    /** @var list<string> */
    public const DEFAULT_EXTENSIONS = ['pdf'];

    /** How often an outstanding request's recipient is reminded: days => words. */
    public const REMINDER_CHOICES = [
        0 => 'Never',
        1 => 'Every day',
        2 => 'Every 2 days',
        3 => 'Every 3 days',
        7 => 'Every week',
    ];

    /** No request is reminded more often than this, however long it stays open. */
    public const MAX_REMINDERS = 10;

    /**
     * The reminder frequency a new request gets.
     *
     * An administrator's choice stands. Anybody else may choose only while
     * the firm lets them (FileLibrarySetting::requestReminderChoosable);
     * otherwise every request uses the firm's frequency.
     */
    public static function reminderDaysFor(User $user, mixed $asked): int
    {
        $firm = \App\Models\FileLibrarySetting::requestReminderDays();

        if ($asked === null || $asked === '') {
            return $firm;
        }

        $asked = (int) $asked;
        if (! array_key_exists($asked, self::REMINDER_CHOICES)) {
            return $firm;
        }

        return FileAccess::isAdmin($user) || \App\Models\FileLibrarySetting::requestReminderChoosable()
            ? $asked
            : $firm;
    }

    /** The reminder choices and the firm's default, for the request form. */
    public static function reminderOptions(User $user): array
    {
        return [
            'days' => \App\Models\FileLibrarySetting::requestReminderDays(),
            'choosable' => FileAccess::isAdmin($user) || \App\Models\FileLibrarySetting::requestReminderChoosable(),
            'choices' => collect(self::REMINDER_CHOICES)
                ->map(fn (string $label, int $days) => ['value' => $days, 'label' => $label])
                ->values()
                ->all(),
        ];
    }

    /**
     * Is anything this request asked for still to come?
     *
     * A list of documents waits until each has arrived; a folder request
     * until something has been sent, then it has had its answer. A request
     * that is shut (expired, closed, withdrawn) is waiting on nobody.
     */
    public static function outstanding(FileRequest $request): bool
    {
        if (! $request->isOpen()) {
            return false;
        }

        $listed = \App\Support\Cip\DocumentRequests::listFor($request);
        if ($listed->isNotEmpty()) {
            return $listed->contains(fn (array $row) => ! $row['received'] && ! $row['closed']);
        }

        return (int) $request->upload_count === 0;
    }

    /**
     * Tell somebody with a portal account about a request, in the portal:
     * the bell, and a message in their Messages from the person who asked,
     * each with the link to the upload page. The email goes separately.
     */
    public static function notifyPortalUser(FileRequest $request, User $recipient, ?User $sender, bool $reminder = false): void
    {
        $url = self::url($request);
        $who = $sender?->name ?: 'The firm';

        \App\Support\Notifications\Notifier::send([
            'user' => $recipient->id,
            'actor' => $sender,
            'type' => $reminder ? 'files.request_reminder' : 'files.request_received',
            'title' => ($reminder ? 'Reminder: ' : '').$request->title,
            'message' => $reminder
                ? 'Still waiting for your upload. Requested by '.$who.'.'
                : 'Requested by '.$who.'.',
            'subject' => $request,
            'action_url' => '/r/'.$request->token,
            // The request email is the email.
            'email' => false,
        ]);

        if ($sender === null) {
            return;
        }

        $body = $reminder
            ? "Reminder: I'm still waiting for your upload for \"{$request->title}\".\n\nUpload here: {$url}"
            : "I've asked you to upload documents: \"{$request->title}\".".
                (trim((string) $request->message) !== '' ? "\n\n".trim((string) $request->message) : '').
                "\n\nUpload here: {$url}";

        self::message($sender, $recipient, $body);
    }

    /**
     * A direct message from one portal user to another, as if typed.
     *
     * The same path the welcome message takes: the thread is found or
     * opened, the message written, broadcast and announced (bell, no second
     * email). Never throws: two people who may not message each other, or
     * a messaging hiccup, leave the request and its email standing.
     */
    public static function message(User $sender, User $recipient, string $body): void
    {
        if ($sender->is($recipient) || ! $recipient->isApproved() || ! $sender->isApproved()) {
            return;
        }

        try {
            if (\App\Models\UserBlock::blockedBetween($sender->id, $recipient->id)) {
                return;
            }

            [$conversation, $message, $mentioned] = \Illuminate\Support\Facades\DB::transaction(function () use ($sender, $recipient, $body) {
                $conversation = \App\Support\Messaging\ClientConversations::resolveDirect($sender, $recipient);
                [$message, $mentioned] = \App\Support\Messaging\Posting::write($conversation, $sender, [
                    'type' => \App\Models\Message::TYPE_TEXT,
                    'body' => $body,
                ]);

                return [$conversation, $message, $mentioned];
            });

            $message->load(\App\Support\Messaging\Posting::RELATIONS);
            \App\Support\Messaging\Broadcaster::to(new \App\Events\MessageSent($message));
            \App\Support\Messaging\MessageNotifier::announceMessage($conversation, $message, $sender, $mentioned, email: false);
            \App\Support\Messaging\MessageNotifier::announceFirstCorrespondence($conversation, $message, $sender);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('A file request message could not be sent.', [
                'sender' => $sender->id,
                'recipient' => $recipient->id,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * The account an address belongs to, if it has one.
     */
    public static function portalUserFor(?string $email): ?User
    {
        $email = mb_strtolower(trim((string) $email));
        if ($email === '') {
            return null;
        }

        return User::query()
            ->whereRaw('LOWER(email) = ?', [$email])
            ->where('status', User::STATUS_APPROVED)
            ->first();
    }

    /**
     * Remind everyone a request went to that it is still waiting: the email
     * again, headed as a reminder, and for anyone with an account the bell
     * and a message from the person who asked.
     *
     * @return int  how many were emailed
     */
    public static function remind(FileRequest $request, ?User $sender = null): int
    {
        // The whole account (the relation is often loaded with id and name only).
        $sender ??= User::find($request->created_by);
        $emailed = 0;
        $listed = \App\Support\Cip\DocumentRequests::listFor($request);
        $details = [];
        if ($listed->isNotEmpty()) {
            $waiting = $listed
                ->filter(fn (array $row) => ! $row['received'] && ! $row['closed'])
                ->map(fn (array $row) => \App\Support\Cip\DocumentTypes::present((string) $row['slot']->label))
                ->values()
                ->all();
            if ($waiting !== []) {
                $details[] = ['Still needed', implode(', ', $waiting)];
            }
        }
        if ($request->expires_at) {
            $details[] = ['Upload by', $request->expires_at->format('j M Y')];
        }

        foreach (self::sentTo($request) as $email) {
            $delivery = \App\Support\Mail\Deliveries::send(
                \App\Support\Mail\Postcards::fileRequest(
                    'Reminder: '.$request->title,
                    $sender?->name ?: \App\Support\Mail\Postcards::site(),
                    $request->message,
                    self::url($request),
                    null,
                    $details,
                ),
                $email,
                $request,
                'fileRequestReminder',
                immediate: true,
            );
            if ($delivery === null || $delivery->status !== \App\Models\EmailDelivery::STATUS_FAILED) {
                $emailed++;
            }

            $user = self::portalUserFor($email);
            if ($user) {
                self::notifyPortalUser($request, $user, $sender, reminder: true);
            }
        }

        $request->forceFill([
            'reminded_at' => now(),
            'reminders_sent' => (int) $request->reminders_sent + 1,
        ])->save();

        return $emailed;
    }

    /**
     * Is a reminder due? Its frequency has passed since the last reminder,
     * or since it was sent, and the request is still waiting on somebody.
     */
    public static function reminderDue(FileRequest $request): bool
    {
        $days = (int) $request->reminder_every_days;
        if ($days <= 0 || (int) $request->reminders_sent >= self::MAX_REMINDERS) {
            return false;
        }

        $since = $request->reminded_at ?? $request->created_at;
        if ($since === null || $since->copy()->addDays($days)->isFuture()) {
            return false;
        }

        return self::sentTo($request) !== [] && self::outstanding($request);
    }

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
            // Still waiting on somebody: a reminder can be sent.
            'outstanding' => self::outstanding($request),
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
            'recipientUserId' => $request->recipient_user_id,
            'reminderEveryDays' => (int) $request->reminder_every_days,
            'reminderLabel' => self::REMINDER_CHOICES[(int) $request->reminder_every_days] ?? 'Never',
            'remindedAt' => optional($request->reminded_at)->toIso8601String(),
            'remindersSent' => (int) $request->reminders_sent,
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
