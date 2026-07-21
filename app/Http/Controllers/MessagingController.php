<?php

namespace App\Http\Controllers;

use App\Events\ConversationRead;
use App\Events\MessageDeleted;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\UserBlock;
use App\Support\Messaging\Broadcaster;
use App\Support\Messaging\MessagingPresenter;
use App\Support\Messaging\MessagingSettings;
use App\Support\Messaging\PresenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Portal messaging (the /social/messages page).
 *
 * Every route here resolves the conversation through `Conversation::forUser()`,
 * so a user who is not a current participant gets a 404 rather than a 403 - we
 * do not confirm that someone else's conversation exists.
 */
class MessagingController extends Controller
{
    /** A page of thread history. Deliberately small: the thread loads upward. */
    private const MESSAGE_PAGE = 30;

    // ---------------------------------------------------------------- list

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $conversations = Conversation::query()
            ->forUser($user)
            ->with([
                'activeParticipants.user',
                // Only the newest message is needed for the list preview.
                'messages' => fn ($q) => $q->latest('id')->limit(1),
            ])
            ->orderByDesc('last_message_at')
            ->get();

        $participants = ConversationParticipant::query()
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->get()
            ->keyBy('conversation_id');

        $unread = $this->unreadCounts($user);

        $rows = $conversations
            ->map(fn (Conversation $c) => MessagingPresenter::conversation(
                $c, $user, $participants->get($c->id), (int) ($unread[$c->id] ?? 0)
            ))
            // Pinned conversations sort above the rest but keep recency within
            // each band, which is the order the list expects to render.
            ->sortBy([
                fn ($a, $b) => ($b['pinned'] <=> $a['pinned']),
                fn ($a, $b) => (($b['timestamp'] ?? '') <=> ($a['timestamp'] ?? '')),
            ])
            ->values();

