<?php

namespace App\Support\Cip;

use App\Events\CipThreadChanged;
use App\Models\CipApplication;
use App\Models\CipApplicationMessage;
use App\Models\CipApplicationMessageRead;
use App\Models\CipApplicationMessageReceipt;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\ContactIdentity;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Messaging\ClientConversations;
use App\Support\Notifications\Notifier;
use App\Support\Realtime\Live;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The application messaging centre (section 24).
 *
 * One thread per file, two lanes on the row. Internal notes are filtered
 * out of every read the provider side makes. Provider messages replace the
 * email side-channel: one postcard per other-side mailbox, a bell for portal
 * accounts, and a realtime signal that never carries the body.
 */
class Threads
{
    public const MAX_LENGTH = 4000;

    /** How long the author may correct a message after they sent it. */
    public const EDIT_WINDOW_MINUTES = 15;

    public const PROVIDER_LABEL = 'Service provider';

    public static function canPostInternal(?User $user): bool
    {
        return $user !== null && Role::isStaff($user);
    }

    /**
     * @return list<string>
     */
    public static function lanesFor(?User $user): array
    {
        return self::canPostInternal($user)
            ? [CipApplicationMessage::LANE_INTERNAL, CipApplicationMessage::LANE_PROVIDER]
            : [CipApplicationMessage::LANE_PROVIDER];
    }

    public static function create(CipApplication $application, User $author, string $body, string $lane, ?string $replyTo = null): CipApplicationMessage
    {
        $body = trim($body);
        $lane = self::normaliseLane($lane, $author);

        if ($body === '') {
            throw ValidationException::withMessages([
                'body' => 'A message can’t be empty.',
            ]);
        }

        if ($lane === CipApplicationMessage::LANE_INTERNAL && ! self::canPostInternal($author)) {
            throw ValidationException::withMessages([
                'lane' => 'Internal notes are staff only.',
            ]);
        }

        $parent = self::resolveReply($application, $author, $replyTo, $lane);

        $application->loadMissing('provider');
        $stamp = ContactIdentity::stamp($author, $application->provider?->company_id);

        $message = CipApplicationMessage::create([
            'application_id' => $application->id,
            'author_id' => $author->id,
            'company_member_id' => $stamp['company_member_id'],
            'author_name' => $stamp['actor_name'] ?: $author->name,
            'lane' => $lane,
            'reply_to_id' => $parent?->id,
            'body' => $body,
        ]);

        self::markRead($application, $author, $message->id);
        self::announce($application, $message, $author);
        self::mirrorToCaseChat($message);
        CipThreadChanged::dispatch($application, 'created');
        Live::staff(Live::CIP);
        Live::users(Live::CIP, self::recipientUserIds($application, $message, $author));

        return $message;
    }

    /**
     * An internal note was the wrong lane.
     *
     * The row stays — same author, same words — and becomes a service-provider
     * message. That is the moment the provider side is told: the same postcard
     * and bell a message written on that lane would have sent. Sending it
     * again is refused, so a second click cannot mail them twice.
     */
    public static function shareWithProvider(CipApplication $application, CipApplicationMessage $message, User $actor): CipApplicationMessage
    {
        if (! self::canPostInternal($actor)) {
            abort(404);
        }

        if ((int) $message->application_id !== (int) $application->id) {
            abort(404);
        }

        if ($message->lane !== CipApplicationMessage::LANE_INTERNAL) {
            throw ValidationException::withMessages([
                'lane' => 'This message is already with the service provider.',
            ]);
        }

        $message->forceFill(['lane' => CipApplicationMessage::LANE_PROVIDER])->save();

        $author = $message->author ?? $actor;
        self::announce($application, $message, $author);
        self::mirrorToCaseChat($message);
        CipThreadChanged::dispatch($application, 'shared');
        Live::staff(Live::CIP);
        Live::users(Live::CIP, self::recipientUserIds($application, $message, $author));

        return $message;
    }

