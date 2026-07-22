<?php

namespace App\Http\Controllers;

use App\Events\ConversationDelivered;
use App\Events\ConversationRead;
use App\Events\MessageDeleted;
use App\Events\MessageReacted;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\LinkPreview;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Models\UserBlock;
use App\Models\UserPresence;
use App\Models\UserWorkStatus;
use App\Support\Messaging\AttachmentIntake;
use App\Support\Messaging\Broadcaster;
use App\Support\Messaging\LinkPreviewService;
use App\Support\Messaging\MessagingPresenter;
use App\Support\Messaging\MessagingSearch;
use App\Support\Messaging\MessagingSettings;
use App\Support\Messaging\OrganizationChat;
use App\Support\Messaging\PresenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

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

        // Self-healing membership for firm-wide chats: anyone approved after
        // one was created is added on their next visit.
        OrganizationChat::syncMembership($user);

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
            // The real upload ceiling, which PHP's own ini caps can lower well
            // below what messaging would otherwise allow. Sent so the composer
            // can refuse an oversized file instantly instead of uploading it
            // only to be rejected.
            'limits' => [
                'maxAttachmentBytes' => AttachmentIntake::effectiveMaxBytes(),
                'maxAttachmentLabel' => AttachmentIntake::maxBytesLabel(),
                'maxAttachmentsPerMessage' => AttachmentIntake::MAX_PER_MESSAGE,
            ],
        ]);
    }

    /**
     * Unread message counts for every one of this user's conversations, keyed
     * by conversation id.
     *
     * One grouped query rather than a count per row: the chat list asks for
     * this on every load, and the sidebar badge sums it.
     */
    private function unreadCounts(User $user): Collection
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
            // …and past anything they cleared, so a cleared chat cannot come
            // back as unread.
            ->whereRaw('messages.id > coalesce(cp.cleared_before_message_id, 0)')
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
        $around = $request->integer('around');
        $participant = $conversation->participantFor($user);

        $cleared = $participant->cleared_before_message_id ?? 0;

        $base = fn () => $conversation->messages()
            ->withTrashed()
            ->with(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender', 'replyTo.attachments'])
            // Respect this participant's own "clear chat" marker. It is
            // personal: the other side still sees everything.
            ->where('id', '>', $cleared);

        /*
         * Jumping to a search result needs the message *and its surroundings*,
         * not the newest page. Half a page either side gives it context to be
         * read in, and tells the client there is more in both directions.
         */
        if ($around > 0) {
            $half = (int) floor(self::MESSAGE_PAGE / 2);

            $older = $base()->where('id', '<=', $around)->orderByDesc('id')->limit($half + 1)->get();
            $newer = $base()->where('id', '>', $around)->orderBy('id')->limit($half)->get();

            $messages = $older->reverse()->concat($newer)->values();

            return response()->json([
                'messages' => $messages->map(
                    fn (Message $m) => MessagingPresenter::message($m, $user, $conversation)
                ),
                // More history exists above if the window did not reach the start.
                'hasMore' => $older->count() > $half,
                'hasNewer' => $newer->count() >= $half,
                'around' => $around,
                'conversation' => MessagingPresenter::conversation(
                    $conversation, $user, $participant,
                    (int) ($this->unreadCounts($user)[$conversation->id] ?? 0),
                ),
            ]);
        }

        $query = $base()->orderByDesc('id');

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
            // uuids of files already staged by uploadAttachment().
            'attachments' => ['nullable', 'array', 'max:'.AttachmentIntake::MAX_PER_MESSAGE],
            'attachments.*' => ['string'],
        ]);

        $body = trim((string) ($data['body'] ?? ''));

        // Claim the staged files. Scoped to this conversation and this
        // uploader, so a uuid from elsewhere cannot be attached here.
        $staged = collect();
        if (! empty($data['attachments'])) {
            $staged = MessageAttachment::query()
                ->where('conversation_id', $conversation->id)
                ->where('uploaded_by', $user->id)
                ->whereNull('message_id')
                ->whereIn('uuid', $data['attachments'])
                ->get();

            if ($staged->count() !== count($data['attachments'])) {
                throw ValidationException::withMessages([
                    'attachments' => 'Some attachments are no longer available. Try adding them again.',
                ]);
            }
        }

        // A message needs *something* — text or a file, not necessarily both.
        if ($body === '' && $staged->isEmpty()) {
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

        $message = DB::transaction(function () use ($conversation, $user, $body, $replyTo, $data, $staged) {
            $message = $conversation->messages()->create([
                'user_id' => $user->id,
                // The type describes what the message *is*, which the bubble
                // uses to choose a renderer.
                'type' => match (true) {
                    $staged->contains(fn ($a) => $a->isVoice()) => Message::TYPE_VOICE,
                    $staged->isNotEmpty() => Message::TYPE_ATTACHMENT,
                    default => Message::TYPE_TEXT,
                },
                'body' => $body === '' ? null : $body,
                'reply_to_id' => $replyTo?->id,
                'client_nonce' => $data['nonce'] ?? null,
            ]);

            if ($staged->isNotEmpty()) {
                MessageAttachment::whereIn('id', $staged->pluck('id'))->update([
                    'message_id' => $message->id,
                    'status' => MessageAttachment::STATUS_READY,
                ]);
            }

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

        $message->load(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender', 'replyTo.attachments']);

        Broadcaster::toOthers(new MessageSent($message));

        return response()->json([
            'message' => MessagingPresenter::message($message, $user, $conversation),
        ]);
    }

    // -------------------------------------------------------------- search

    /** Grouped search across people, conversations, messages, files and links. */
    public function search(Request $request): JsonResponse
    {
        $data = $request->validate(['q' => ['nullable', 'string', 'max:200']]);

        return response()->json([
            'results' => MessagingSearch::run($request->user(), (string) ($data['q'] ?? '')),
        ]);
    }

    // ------------------------------------------------ conversation profile

    /**
     * The conversation information panel: who it is with, what is shared, and
     * the per-user controls that belong to it.
     *
     * Deliberately separate from the client record — this is the messaging
     * profile, and it must not leak fields the viewer would not otherwise see.
     */
    public function info(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);
        $counterpart = $conversation->counterpartFor($user);

        $attachments = MessageAttachment::query()
            ->where('conversation_id', $conversation->id)
            ->whereNotNull('message_id')
            ->get();

        $linkCount = $conversation->messages()
            ->whereNotNull('body')
            ->whereRaw('lower(body) like ?', ['%http%'])
            ->count();

        $conversation->load(['messages' => fn ($q) => $q->latest('id')->limit(1)]);

        return response()->json([
            'conversation' => MessagingPresenter::conversation($conversation, $user, $participant),
            'profile' => [
                'name' => $conversation->isGroup()
                    ? ($conversation->name ?: 'Group')
                    : ($counterpart?->name ?? 'Unknown'),
                'photo' => $conversation->isGroup()
                    ? ($conversation->photo_path ? route('messaging.conversations.photo', $conversation->uuid) : null)
                    : $counterpart?->avatar_url,
                // A group has members rather than an email address.
                'email' => $conversation->isGroup() ? null : $counterpart?->email,
                'accountType' => $conversation->isGroup() ? null : $counterpart?->account_type,
                'about' => $conversation->isGroup() ? null : $counterpart?->bio,
                'jobTitle' => $conversation->isGroup() ? null : $counterpart?->job_title,
                'presence' => $counterpart
                    ? PresenceService::forViewer($counterpart, $user)
                    : ['label' => 'Group chat'],
                'memberCount' => $conversation->activeParticipants->count(),
                'members' => $conversation->isGroup()
                    ? $conversation->activeParticipants->map(fn (ConversationParticipant $p) => [
                        'id' => $p->user?->id,
                        'name' => $p->user?->name,
                        'photo' => $p->user?->avatar_url,
                        'role' => $p->role,
                    ])->values()
                    : [],
            ],
            'counts' => [
                'media' => $attachments->filter(fn ($a) => $a->shelf() === 'media')->count(),
                'documents' => $attachments->filter(fn ($a) => $a->shelf() === 'documents')->count(),
                'links' => $linkCount,
            ],
            'can' => [
                // Only a direct conversation has someone to block.
                'block' => ! $conversation->isGroup() && $counterpart !== null,
                'openClientRecord' => in_array($user->account_type, ['Administrator', 'Employee'], true)
                    && ! $conversation->isGroup(),
            ],
        ]);
    }

    /**
     * Shared media, documents or links for the conversation info panel.
     *
     * Paged like the thread is: a long-running conversation can hold far more
     * than one screen of files.
     */
    public function gallery(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $data = $request->validate([
            'shelf' => ['required', 'in:media,documents,links'],
            'before' => ['nullable', 'integer'],
        ]);

        $cleared = $participant->cleared_before_message_id ?? 0;

        if ($data['shelf'] === 'links') {
            return response()->json(['items' => $this->galleryLinks($conversation, $user, $cleared)]);
        }

        $attachments = MessageAttachment::query()
            ->where('conversation_id', $conversation->id)
            ->whereNotNull('message_id')
            ->whereHas('message', fn ($q) => $q->where('id', '>', $cleared))
            ->with(['message.sender'])
            ->latest('id')
            ->get()
            // The media/documents split is a model decision, not a column, so
            // it is applied after loading rather than in SQL.
            ->filter(fn (MessageAttachment $a) => $a->shelf() === $data['shelf'])
            ->take(120)
            ->map(fn (MessageAttachment $a) => array_merge(
                MessagingPresenter::attachment($a),
                [
                    'messageId' => $a->message?->uuid,
                    'seq' => $a->message?->id,
                    'senderName' => $a->message?->user_id === $user->id
                        ? 'You'
                        : ($a->message?->sender?->name ?? 'Unknown'),
                    'date' => $a->created_at->format('j M Y'),
                ]
            ))
            ->values();

        return response()->json(['items' => $attachments]);
    }

    /**
     * Every piece of media the user can see, across all of their conversations.
     *
     * The same shelf as {@see gallery}, but not scoped to one thread — this is
     * the "Media" view in the inbox column, where someone looks for a photo
     * they remember receiving without remembering who sent it.
     *
     * Three things keep it honest rather than just a big query:
     *
     *  - Only conversations the user is still a member of. `forUser` is the
     *    same authorization boundary every other messaging endpoint uses, so
     *    leaving a group stops its media appearing here too.
     *  - Each conversation's own "cleared chat" point is respected
     *    individually. Clearing a thread has to hide its history here as well,
     *    or the media view becomes a way to read back what was cleared.
     *  - Voice notes are excluded, as they are from the per-thread shelf: they
     *    belong to their conversation, not to a gallery.
     */
    public function media(Request $request): JsonResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'shelf' => ['sometimes', 'in:media,documents,links'],
        ]);

        $shelf = $data['shelf'] ?? 'media';

        // Conversation id => the message id below which that thread was
        // cleared. Also doubles as the set of conversations the user may see.
        $cleared = ConversationParticipant::query()
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->pluck('cleared_before_message_id', 'conversation_id')
            ->map(fn ($id) => (int) $id);

        if ($cleared->isEmpty()) {
            return response()->json(['items' => []]);
        }

        // Links are not attachments — they live in message bodies — so they
        // come from their own query rather than this one.
        if ($shelf === 'links') {
            return response()->json(['items' => $this->pooledLinks($user, $cleared)]);
        }

        $attachments = MessageAttachment::query()
            ->whereIn('conversation_id', $cleared->keys())
            ->whereNotNull('message_id')
            ->where('status', MessageAttachment::STATUS_READY)
            ->with(['message.sender', 'conversation.activeParticipants.user'])
            ->latest('id')
            // Bounded before the per-shelf filter, which happens in PHP. Taken
            // generously so a mailbox full of documents still yields a full
            // page of media once the filter runs.
            ->limit(600)
            ->get()
            // Each thread's clear point is personal, so this cannot be one SQL
            // predicate — it is a different cutoff per conversation.
            ->filter(fn (MessageAttachment $a) => ($a->message?->id ?? 0) > ($cleared[$a->conversation_id] ?? 0))
            ->filter(fn (MessageAttachment $a) => $a->shelf() === $shelf)
            ->take(120)
            ->map(fn (MessageAttachment $a) => array_merge(
                MessagingPresenter::attachment($a),
                [
                    'messageId' => $a->message?->uuid,
                    'seq' => $a->message?->id,
                    'senderName' => $a->message?->user_id === $user->id
                        ? 'You'
                        : ($a->message?->sender?->name ?? 'Unknown'),
                    'date' => $a->created_at->format('j M Y'),
                    // Which thread it came from, so a hit can be traced back.
                    'conversationId' => $a->conversation?->uuid,
                    'conversationName' => $a->conversation
                        ? MessagingPresenter::title($a->conversation, $user)
                        : null,
                ]
            ))
            ->values();

        return response()->json(['items' => $attachments]);
    }

    /**
     * Every link shared with this user, across all their conversations.
     *
     * The pooled counterpart to {@see galleryLinks}. Links live in message
     * bodies rather than in the attachments table, so they need their own
     * query — but the same rules apply: only conversations the user is still
     * in, and each thread's own cleared point respected individually.
     *
     * Previews are read from cache only. This list can hold a hundred links
     * and must never turn into a hundred outbound page fetches.
     *
     * @param  Collection<int, int>  $cleared  conversation id => cleared-before message id
     * @return array<int, array<string, mixed>>
     */
    private function pooledLinks(User $user, Collection $cleared): array
    {
        $messages = Message::query()
            ->whereIn('conversation_id', $cleared->keys())
            ->whereNotNull('body')
            ->whereRaw('lower(body) like ?', ['%http%'])
            ->with(['sender', 'conversation.activeParticipants.user'])
            ->latest('id')
            ->limit(400)
            ->get()
            // Per-conversation cutoffs cannot be one SQL predicate.
            ->filter(fn (Message $m) => $m->id > ($cleared[$m->conversation_id] ?? 0));

        // Every URL first, so the preview cache is read in one query rather
        // than once per link.
        $extracted = $messages->flatMap(fn (Message $m) => collect(LinkPreviewService::extract($m->body))
            ->map(fn (string $url) => ['url' => $url, 'message' => $m]));

        $previews = LinkPreview::query()
            ->whereIn('url_hash', $extracted->pluck('url')->unique()->map(fn ($u) => hash('sha256', $u)))
            ->where('status', 'ok')
            ->get()
            ->keyBy('url_hash');

        return $extracted
            ->map(function (array $row) use ($user, $previews) {
                $m = $row['message'];
                $preview = $previews->get(hash('sha256', $row['url']));

                return [
                    'url' => $row['url'],
                    'domain' => parse_url($row['url'], PHP_URL_HOST),
                    'title' => $preview?->title,
                    'imageUrl' => $preview?->image_url,
                    'messageId' => $m->uuid,
                    'seq' => $m->id,
                    'senderName' => $m->user_id === $user->id ? 'You' : ($m->sender?->name ?? 'Unknown'),
                    'date' => $m->created_at->format('j M Y'),
                    'conversationId' => $m->conversation?->uuid,
                    'conversationName' => $m->conversation
                        ? MessagingPresenter::title($m->conversation, $user)
                        : null,
                ];
            })
            ->take(120)
            ->values()
            ->all();
    }

    // ------------------------------------------------------------- updates

    /**
     * What colleagues are working on right now — the Updates tab.
     *
     * Scoped exactly as {@see contacts} is: approved accounts, minus anyone
     * blocked in either direction. Reusing that rule rather than inventing a
     * second one means Updates can never show someone the directory would not.
     *
     * The viewer's own status comes back separately under `mine`, because the
     * tab both shows other people's and is where you set your own.
     */
    public function updates(Request $request): JsonResponse
    {
        $user = $request->user();

        $blocked = UserBlock::query()
            ->where('user_id', $user->id)->pluck('blocked_user_id')
            ->merge(UserBlock::where('blocked_user_id', $user->id)->pluck('user_id'));

        $statuses = UserWorkStatus::query()
            ->current()
            ->whereHas('user', fn ($q) => $q
                ->where('id', '!=', $user->id)
                ->whereNotIn('id', $blocked)
                ->where('status', User::STATUS_APPROVED))
            ->with('user')
            ->latest('updated_at')
            ->limit(100)
            ->get();

        // Presence in one query rather than one per row: this list is short but
        // it is polled, and a lookup per person adds up.
        $presence = UserPresence::query()
            ->whereIn('user_id', $statuses->pluck('user_id'))
            ->get()
            ->keyBy('user_id');

        $mine = UserWorkStatus::where('user_id', $user->id)->first();

        return response()->json([
            'mine' => $mine && ! $mine->hasExpired() ? $mine->toRecord() : null,
            'updates' => $statuses->map(fn (UserWorkStatus $s) => array_merge(
                $s->toRecord(),
                [
                    'userId' => $s->user_id,
                    'name' => $s->user?->name ?? 'Unknown',
                    'photo' => $s->user?->avatar_url,
                    'online' => (bool) $presence->get($s->user_id)?->isOnline(),
                ]
            ))->values(),
        ]);
    }

    /**
     * Set or clear the signed-in user's own status.
     *
     * An empty text clears it outright rather than storing a blank, so the
     * Updates list never has to filter empties out.
     */
    public function setUpdate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'text' => ['present', 'nullable', 'string', 'max:140'],
            'emoji' => ['sometimes', 'nullable', 'string', 'max:16'],
            // Minutes from now. Null/absent means "until I clear it".
            'expiresInMinutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20160'],
        ]);

        $user = $request->user();
        $text = trim((string) ($data['text'] ?? ''));

        if ($text === '') {
            UserWorkStatus::where('user_id', $user->id)->delete();

            return response()->json(['mine' => null]);
        }

        $status = UserWorkStatus::updateOrCreate(
            ['user_id' => $user->id],
            [
                'text' => $text,
                'emoji' => $data['emoji'] ?? null,
                'expires_at' => isset($data['expiresInMinutes']) && $data['expiresInMinutes']
                    ? now()->addMinutes((int) $data['expiresInMinutes'])
                    : null,
            ]
        );

        return response()->json(['mine' => $status->toRecord()]);
    }

    /** Every URL shared in the conversation, newest first. */
    private function galleryLinks(Conversation $conversation, User $user, int $cleared): array
    {
        return $conversation->messages()
            ->whereNotNull('body')
            ->where('id', '>', $cleared)
            ->whereRaw('lower(body) like ?', ['%http%'])
            ->with('sender')
            ->latest('id')
            ->limit(120)
            ->get()
            ->flatMap(function (Message $m) use ($user) {
                return collect(LinkPreviewService::extract($m->body))->map(function (string $url) use ($m, $user) {
                    // Only the cache is consulted here — the gallery must not
                    // fetch dozens of sites to render a list.
                    $preview = LinkPreview::where('url_hash', hash('sha256', $url))
                        ->where('status', 'ok')
                        ->first();

                    return [
                        'url' => $url,
                        'domain' => parse_url($url, PHP_URL_HOST),
                        'title' => $preview?->title,
                        'imageUrl' => $preview?->image_url,
                        'messageId' => $m->uuid,
                        'seq' => $m->id,
                        'senderName' => $m->user_id === $user->id ? 'You' : ($m->sender?->name ?? 'Unknown'),
                        'date' => $m->created_at->format('j M Y'),
                    ];
                });
            })
            ->take(120)
            ->values()
            ->all();
    }

    // -------------------------------------------------------- link preview

    /**
     * Open Graph metadata for a URL the user is typing or has sent.
     *
     * Rate-shaped by caching rather than by throttling: the composer asks as
     * the user types, and repeated asks for the same link are answered from
     * the cache. Requires a session, so this is not an open proxy — and the
     * fetcher refuses anything that resolves to private address space.
     */
    public function linkPreview(Request $request): JsonResponse
    {
        $data = $request->validate([
            'url' => ['required', 'string', 'max:2048'],
        ]);

        $preview = LinkPreviewService::for($data['url']);

        return response()->json([
            'preview' => $preview?->toCard(),
        ]);
    }

    // --------------------------------------------------------- attachments

    /**
     * Upload one file and stage it against the conversation.
     *
     * Staged, not sent: the composer needs a preview, a size and a remove
     * button before anything goes out, and a failed upload must never take the
     * typed message with it. The file is claimed by a message on send.
     */
    public function uploadAttachment(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);

        $this->assertNotBlocked($conversation, $user);

        $data = $request->validate([
            'file' => ['required', 'file'],
            // A recorded voice note, with the length and waveform the recorder
            // measured — the server has no media probe to derive them.
            'voice' => ['sometimes', 'boolean'],
            'durationMs' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'waveform' => ['sometimes', 'nullable', 'array', 'max:200'],
            'waveform.*' => ['numeric'],
        ]);

        $attachment = AttachmentIntake::stage(
            $request->file('file'),
            $conversation,
            $user,
            [
                'voice' => (bool) ($data['voice'] ?? false),
                'durationMs' => $data['durationMs'] ?? null,
                'waveform' => $data['waveform'] ?? null,
            ],
        );

        return response()->json([
            'attachment' => MessagingPresenter::attachment($attachment),
        ], 201);
    }

    /**
     * Discard a staged attachment before it is sent.
     *
     * Only the uploader may do this, and only while it is still staged — once
     * a message owns it, removing it means deleting the message.
     */
    public function destroyStagedAttachment(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();

        $attachment = MessageAttachment::query()
            ->whereHas('conversation', fn ($q) => $q->forUser($user))
            ->where('uuid', $uuid)
            ->where('uploaded_by', $user->id)
            ->whereNull('message_id')
            ->firstOrFail();

        // Remove the bytes too — a discarded upload should not linger.
        Storage::disk($attachment->disk)->delete($attachment->path);
        if ($attachment->thumb_path) {
            Storage::disk($attachment->disk)->delete($attachment->thumb_path);
        }

        $attachment->delete();

        return response()->json(['removed' => true]);
    }

    // ----------------------------------------------------------- reactions

    /**
     * Toggle one emoji reaction on a message.
     *
     * Reacting again with the same emoji removes it, which is what tapping a
     * reaction pill means everywhere else. A user may hold several *different*
     * reactions on one message; the unique index enforces one row per pair.
     *
     * Anyone who can see the conversation may react — there is no separate
     * permission, but membership is still checked by messageFor().
     */
    public function react(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $message = $this->messageFor($request, $uuid);

        abort_if($message->trashed(), 422, 'This message is no longer available.');

        $data = $request->validate([
            // Emoji only: a short grapheme cluster, never arbitrary text. The
            // column is 32 chars, enough for a character plus its modifiers.
            'emoji' => ['required', 'string', 'max:32'],
        ]);

        $emoji = trim($data['emoji']);

        if ($emoji === '' || ! $this->looksLikeEmoji($emoji)) {
            throw ValidationException::withMessages(['emoji' => 'That is not an emoji.']);
        }

        /*
         * One reaction per person per message.
         *
         * Picking a different emoji *replaces* the previous one rather than
         * stacking a second; picking the same one again clears it. The unique
         * index still allows several rows per user, so this is enforced here
         * by removing whatever they had first.
         */
        $mine = $message->reactions()->where('user_id', $user->id)->get();
        $hadSame = $mine->contains('emoji', $emoji);

        if ($mine->isNotEmpty()) {
            $message->reactions()->where('user_id', $user->id)->delete();
        }

        if (! $hadSame) {
            $message->reactions()->create(['user_id' => $user->id, 'emoji' => $emoji]);
        }

        $message->load(['reactions.user', 'sender', 'attachments', 'stars', 'replyTo.sender', 'replyTo.attachments']);

        Broadcaster::toOthers(new MessageReacted($message));

        return response()->json([
            'message' => MessagingPresenter::message($message, $user, $message->conversation),
        ]);
    }

    /**
     * Guard the reaction column against being used as free text.
     *
     * Reactions are rendered verbatim into every participant's list of who
     * reacted, so "a short string" is not a tight enough contract: this
     * requires at least one character from an emoji block and rejects anything
     * containing plain letters, digits or whitespace.
     */
    private function looksLikeEmoji(string $value): bool
    {
        if (preg_match('/[\p{L}\p{N}\s]/u', $value)) {
            return false;
        }

        return (bool) preg_match(
            '/[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B00}-\x{2BFF}\x{FE00}-\x{FE0F}\x{1F1E6}-\x{1F1FF}]/u',
            $value
        );
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
        $message->load(['sender', 'attachments', 'reactions.user', 'stars', 'replyTo.sender', 'replyTo.attachments']);

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

    /**
     * Acknowledge receipt of everything currently in a conversation.
     *
     * Called by the client whenever messages land — on load, and on each
     * socket arrival — including for conversations that are not open. That is
     * what "delivered" means: this account has the message, not that anyone has
     * looked at it.
     */
    public function markDelivered(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $newest = $conversation->messages()->max('id') ?? 0;
        $current = $participant->last_delivered_message_id ?? 0;

        // Nothing new to acknowledge; don't write or broadcast on every poll.
        if ($newest <= $current) {
            return response()->json(['delivered' => $current]);
        }

        $participant->forceFill([
            'last_delivered_message_id' => $newest,
            'last_delivered_at' => now(),
        ])->save();

        Broadcaster::toOthers(new ConversationDelivered($conversation, $user, $newest));

        return response()->json(['delivered' => $newest]);
    }

    /**
     * Acknowledge receipt across every conversation at once.
     *
     * The client calls this when the chat list loads, which is the moment this
     * account demonstrably has all of those messages. Doing it per conversation
     * would be one request per row on every single load.
     *
     * Only rows that actually move are written and broadcast, so a quiet reload
     * costs one query and no events.
     */
    public function markAllDelivered(Request $request): JsonResponse
    {
        $user = $request->user();

        // Newest message id per conversation this user is still a member of.
        $newest = DB::table('messages')
            ->join('conversation_participants as cp', function ($join) use ($user) {
                $join->on('cp.conversation_id', '=', 'messages.conversation_id')
                    ->where('cp.user_id', '=', $user->id)
                    ->whereNull('cp.left_at');
            })
            ->whereNull('messages.deleted_at')
            ->whereRaw('messages.id > coalesce(cp.last_delivered_message_id, 0)')
            ->groupBy('messages.conversation_id')
            ->selectRaw('messages.conversation_id, max(messages.id) as newest')
            ->pluck('newest', 'messages.conversation_id');

        if ($newest->isEmpty()) {
            return response()->json(['delivered' => 0]);
        }

        $conversations = Conversation::query()
            ->whereIn('id', $newest->keys())
            ->get()
            ->keyBy('id');

        foreach ($newest as $conversationId => $messageId) {
            ConversationParticipant::query()
                ->where('conversation_id', $conversationId)
                ->where('user_id', $user->id)
                ->update([
                    'last_delivered_message_id' => $messageId,
                    'last_delivered_at' => now(),
                ]);

            $conversation = $conversations->get($conversationId);
            if ($conversation) {
                Broadcaster::toOthers(
                    new ConversationDelivered($conversation, $user, (int) $messageId)
                );
            }
        }

        return response()->json(['delivered' => $newest->count()]);
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

    // -------------------------------------------- destructive / moderation

    /**
     * Clear a conversation for the caller only.
     *
     * Deliberately one-sided: it advances a personal marker rather than
     * deleting rows, so the other participant keeps their copy of the history.
     * A messenger that let one person erase another's record would be a very
     * different product, and a dangerous default.
     */
    public function clearChat(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $newest = $conversation->messages()->max('id') ?? 0;

        $participant->forceFill([
            'cleared_before_message_id' => $newest,
            'last_read_message_id' => $newest,
            'last_read_at' => now(),
            'marked_unread_at' => null,
        ])->save();

        return response()->json(['cleared' => true, 'before' => $newest]);
    }

    /**
     * Leave a conversation. The participant row stays with `left_at` set so
     * past messages still resolve to a sender; the thread simply stops being
     * theirs. A direct thread can be rejoined by opening it again.
     */
    public function destroyConversation(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        // The firm's own chat is not something a person opts out of.
        abort_unless(
            $conversation->isLeavableBy($user) || ! $conversation->isGroup(),
            422,
            'The organization chat cannot be left.'
        );

        if ($conversation->isGroup()) {
            // Announce a departure so the remaining members see why.
            $conversation->messages()->create([
                'user_id' => null,
                'type' => Message::TYPE_SYSTEM,
                'system_event' => ['event' => 'member_left', 'actorName' => $user->name],
            ]);
        }

        $participant->forceFill(['left_at' => now()])->save();

        return response()->json(['left' => true]);
    }

    public function block(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $other = $conversation->counterpartFor($user);

        abort_if($other === null, 422, 'Only a direct conversation can be blocked.');

        UserBlock::firstOrCreate(['user_id' => $user->id, 'blocked_user_id' => $other->id]);

        return response()->json(['blocked' => true]);
    }

    public function unblock(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $other = $conversation->counterpartFor($user);

        abort_if($other === null, 422, 'Only a direct conversation can be unblocked.');

        UserBlock::where('user_id', $user->id)->where('blocked_user_id', $other->id)->delete();

        return response()->json(['blocked' => false]);
    }

    /**
     * Plain-text transcript of everything the caller can still see, honouring
     * their own "clear chat" marker.
     */
    public function export(Request $request, string $uuid): Response
    {
        $user = $request->user();
        $conversation = $this->conversationFor($request, $uuid);
        $participant = $conversation->participantFor($user);

        $messages = $conversation->messages()
            ->with('sender')
            ->where('id', '>', $participant->cleared_before_message_id ?? 0)
            ->orderBy('id')
            ->get();

        $title = $conversation->isGroup()
            ? ($conversation->name ?: 'Group')
            : ($conversation->counterpartFor($user)?->name ?? 'Conversation');

        $lines = ['Conversation: '.$title, 'Exported: '.now()->toDayDateTimeString(), ''];

        foreach ($messages as $message) {
            if ($message->isSystem()) {
                $lines[] = '['.$message->created_at->format('Y-m-d H:i').'] * system event';

                continue;
            }

            $lines[] = sprintf(
                '[%s] %s: %s',
                $message->created_at->format('Y-m-d H:i'),
                $message->sender?->name ?? 'Unknown',
                $message->trashed() ? '(message deleted)' : (string) $message->body,
            );
        }

        $filename = Str::slug($title ?: 'conversation').'-'.now()->format('Y-m-d').'.txt';

        return response(implode("\n", $lines), 200, [
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
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