        return response()->json([
            'conversations' => $rows,
            'me' => [
                'id' => $user->id,
                'name' => $user->name,
                'photo' => $user->avatar_url,
            ],
            'settings' => MessagingSettings::for($user),
            'realtime' => $this->realtimeConfig(),
        ]);
    }

    /**
     * Unread message counts for every one of this user's conversations, keyed
     * by conversation id.
     *
     * One grouped query rather than a count per row: the chat list asks for
     * this on every load, and the sidebar badge sums it.
     */
    private function unreadCounts(User $user): \Illuminate\Support\Collection
    {
        return DB::table('messages')
            ->join('conversation_participants as cp', function ($join) use ($user) {
                $join->on('cp.conversation_id', '=', 'messages.conversation_id')
                    ->where('cp.user_id', '=', $user->id)
                    ->whereNull('cp.left_at');
            })
            ->whereNull('messages.deleted_at')
            // Anything past this participant's read high-water mark…
            ->whereRaw('messages.id > coalesce(cp.last_read_message_id, 0)')
            // …that they did not send themselves.
            ->where(function ($q) use ($user) {
                $q->whereNull('messages.user_id')
                    ->orWhere('messages.user_id', '!=', $user->id);
            })
            ->groupBy('messages.conversation_id')
            ->selectRaw('messages.conversation_id, count(*) as aggregate')
            ->pluck('aggregate', 'messages.conversation_id');
    }

    /**
     * Connection details for the websocket. The portal pages are static files
     * with no Blade pass, so the client cannot be handed these at render time -
     * it reads them from this bootstrap response instead.
     *
     * Only the public app key is exposed. The secret never leaves the server;
     * subscribing still requires passing /broadcasting/auth as a session user.
     */
    private function realtimeConfig(): array
    {
        if (config('broadcasting.default') !== 'reverb') {
            return ['enabled' => false];
        }

        $options = config('broadcasting.connections.reverb.options', []);

        return [
            'enabled' => true,
            'key' => config('broadcasting.connections.reverb.key'),
            'host' => $options['host'] ?? config('reverb.servers.reverb.hostname', 'localhost'),
            'port' => (int) ($options['port'] ?? 8080),
            'scheme' => $options['scheme'] ?? 'http',
        ];
    }

    // -------------------------------------------------------------- thread

    public function messages(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);

        $before = $request->integer('before');

        $query = $conversation->messages()
            ->withTrashed()
            ->with(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender'])
            ->orderByDesc('id');

        // Cursor on the id, not an offset: new arrivals while the user reads
        // can't shift the window and make a page repeat or skip.
        if ($before > 0) {
            $query->where('id', '<', $before);
        }

        $page = $query->limit(self::MESSAGE_PAGE + 1)->get();
        $hasMore = $page->count() > self::MESSAGE_PAGE;
        $messages = $page->take(self::MESSAGE_PAGE)->reverse()->values();

        // The row summary only needs the newest message. Without this the
        // presenter's preview would lazily pull the conversation's entire
        // history just to look at its last entry.
        $conversation->load(['messages' => fn ($q) => $q->latest('id')->limit(1)]);

        return response()->json([
            'messages' => $messages->map(
                fn (Message $m) => MessagingPresenter::message($m, $user, $conversation)
            ),
            'hasMore' => $hasMore,
            'conversation' => MessagingPresenter::conversation(
                $conversation,
                $user,
                null,
                (int) ($this->unreadCounts($user)[$conversation->id] ?? 0),
            ),
        ]);
    }

    // ---------------------------------------------------------------- send

    public function send(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);

        $data = $request->validate([
            'body' => ['nullable', 'string', 'max:20000'],
            'replyTo' => ['nullable', 'string'],
            // Lets a retried send be recognised instead of duplicated.
            'nonce' => ['nullable', 'uuid'],
        ]);

        $body = trim((string) ($data['body'] ?? ''));

        if ($body === '') {
            throw ValidationException::withMessages(['body' => 'A message needs some text.']);
        }

        $this->assertNotBlocked($conversation, $user);

        // An already-stored nonce means this is a retry of a send that did
        // land; return the original rather than writing a second copy.
        if (! empty($data['nonce'])) {
            $existing = $conversation->messages()
                ->where('client_nonce', $data['nonce'])
                ->first();

            if ($existing) {
                return response()->json([
                    'message' => MessagingPresenter::message($existing, $user, $conversation),
                ]);
            }
        }

        $replyTo = null;
        if (! empty($data['replyTo'])) {
            // A reply target must live in this same conversation, or a reply
            // could quote a message from a thread the sender can't see.
            $replyTo = $conversation->messages()->where('uuid', $data['replyTo'])->first();
        }

        $message = DB::transaction(function () use ($conversation, $user, $body, $replyTo, $data) {
            $message = $conversation->messages()->create([
                'user_id' => $user->id,
                'type' => Message::TYPE_TEXT,
                'body' => $body,
                'reply_to_id' => $replyTo?->id,
                'client_nonce' => $data['nonce'] ?? null,
            ]);

            $conversation->forceFill(['last_message_at' => $message->created_at])->save();

            // Sending is also reading: the sender's own message must not come
            // back to them as unread, and their draft is now spent.
            ConversationParticipant::where('conversation_id', $conversation->id)
                ->where('user_id', $user->id)
                ->update([
                    'last_read_message_id' => $message->id,
                    'last_read_at' => now(),
                    'marked_unread_at' => null,
                    'draft' => null,
                ]);

            return $message;
        });

        $message->load(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender']);

        Broadcaster::toOthers(new MessageSent($message));

        return response()->json([
            'message' => MessagingPresenter::message($message, $user, $conversation),
        ]);
    }

    // --------------------------------------------------------- edit/delete

    public function updateMessage(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $message = $this->messageFor($request, $uuid);

        if (! $message->isEditableBy($user)) {
            abort(403, 'This message can no longer be edited.');
        }

        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
        ]);

        $body = trim($data['body']);
        if ($body === '') {
            throw ValidationException::withMessages(['body' => 'A message needs some text.']);
        }

        $message->update(['body' => $body, 'edited_at' => now()]);
        $message->load(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender']);

        Broadcaster::toOthers(new MessageUpdated($message));

        return response()->json([
            'message' => MessagingPresenter::message($message, $user, $message->conversation),
        ]);
    }

    public function destroyMessage(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $message = $this->messageFor($request, $uuid);
        $conversation = $message->conversation;

        if (! $message->isDeletableBy($user, $conversation->participantFor($user))) {
            abort(403, 'You cannot delete this message.');
        }

        // Soft delete: the bubble stays as a "deleted" placeholder so replies
        // that quote it still resolve, and the thread doesn't reflow.
        $message->delete();

        Broadcaster::toOthers(new MessageDeleted($message));

        return response()->json(['deleted' => true, 'id' => $message->uuid]);
    }

    // ---------------------------------------------------------------- read

    public function markRead(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $newest = $conversation->messages()->max('id') ?? 0;

        $participant->forceFill([
            'last_read_message_id' => max($newest, $participant->last_read_message_id ?? 0),
            'last_read_at' => now(),
            'marked_unread_at' => null,
        ])->save();

        // Only tell the room if this user publishes read receipts. Their own
        // unread badge still clears either way.
        if (MessagingSettings::get($user, 'readReceipts')) {
            Broadcaster::toOthers(new ConversationRead($conversation, $user, $participant->last_read_message_id));
        }

        return response()->json(['unread' => 0]);
    }

    public function markUnread(Request $request, string $uuid): JsonResponse
    {
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($request->user());

        $participant->forceFill(['marked_unread_at' => now()])->save();

        return response()->json(['markedUnread' => true]);
    }

    // -------------------------------------------------------------- drafts

    public function saveDraft(Request $request, string $uuid): JsonResponse
    {
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($request->user());

        $data = $request->validate(['draft' => ['nullable', 'string', 'max:20000']]);
        $draft = trim((string) ($data['draft'] ?? ''));

        $participant->forceFill([
            'draft' => $draft === '' ? null : $draft,
            'draft_updated_at' => $draft === '' ? null : now(),
        ])->save();

        return response()->json(['saved' => true]);
    }

    // -------------------------------------------------- conversation state

    public function updateConversation(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $data = $request->validate([
            'pinned' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
            // Minutes to stay muted; 0 unmutes, null mutes indefinitely.
            'muteMinutes' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:525600'],
        ]);

        if (array_key_exists('pinned', $data)) {
            $participant->pinned_at = $data['pinned'] ? now() : null;
        }

        if (array_key_exists('archived', $data)) {
            $participant->archived_at = $data['archived'] ? now() : null;
        }

        if (array_key_exists('muteMinutes', $data)) {
            $participant->muted_until = match (true) {
                $data['muteMinutes'] === null => now()->addYears(10),
                (int) $data['muteMinutes'] === 0 => null,
                default => now()->addMinutes((int) $data['muteMinutes']),
            };
        }

        $participant->save();

        $conversation->load(['activeParticipants.user', 'messages' => fn ($q) => $q->latest('id')->limit(1)]);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $user, $participant->fresh()),
        ]);
    }

    // ------------------------------------------------------ start a thread

    /** People this user may start a conversation with, for the new-chat search. */
    public function contacts(Request $request): JsonResponse
    {
        $user = $request->user();
        $term = trim((string) $request->query('q', ''));

        $blocked = UserBlock::query()
            ->where('user_id', $user->id)->pluck('blocked_user_id')
            ->merge(UserBlock::where('blocked_user_id', $user->id)->pluck('user_id'));

        $people = User::query()
            ->where('id', '!=', $user->id)
            ->whereNotIn('id', $blocked)
            ->where('status', User::STATUS_APPROVED)
            // lower() rather than ilike so the search behaves the same on the
            // Postgres the portal runs on and the SQLite the tests use.
            ->when($term !== '', function ($q) use ($term) {
                $needle = '%'.mb_strtolower($term).'%';

                $q->where(function ($w) use ($needle) {
                    $w->whereRaw('lower(name) like ?', [$needle])
                        ->orWhereRaw('lower(email) like ?', [$needle]);
                });
            })
            ->orderBy('name')
            ->limit(50)
            ->get(['id', 'name', 'email', 'avatar_url', 'account_type']);

        return response()->json([
            'contacts' => $people->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'photo' => $u->avatar_url,
                'accountType' => $u->account_type,
            ]),
        ]);
    }

    /** Open (or reuse) a direct thread with one other user. */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'userId' => ['required', 'integer', 'exists:users,id'],
        ]);

        $other = User::findOrFail($data['userId']);

        if ($other->id === $user->id) {
            throw ValidationException::withMessages(['userId' => 'You cannot message yourself.']);
        }

        if (UserBlock::blockedBetween($user->id, $other->id)) {
            abort(403, 'This conversation is unavailable.');
        }

        $conversation = $this->findOrCreateDirect($user, $other);
        $conversation->load(['activeParticipants.user', 'messages' => fn ($q) => $q->latest('id')->limit(1)]);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $user),
        ], 201);
    }

    // ------------------------------------------------------------ settings

    public function settings(Request $request): JsonResponse
    {
        return response()->json(['settings' => MessagingSettings::for($request->user())]);
    }

    /**
     * Messaging preferences are personal: this only ever writes the calling
     * user's own row, so one user's choices can't reach another's.
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $settings = MessagingSettings::update($request->user(), $request->all());

        return response()->json(['settings' => $settings]);
    }

    // ------------------------------------------------------------ presence

    /** Keeps this user online, and reports back on the people they can see. */
    public function heartbeat(Request $request): JsonResponse
    {
        PresenceService::touch($request->user());

        return response()->json(['ok' => true]);
    }

    // ------------------------------------------------------------- helpers

    /**
     * The one place conversation access is decided. Resolving through the
     * forUser scope means a non-member's request cannot return a row at all.
     */
    private function conversationFor(Request $request, string $uuid): Conversation
    {
        return Conversation::query()
            ->forUser($request->user())
            ->with('activeParticipants.user')
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    /** Same guard, reached through the message's conversation. */
    private function messageFor(Request $request, string $uuid): Message
    {
        return Message::query()
            ->whereHas('conversation', fn ($q) => $q->forUser($request->user()))
            ->with('conversation.activeParticipants.user')
            ->where('uuid', $uuid)
            ->firstOrFail();
    }

    /** A blocked pair may not exchange messages in their direct thread. */
    private function assertNotBlocked(Conversation $conversation, User $user): void
    {
        if ($conversation->isGroup()) {
            return;
        }

        $other = $conversation->counterpartFor($user);

        if ($other && UserBlock::blockedBetween($user->id, $other->id)) {
            abort(403, 'This conversation is unavailable.');
        }
    }

    /**
     * Exactly one direct thread may exist per pair, so reopening a chat lands
     * back in the same history instead of starting an empty duplicate.
     */
    private function findOrCreateDirect(User $user, User $other): Conversation
    {
        $existing = Conversation::query()
            ->where('type', Conversation::TYPE_DIRECT)
            ->whereHas('participants', fn ($q) => $q->where('user_id', $user->id)->whereNull('left_at'))
            ->whereHas('participants', fn ($q) => $q->where('user_id', $other->id)->whereNull('left_at'))
            ->first();

        if ($existing) {
            return $existing;
        }

        return DB::transaction(function () use ($user, $other) {
            $conversation = Conversation::create([
                'type' => Conversation::TYPE_DIRECT,
                'created_by' => $user->id,
                'last_message_at' => now(),
            ]);

            foreach ([$user, $other] as $member) {
                $conversation->participants()->create([
                    'user_id' => $member->id,
                    'role' => ConversationParticipant::ROLE_MEMBER,
                    'joined_at' => now(),
                ]);
            }

            return $conversation;
        });
    }
}
