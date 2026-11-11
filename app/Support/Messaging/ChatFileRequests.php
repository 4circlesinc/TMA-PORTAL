<?php

namespace App\Support\Messaging;

use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\Conversation;
use App\Models\FileRequest;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\DocumentRequests;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Threads;
use App\Support\Files\FileRequests;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * "/" then Request files, in any chat.
 *
 * The request itself is the one the portal already makes: an application's
 * checklist documents through {@see DocumentRequests::forMany()} (each file
 * renamed to its document and filed in its own slot), or files for a folder
 * like a library file request. What is new is where it lives: a message of
 * type file_request, whose bubble lists what was asked for with an upload
 * button for each, and follows the request as files arrive.
 *
 * Two rules decide what may be asked and of whom:
 *
 *  - Only staff and a service provider's contacts ask, the same people who
 *    may request documents from an application today.
 *  - An application is only offered when every person in the chat may see
 *    it. The card names the file to all of them, so a request must never
 *    show an application to somebody who cannot open it. A chat that is
 *    already about an application (the case group) asks about that one.
 */
class ChatFileRequests
{
    /** How long a chat request stays open, as the Request documents dialog. */
    public const EXPIRES_DAYS = 14;

    public const APPLICATION_LIMIT = 30;

    /** May this person ask for files in a chat? */
    public static function canRequest(?User $user): bool
    {
        if ($user === null) {
            return false;
        }

        return Role::isStaff($user) || CipAccess::isProviderContact($user);
    }

    /**
     * The application a case chat is about, when everyone in it can see it.
     */
    public static function fixedApplication(Conversation $conversation, User $requester): ?CipApplication
    {
        $application = $conversation->caseApplication();

        if ($application === null) {
            return null;
        }

        return self::visibleToEveryone($conversation, $requester)->whereKey($application->id)->first();
    }

    /**
     * Applications the asker and every other person in the chat may see.
     *
     * @return Collection<int, CipApplication>
     */
    public static function applications(Conversation $conversation, User $requester, ?string $term = null): Collection
    {
        $query = self::visibleToEveryone($conversation, $requester)
            ->with(['client:id,name', 'provider:id,name']);

        $term = trim((string) $term);
        if ($term !== '') {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $term).'%';
            $query->where(function (Builder $q) use ($like) {
                $q->where('cip_applications.cip_number', 'like', $like)
                    ->orWhere('cip_applications.internal_number', 'like', $like)
                    ->orWhereHas('client', fn (Builder $client) => $client->where('name', 'like', $like));
            });
        }