    /**
     * File a message the portal is already sending by another route.
     *
     * The covering note on a status dialog — "the Unit wants the spouse's
     * police certificate" — goes out inside that status change's own section 22
     * letter. It is also the firm talking to the provider side about this
     * file, which is exactly what the thread is for, and a reader who opens
     * Messages a week later should find it there rather than only in their
     * mailbox.
     *
     * So the row is written and the announcement is NOT: create() emails
     * every provider mailbox and rings every bell, and doing that here would
     * mean two emails and two notifications for one action. The status
     * notice has already said it.
     *
     * Returns null when there is nothing to file, so callers can hand this
     * an optional field without guarding first.
     */
    public static function record(
        CipApplication $application,
        User $author,
        ?string $body,
        string $lane = CipApplicationMessage::LANE_PROVIDER,
    ): ?CipApplicationMessage {
        $body = trim((string) $body);

        if ($body === '') {
            return null;
        }

        $application->loadMissing('provider');
        $stamp = ContactIdentity::stamp($author, $application->provider?->company_id);

        $message = CipApplicationMessage::create([
            'application_id' => $application->id,
            'author_id' => $author->id,
            'company_member_id' => $stamp['company_member_id'],
            'author_name' => $stamp['actor_name'] ?: $author->name,
            'lane' => self::normaliseLane($lane, $author),
            'body' => $body,
        ]);

        // The author has plainly read what they just typed; without this the
        // thread would come back with an unread badge for its own writer.
        self::markRead($application, $author, $message->id);
        self::mirrorToCaseChat($message);

        // The signal, but not the letter: screens showing this thread should
        // repaint, and the status change's own notice is the email.
        CipThreadChanged::dispatch($application, 'created');
        Live::staff(Live::CIP);
        Live::users(Live::CIP, self::recipientUserIds($application, $message, $author));

        return $message;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listed(CipApplication $application, User $viewer): array
    {
        $lanes = self::lanesFor($viewer);

        $messages = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->whereIn('lane', $lanes)
            ->with(['author', 'companyMember', 'replyTo'])
            ->orderBy('id')
            ->get();

        $seen = self::seenByFor($messages, $viewer);

        return $messages
            ->map(fn (CipApplicationMessage $message) => self::present($message, $viewer, $seen[$message->id] ?? []))
            ->all();
    }

    public static function markRead(CipApplication $application, User $viewer, ?int $through = null): void
    {
        $through ??= (int) CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->whereIn('lane', self::lanesFor($viewer))
            ->max('id');

        if ($through < 1) {
            return;
        }

        $row = CipApplicationMessageRead::query()->firstOrNew([
            'user_id' => $viewer->id,
            'application_id' => $application->id,
        ]);

        $previous = (int) $row->last_read_id;
        $wrote = self::recordReceipts($application, $viewer, $row, $through);

        if ($previous >= $through) {
            return;
        }

        $row->forceFill(['last_read_id' => $through])->save();

        // The other side of the file is looking at the thread and needs the
        // new face. A caught-up reopen writes nothing, so it does not loop.
        if ($wrote) {
            CipThreadChanged::dispatch($application, 'read');
        }
    }

    /**
     * Unread application-thread messages, keyed by client id, for the table
     * envelope. Internal notes never count for an account that cannot see them.
     *
     * @param  list<int>  $clientIds
     * @return array<int, int>
     */
    public static function unreadByClient(User $viewer, array $clientIds): array
    {
        $clientIds = array_values(array_unique(array_filter($clientIds)));

        if ($clientIds === []) {
            return [];
        }

        $lanes = self::lanesFor($viewer);

        $rows = CipApplicationMessage::query()
            ->join('cip_applications', 'cip_applications.id', '=', 'cip_application_messages.application_id')
            ->leftJoin('cip_application_message_reads as reads', function ($join) use ($viewer) {
                $join->on('reads.application_id', '=', 'cip_application_messages.application_id')
                    ->where('reads.user_id', '=', $viewer->id);
            })
            ->whereIn('cip_applications.client_id', $clientIds)
            ->whereIn('cip_application_messages.lane', $lanes)
            ->where(function ($q) use ($viewer) {
                $q->whereNull('cip_application_messages.author_id')
                    ->orWhere('cip_application_messages.author_id', '!=', $viewer->id);
            })
            ->whereRaw('cip_application_messages.id > COALESCE(reads.last_read_id, 0)')
            ->groupBy('cip_applications.client_id')
            ->selectRaw('cip_applications.client_id as client_id, COUNT(*) as n')
            ->pluck('n', 'client_id');

        $out = [];

        foreach ($rows as $clientId => $n) {
            $out[(int) $clientId] = (int) $n;
        }

        return $out;
    }

    /**
     * The case group is the same conversation as the service-provider lane.
     * An internal note never crosses. If the group does not exist yet, the
     * next time someone opens Message copies whatever is already on the file.
     */
    private static function mirrorToCaseChat(CipApplicationMessage $message): void
    {
        ClientConversations::mirrorProviderMessage($message);
    }

    /**
     * The author corrects their own message, inside the edit window.
     *
     * The lane does not change, and nobody is mailed again. A copy already
     * sitting in the case chat is corrected with it.
     */
    public static function revise(CipApplication $application, CipApplicationMessage $message, User $editor, string $body): CipApplicationMessage
    {
        if ((int) $message->application_id !== (int) $application->id) {
            abort(404);
        }

        if ($message->isInternal() && ! self::canPostInternal($editor)) {
            abort(404);
        }

        if (! self::canEdit($message, $editor)) {
            abort(403, 'This message can no longer be edited.');
        }

        $body = trim($body);

        if ($body === '') {
            throw ValidationException::withMessages([
                'body' => 'A message can’t be empty.',
            ]);
        }

        if ($body === $message->body) {
            return $message;
        }

        $message->forceFill([
            'body' => $body,
            'edited_at' => now(),
        ])->save();

        ClientConversations::reflectFileEdit($message);
        CipThreadChanged::dispatch($application, 'edited');

        return $message;
    }

    public static function canEdit(CipApplicationMessage $message, User $viewer): bool
    {
        return (int) $message->author_id === (int) $viewer->id
            && $message->created_at !== null
            && $message->created_at->gt(now()->subMinutes(self::EDIT_WINDOW_MINUTES));
    }

    public static function path(CipApplication $application): string
    {
        $application->loadMissing('client');

        if (! $application->client) {
            return Pages::home('q='.urlencode($application->displayNumber()));
        }

        return Pages::application($application->client->uid, 'tab=messages');
    }

    /**
     * @param  list<array{id: int, name: string, avatar: ?string, seenAt: string}>|null  $seenBy
     * @return array<string, mixed>
     */
    public static function present(CipApplicationMessage $message, User $viewer, ?array $seenBy = null): array
    {
        $author = ContactIdentity::present(
            $message->author,
            $message->companyMember,
            $message->author_name,
        );

        $seenBy ??= self::seenByFor(collect([$message]), $viewer)[(int) $message->id] ?? [];

        return [
            'id' => $message->uuid,
            'body' => $message->body,
            'lane' => $message->lane,
            'laneLabel' => $message->laneLabel(),
            'author' => [
                'name' => $author['name'],
                'email' => $author['email'],
                'avatar' => $author['avatar'],
            ],
            'mine' => ContactIdentity::isSelf(
                $viewer,
                $message->author_id,
                $message->company_member_id,
            ),
            'canShare' => $message->isInternal() && self::canPostInternal($viewer),
            'canEdit' => self::canEdit($message, $viewer),
            'edited' => $message->edited_at !== null,
            'replyTo' => self::presentReply($message, $viewer),
            'seenBy' => $seenBy,
            'createdAt' => $message->created_at?->toIso8601String(),
        ];
    }

    /**
     * Faces under these messages. The author and the person asking are left
     * off. A provider never appears on an internal note: their cursor only
     * covers the lane they can read, and the fallback below checks the lane
     * again so an interleaved id cannot leak it.
     *
     * @param  Collection<int, CipApplicationMessage>  $messages
     * @return array<int, list<array{id: int, name: string, avatar: ?string, seenAt: string}>>
     */
    private static function seenByFor(Collection $messages, User $viewer): array
    {
        $out = [];

        foreach ($messages as $message) {
            $out[(int) $message->id] = [];
        }

        if ($messages->isEmpty()) {
            return $out;
        }

        $applicationId = (int) $messages->first()->application_id;

        $reads = CipApplicationMessageRead::query()
            ->where('application_id', $applicationId)
            ->where('user_id', '!=', $viewer->id)
            ->with('user')
            ->get();

        if ($reads->isEmpty()) {
            return $out;
        }

        $rows = CipApplicationMessageReceipt::query()
            ->whereIn('message_id', $messages->map(fn (CipApplicationMessage $message) => (int) $message->id)->all())
            ->get()
            ->groupBy(fn (CipApplicationMessageReceipt $row) => $row->message_id.'-'.$row->user_id);

        $snapshotted = CipApplicationMessageReceipt::query()
            ->where('application_id', $applicationId)
            ->whereIn('user_id', $reads->pluck('user_id'))
            ->distinct()
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        foreach ($messages as $message) {
            $faces = [];

            foreach ($reads as $read) {
                $reader = $read->user;

                if (! $reader || (int) $reader->id === (int) $message->author_id) {
                    continue;
                }

                if (! self::readerCanSee($reader, $message)) {
                    continue;
                }

                $row = $rows->get($message->id.'-'.$reader->id)?->first();
                $seenAt = $row?->seen_at;

                if ($seenAt === null && ! in_array((int) $reader->id, $snapshotted, true)) {
                    if ((int) $read->last_read_id >= (int) $message->id) {
                        $seenAt = $read->updated_at;
                    }
                }

                if ($seenAt === null) {
                    continue;
                }

                $faces[] = [
                    'id' => (int) $reader->id,
                    'name' => $reader->name,
                    'avatar' => $reader->photoUrl(),
                    'seenAt' => $seenAt->toIso8601String(),
                ];
            }

            usort($faces, fn (array $a, array $b) => strcmp($a['seenAt'], $b['seenAt']));
            $out[(int) $message->id] = $faces;
        }

        return $out;
    }

    private static function readerCanSee(User $reader, CipApplicationMessage $message): bool
    {
        if ($message->isInternal()) {
            return self::canPostInternal($reader);
        }

        return true;
    }

    /**
     * Stamp messages the cursor is about to cover. Already-stamped messages
     * keep the time they were first seen.
     */
    private static function recordReceipts(CipApplication $application, User $viewer, CipApplicationMessageRead $read, int $through): bool
    {
        $previous = (int) $read->last_read_id;
        $already = CipApplicationMessageReceipt::query()
            ->where('application_id', $application->id)
            ->where('user_id', $viewer->id)
            ->exists();
        $covered = min($previous, $through);
        $wrote = false;

        if (! $already && $covered > 0) {
            $wrote = self::stampReceipts($application, $viewer, 0, $covered, $read->updated_at ?? now());
        }

        $start = $already ? $previous : $covered;

        if ($through > $start) {
            $wrote = self::stampReceipts($application, $viewer, $start, $through, now()) || $wrote;
        }

        return $wrote;
    }

    private static function stampReceipts(CipApplication $application, User $viewer, int $after, int $through, mixed $seenAt): bool
    {
        $ids = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->whereIn('lane', self::lanesFor($viewer))
            ->where('id', '>', $after)
            ->where('id', '<=', $through)
            ->where(function ($query) use ($viewer) {
                $query->whereNull('author_id')
                    ->orWhere('author_id', '!=', $viewer->id);
            })
            ->pluck('id');

        if ($ids->isEmpty()) {
            return false;
        }

        $stamp = Carbon::parse($seenAt)->toDateTimeString();

        foreach ($ids->chunk(400) as $chunk) {
            CipApplicationMessageReceipt::query()->insertOrIgnore($chunk->map(fn ($id) => [
                'application_id' => $application->id,
                'message_id' => $id,
                'user_id' => $viewer->id,
                'seen_at' => $stamp,
            ])->all());
        }

        return true;
    }

    /**
     * The quoted original, omitted when this reader must not see that lane.
     *
     * An internal note quoted inside a staff reply stays off the provider
     * payload even if a row were ever linked that way.
     *
     * @return array{id: string, senderName: string, preview: string, lane: string}|null
     */
    private static function presentReply(CipApplicationMessage $message, User $viewer): ?array
    {
        $parent = $message->replyTo;

        if ($parent === null) {
            return null;
        }

        if ($parent->isInternal() && ! self::canPostInternal($viewer)) {
            return null;
        }

        return [
            'id' => $parent->uuid,
            'senderName' => $parent->author_name,
            'preview' => Str::limit($parent->body, 140),
            'lane' => $parent->lane,
        ];
    }

    private static function resolveReply(CipApplication $application, User $author, ?string $replyTo, string $lane): ?CipApplicationMessage
    {
        $replyTo = trim((string) $replyTo);

        if ($replyTo === '') {
            return null;
        }

        $parent = CipApplicationMessage::query()
            ->where('application_id', $application->id)
            ->where('uuid', $replyTo)
            ->first();

        if ($parent === null || ($parent->isInternal() && ! self::canPostInternal($author))) {
            throw ValidationException::withMessages([
                'replyTo' => 'That message is no longer on this file.',
            ]);
        }

        if ($lane === CipApplicationMessage::LANE_PROVIDER && $parent->isInternal()) {
            throw ValidationException::withMessages([
                'replyTo' => 'An internal note can’t be quoted to the service provider.',
            ]);
        }

        return $parent;
    }

    private static function normaliseLane(string $lane, User $author): string
    {
        $lane = trim($lane);

        if ($lane === '') {
            return self::canPostInternal($author)
                ? CipApplicationMessage::LANE_INTERNAL
                : CipApplicationMessage::LANE_PROVIDER;
        }

        if (! in_array($lane, CipApplicationMessage::LANES, true)) {
            throw ValidationException::withMessages([
                'lane' => 'Choose Internal or Service provider.',
            ]);
        }

        return $lane;
    }

    private static function announce(CipApplication $application, CipApplicationMessage $message, User $author): void
    {
        $path = self::path($application);
        $url = rtrim(config('app.url'), '/').$path;
        $number = $application->displayNumber();
        $preview = Str::limit($message->body, 140);
        $title = $number.': new message';
        $email = $message->lane === CipApplicationMessage::LANE_PROVIDER;

        foreach (self::recipients($application, $message, $author) as $recipient) {
            if ($email) {
                Deliveries::send(
                    Postcards::notification(
                        $title,
                        $preview,
                        $url,
                        'Open Messages',
                        $recipient['name'] ? (strtok($recipient['name'], ' ') ?: $recipient['name']) : null,
                        'CIP Applications',
                    ),
                    $recipient['email'],
                    $application,
                    'cip-message',
                );
            }

            if ($recipient['userId'] === null) {
                continue;
            }

            Notifier::send([
                'user' => User::find($recipient['userId']),
                'actor' => $author,
                'type' => 'cip.message',
                'title' => $title,
                'message' => $preview,
                'subject' => $application,
                'action_url' => $path,
                'email' => false,
            ]);
        }
    }

    /**
     * @return list<array{email:string, name:?string, userId:?int}>
     */
    private static function recipients(CipApplication $application, CipApplicationMessage $message, User $author): array
    {
        $pool = $message->lane === CipApplicationMessage::LANE_INTERNAL
            ? [...Contacts::administrators(), ...Contacts::assignedOfficers($application)]
            : (Role::isStaff($author)
                ? Contacts::providerSide($application)
                : [...Contacts::administrators(), ...Contacts::assignedOfficers($application)]);

        $out = [];

        foreach ($pool as $recipient) {
            $email = trim((string) ($recipient['email'] ?? ''));

            if ($email === '') {
                continue;
            }

            if ($recipient['userId'] !== null && (int) $recipient['userId'] === (int) $author->id) {
                continue;
            }

            if (mb_strtolower($email) === mb_strtolower((string) $author->email)) {
                continue;
            }

            $out[mb_strtolower($email)] = $recipient;
        }

        return array_values($out);
    }

    /**
     * @return list<int>
     */
    private static function recipientUserIds(CipApplication $application, CipApplicationMessage $message, User $author): array
    {
        $ids = [];

        foreach (self::recipients($application, $message, $author) as $recipient) {
            if ($recipient['userId']) {
                $ids[] = (int) $recipient['userId'];
            }
        }

        return array_values(array_unique($ids));
    }
}