        return $query->latest('cip_applications.id')->limit(self::APPLICATION_LIMIT)->get();
    }

    /** @return array{id: string, number: string, name: ?string, provider: ?string, phase: ?string} */
    public static function presentApplication(CipApplication $application): array
    {
        $application->loadMissing(['client:id,name', 'provider:id,name']);

        return [
            'id' => $application->uuid,
            'number' => $application->displayNumber(),
            'name' => $application->client?->name ? CipPerson::upperName($application->client->name) : null,
            'provider' => $application->provider?->name,
            'phase' => $application->phase,
        ];
    }

    /**
     * Open the request and post it in the chat.
     *
     * @param  array{application?: ?string, documents?: list<string>, folder?: ?string, title?: ?string, message?: ?string, expiresAt?: ?string}  $data
     */
    public static function create(Conversation $conversation, User $requester, array $data): Message
    {
        if (! self::canRequest($requester)) {
            abort(403, 'Only staff and the service provider can request files.');
        }

        $conversation->loadMissing('activeParticipants.user');
        $recipient = $conversation->isGroup() ? null : self::audience($conversation, $requester)->first();
        $instructions = trim((string) ($data['message'] ?? '')) ?: null;
        $expiresAt = $data['expiresAt'] ?? now()->addDays(self::EXPIRES_DAYS)->toDateString();

        // A direct chat asks one person, who is reminded as any recipient is.
        $recipientFields = $recipient ? [
            'recipient_name' => $recipient->name,
            'recipient_email' => $recipient->email,
            'recipient_user_id' => $recipient->id,
            'reminder_every_days' => FileRequests::reminderDaysFor($requester, null),
        ] : [];

        $applicationUuid = trim((string) ($data['application'] ?? ''));

        $fileRequest = $applicationUuid !== ''
            ? self::documentRequest($conversation, $requester, $applicationUuid, $data['documents'] ?? [], $instructions, $expiresAt, $recipientFields)
            : self::folderRequest($requester, $data, $instructions, $expiresAt, $recipientFields);

        $case = $conversation->isProviderCase();

        [$message, $mentioned] = Posting::write($conversation, $requester, [
            'type' => Message::TYPE_FILE_REQUEST,
            'body' => self::summary($fileRequest),
            'file_request_id' => $fileRequest->id,
            // The service provider is who is usually asked in a case group.
            'lane' => $case ? Message::LANE_PROVIDER : null,
        ]);

        // Filed on the application's own Messages tab too, as every line of
        // the case group is.
        if ($case) {
            Threads::recordFromChat($conversation, $message, $requester, CipApplicationMessage::LANE_PROVIDER);
        }

        $message->load(array_merge(Posting::RELATIONS, ['fileRequest']));

        Broadcaster::toOthers(new MessageSent($message));
        MessageNotifier::announceMessage($conversation, $message, $requester, $mentioned);
        MessageNotifier::announceFirstCorrespondence($conversation, $message, $requester);

        return $message;
    }

    /**
     * What the bubble draws. The same for everyone in the chat: who may
     * upload is worked out on the page (anyone but the person who asked).
     *
     * @return array<string, mixed>
     */
    public static function present(FileRequest $request): array
    {
        $rows = DocumentRequests::listFor($request);
        $application = null;

        if ($rows->isNotEmpty()) {
            $first = $rows->first()['slot'];
            $first->loadMissing('application');
            $application = $first->application;
        }

        $request->loadMissing('folder:id,uuid,name');
        $open = $request->isOpen() && ! $request->isFull();

        return [
            'id' => $request->uuid,
            'kind' => $rows->isNotEmpty() ? 'documents' : 'folder',
            'title' => $request->title,
            'message' => self::instructions($request, $rows, $application),
            'application' => $application ? self::presentApplication($application) : null,
            'folder' => $rows->isEmpty() && $request->folder
                ? ['id' => $request->folder->uuid, 'name' => $request->folder->name]
                : null,
            'documents' => $rows->map(fn (array $row) => [
                'id' => $row['slot']->uuid,
                'label' => DocumentTypes::present((string) $row['slot']->label),
                'person' => $row['slot']->person ? CipPerson::upperName($row['slot']->person->fullName()) : null,
                'received' => (bool) $row['received'],
                'closed' => (bool) ($row['closed'] ?? false),
            ])->values()->all(),
            'received' => (int) $request->upload_count,
            'maxFiles' => (int) $request->max_files,
            'open' => $open,
            'closedReason' => $request->isOpen() ? ($request->isFull() ? 'complete' : null) : $request->closedReason(),
            'expiresAt' => $request->expires_at?->toIso8601String(),
            'requestedBy' => (int) $request->created_by,
        ];
    }

    /**
     * Something arrived (here or through the emailed link): every chat
     * showing the request redraws it.
     */
    public static function changed(FileRequest $request): void
    {
        try {
            Message::query()
                ->where('file_request_id', $request->id)
                ->with(['conversation', 'mentions', 'fileRequest'])
                ->get()
                ->each(fn (Message $message) => Broadcaster::to(new MessageUpdated($message)));
        } catch (\Throwable $e) {
            // The upload stands; the card catches up on the next open.
            report($e);
        }
    }

    /**
     * The asker's own instructions, or nothing.
     *
     * A request opened before chats stored only what was typed carries
     * DocumentRequests' generated "Please upload X and Y for Z.", which only
     * repeats the list the card draws; that one is left off.
     *
     * @param  Collection<int, array{slot: CipDocument}>  $rows
     */
    private static function instructions(FileRequest $request, Collection $rows, ?CipApplication $application): ?string
    {
        $text = trim((string) $request->message);
        if ($text === '') {
            return null;
        }

        if ($rows->isNotEmpty() && $application) {
            $labels = $rows->map(fn (array $row) => DocumentTypes::present((string) $row['slot']->label))->all();
            $last = count($labels) > 1 ? array_pop($labels) : null;
            $listed = $last === null ? ($labels[0] ?? 'the documents') : implode(', ', $labels).' and '.$last;
            $application->loadMissing('client');
            $who = $application->client?->name ?: $application->displayNumber();

            if ($text === 'Please upload '.$listed.' for '.$who.'.') {
                return null;
            }
        }

        return $text;
    }

    /** One line for the inbox preview, notifications and search. */
    public static function summary(FileRequest $request): string
    {
        $rows = DocumentRequests::listFor($request);

        if ($rows->isEmpty()) {
            return 'Requested files: '.$request->title;
        }

        $labels = $rows->map(fn (array $row) => DocumentTypes::present((string) $row['slot']->label))->all();
        $first = $rows->first()['slot'];
        $first->loadMissing('application.client');
        $who = $first->application?->client?->name
            ? CipPerson::upperName($first->application->client->name)
            : $first->application?->displayNumber();

        return Str::limit('Requested files: '.implode(', ', $labels).($who ? ' for '.$who : ''), 500);
    }

    /**
     * @param  list<string>  $documents
     * @param  array<string, mixed>  $recipientFields
     */
    private static function documentRequest(
        Conversation $conversation,
        User $requester,
        string $applicationUuid,
        array $documents,
        ?string $instructions,
        string $expiresAt,
        array $recipientFields,
    ): FileRequest {
        $application = self::visibleToEveryone($conversation, $requester)
            ->where('cip_applications.uuid', $applicationUuid)
            ->first();

        if ($application === null) {
            throw ValidationException::withMessages([
                'application' => 'Not everyone in this chat can see that application.',
            ]);
        }

        $documents = array_values(array_unique(array_filter(array_map('strval', $documents))));
        if ($documents === []) {
            throw ValidationException::withMessages(['documents' => 'Choose at least one document to ask for.']);
        }

        $slots = CipDocument::query()
            ->where('application_id', $application->id)
            ->whereIn('uuid', $documents)
            ->get();

        if ($slots->count() !== count($documents)) {
            throw ValidationException::withMessages(['documents' => 'Some of those documents are not on this application.']);
        }

        // In the order they were ticked, which is the checklist's order: the
        // card lists them as the asker saw them.
        $slots = $slots->sortBy(fn (CipDocument $slot) => array_search($slot->uuid, $documents, true))->values();

        return DocumentRequests::forMany($application, $slots, $requester, array_filter(array_merge([
            // Only what the asker typed. The card already lists the
            // documents; forMany's own "Please upload X and Y for Z." would
            // say it all again underneath.
            'message' => $instructions ?? '',
            'expires_at' => $expiresAt,
        ], $recipientFields), fn ($value) => $value !== null));
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $recipientFields
     */
    private static function folderRequest(User $requester, array $data, ?string $instructions, string $expiresAt, array $recipientFields): FileRequest
    {
        $folderUuid = trim((string) ($data['folder'] ?? ''));
        if ($folderUuid === '') {
            throw ValidationException::withMessages(['folder' => 'Choose the folder the files should go in.']);
        }

        // The asker must be able to put files there themselves.
        $folder = FileRequests::resolveDestination($requester, $folderUuid);
        if ($folder === null) {
            throw ValidationException::withMessages(['folder' => 'Choose the folder the files should go in.']);
        }

        $title = trim((string) ($data['title'] ?? '')) ?: 'Files for '.$folder->name;

        return DB::transaction(function () use ($requester, $folder, $title, $instructions, $expiresAt, $recipientFields) {
            $request = new FileRequest(array_merge([
                'uuid' => (string) Str::uuid(),
                'token' => FileRequests::token(),
                'title' => Str::limit($title, 150, ''),
                'message' => $instructions,
                'folder_id' => $folder->id,
                'created_by' => $requester->id,
                // Any file the library itself would take; the bytes are
                // inspected on arrival as every upload's are.
                'allowed_extensions' => null,
                'max_files' => FileRequests::DEFAULT_MAX_FILES,
                'allow_multiple' => true,
                'expires_at' => $expiresAt,
            ], $recipientFields));
            $request->save();

            return $request;
        });
    }

    /** Everyone else in the chat: the people who will see the request. */
    private static function audience(Conversation $conversation, User $requester): Collection
    {
        $conversation->loadMissing('activeParticipants.user');

        return $conversation->activeParticipants
            ->map(fn ($participant) => $participant->user)
            ->filter(fn (?User $user) => $user !== null && (int) $user->id !== (int) $requester->id)
            ->values();
    }

    /** Applications the asker and everyone else in the chat may all see. */
    private static function visibleToEveryone(Conversation $conversation, User $requester): Builder
    {
        $query = ApplicationScope::query($requester);

        foreach (self::audience($conversation, $requester) as $user) {
            $query = ApplicationScope::query($user, $query);
        }

        return $query;
    }
}
