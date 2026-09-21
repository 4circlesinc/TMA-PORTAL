<?php

namespace App\Support\Dashboard;

use App\Http\Controllers\Cip\CipDashboardController;
use App\Http\Controllers\DashboardMetricsController;
use App\Http\Controllers\DashboardWorkController;
use App\Http\Controllers\Files\BrowserController;
use App\Http\Controllers\StaffPresenceController;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\MailMessage;
use App\Models\Message;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Mail\Mailbox;
use App\Support\Messaging\ClientConversations;
use App\Support\Messaging\MessagingPresenter;
use App\Support\Messaging\OrganizationChat;
use App\Support\Presence\AvailabilityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * One payload for the portal home.
 *
 * The board used to fire a request per tile (metrics, staff, CIP, mail
 * bootstrap, mail messages, work, chats, pending users). Twenty people
 * opening Home queued more PHP workers than a 2-vCPU pool can run, and
 * each request re-read the session. This answers every tile in one go.
 *
 * Individual endpoints stay for Overview, Email, Messages and live
 * refetch of a single tile.
 *
 * The Recent Files and Favorites tiles are answered as `files`: the same
 * lean listing the File Library answers, read through {@see BrowserController}
 * so the rows are the rows every other list draws. Before that, the tile
 * that paints the page's largest text waited on a forty-row request that
 * queued behind ninety others. It is asked for by name rather than folded
 * into the default set: the listing costs sixty-odd queries of its own on a
 * real library (its per-row permission walk), and the seven tiles above
 * would then wait on it. The shell starts both requests together instead.
 */
final class HomeBoard
{
    public const PARTS = ['metrics', 'staff', 'work', 'cip', 'mail', 'chats', 'pending'];

    /** Parts answered only when named. */
    public const OPTIONAL_PARTS = ['files'];

    public const CHAT_LIMIT = 5;

    public const MAIL_LIMIT = 8;

    public const FILE_LIMIT = 8;

    /**
     * The period the board is measured over when the reader has not picked
     * one. portal-home.js keeps the picker's choice in localStorage, which
     * the server cannot read, so this is what the head start assumes; a
     * reader on another period gets an ordinary request instead.
     */
    public const DEFAULT_PERIOD = 'month';

    /**
     * @param  list<string>|null  $parts
     * @return array<string, mixed>
     */
    public static function payload(Request $request, ?array $parts = null): array
    {
        $user = $request->user();
        $want = $parts === null || $parts === []
            ? self::PARTS
            : array_values(array_intersect([...self::PARTS, ...self::OPTIONAL_PARTS], $parts));

        $out = [];

        if (in_array('metrics', $want, true)) {
            $out['metrics'] = DashboardMetricsController::payload($request);
        }

        if (in_array('staff', $want, true)) {
            $out['staff'] = StaffPresenceController::payload($user);
        }

        if (in_array('work', $want, true)) {
            $out['work'] = DashboardWorkController::payload($request);
        }

        if (in_array('cip', $want, true)) {
            $out['cip'] = CipDashboardController::payload($user);
        }

        if (in_array('mail', $want, true)) {
            $out['mail'] = Role::can($user, 'mail.use')
                ? self::mail($user)
                : ['connected' => false, 'messages' => [], 'inboxUnread' => 0];
        }

        if (in_array('chats', $want, true)) {
            $out['chats'] = self::chats($user);
        }

        if (in_array('pending', $want, true)) {
            $out['pendingUsers'] = Role::isAdmin($user)
                ? User::query()->where('status', 'pending')->count()
                : 0;
        }

        if (in_array('files', $want, true)) {
            $out['files'] = self::files($request);
        }

        return $out;
    }

    /**
     * The request the dashboard issues at boot for this reader, byte for
     * byte, so the shell can start it before the bundle has downloaded and
     * portal-home.js can tell that the answer on its way is the one it wants.
     *
     * Mirrors loadHomeBoard() and wantedWorkTiles() in portal-home.js: the
     * period, then the work lists the board shows (the strip only for a
     * reader with the Workflows section), then every part. Both sides must
     * write the same string, or the head start is wasted rather than wrong.
     */
    public static function bootUrl(User $user): string
    {
        $url = '/portal/dashboard/home?period='.self::DEFAULT_PERIOD;
        $want = self::wantedWork($user);

        if ($want !== []) {
            $url .= '&want='.implode(',', $want);
        }

        return $url.'&parts='.implode(',', self::PARTS);
    }

    /**
     * The Recent Files and Favorites request, started beside the board.
     * Nothing about it depends on the reader's preferences, so the string is
     * the same for everyone and loadHomeBoard() matches it the same way.
     */
    public static function bootFilesUrl(): string
    {
        return '/portal/dashboard/home?parts=files';
    }

    /**
     * Which work lists the board draws, from the saved dashboard preferences.
     *
     * @return list<string>
     */
    public static function wantedWork(User $user): array
    {
        $prefs = is_array($user->preferences) ? $user->preferences : [];
        $tiles = is_array($prefs['dashboardTiles'] ?? null) ? $prefs['dashboardTiles'] : [];
        $want = [];

        if (Role::can($user, 'workflows.view') && ($prefs['dashboardWorkflowStrip'] ?? true) !== false) {
            $want[] = 'feed';
        }
        if (($tiles['requests'] ?? true) !== false) {
            $want[] = 'requests';
        }
        if (($tiles['comments'] ?? true) !== false) {
            $want[] = 'comments';
        }

        return $want;
    }

    /**
     * Recent Files and Favorites, eight lean rows each.
     *
     * Read through the File Library's own listing rather than a second query
     * here, so what the tiles draw is exactly what Folders shows for the same
     * section: the same visibility scope, the same recency merge, the same
     * row shape. The controller is handed a request of its own for each
     * section, as if the browser had asked, with this reader on it.
     *
     * @return array{recent: array<string, mixed>, favorites: array<string, mixed>}
     */
    private static function files(Request $request): array
    {
        $browser = app(BrowserController::class);

        $listing = function (string $section) use ($request, $browser): array {
            $sub = Request::create('/portal/files', 'GET', [
                'section' => $section,
                'perPage' => self::FILE_LIMIT,
                'lean' => 1,
            ]);
            $sub->setUserResolver($request->getUserResolver());

            $rows = $browser->index($sub)->getData(true);

            return [
                'folders' => $rows['folders'] ?? [],
                'files' => $rows['files'] ?? [],
                'hasMore' => (bool) ($rows['hasMore'] ?? false),
            ];
        };

        return [
            'recent' => $listing('recent'),
            'favorites' => $listing('favorites'),
        ];
    }

    /**
     * Inbox preview for the home tile: connection, eight rows, one unread
     * count. Not the mailbox bootstrap — that still GROUP BYs every folder
     * when the Email page actually opens.
     *
     * @return array{connected: bool, messages: list<array<string, mixed>>, inboxUnread: int}
     */
    private static function mail(User $user): array
    {
        $account = Mailbox::accountFor($user);

        if (! $account) {
            return ['connected' => false, 'messages' => [], 'inboxUnread' => 0];
        }

        $inbox = MailMessage::query()
            ->where('user_id', $user->id)
            ->where('folder', 'inbox')
            ->whereNull('snoozed_until');

        $unread = (clone $inbox)->where('is_read', false)->count();

        $rows = (clone $inbox)
            ->with('labels')
            ->orderByDesc('is_pinned')
            ->orderByDesc('sent_at')
            ->limit(self::MAIL_LIMIT)
            ->get(MailMessage::listColumns());

        return [
            'connected' => true,
            'inboxUnread' => $unread,
            'messages' => self::mailRows($rows),
        ];
    }

    /**
     * @param  \Illuminate\Support\Collection<int, MailMessage>  $messages
     * @return list<array<string, mixed>>
     */
    private static function mailRows($messages): array
    {
        $emails = $messages
            ->map(fn (MailMessage $m) => $m->avatarAddress())
            ->filter()
            ->map(fn ($e) => mb_strtolower((string) $e))
            ->unique()
            ->values()
            ->all();

        $avatars = $emails === [] ? [] : User::query()
            ->whereIn(DB::raw('lower(email)'), $emails)
            ->get(['email', 'avatar_url', 'provider_avatar_url'])
            ->mapWithKeys(function (User $u) {
                $url = $u->photoUrl();

                return $url ? [mb_strtolower($u->email) => $url] : [];
            })
            ->all();

        return $messages->map(function (MailMessage $m) use ($avatars) {
            $row = $m->toRow();
            $email = mb_strtolower((string) $m->avatarAddress());
            $row['avatar'] = $avatars[$email] ?? null;

            return $row;
        })->values()->all();
    }

    /**
     * Top of the inbox, not the whole Messages list.
     *
     * @return array{chats: list<array<string, mixed>>}
     */
    private static function chats(User $user): array
    {
        OrganizationChat::syncMembership($user);
        ClientConversations::attachLogin($user);

        $conversations = Conversation::query()
            ->forUser($user)
            ->listedInInbox()
            ->with([
                'activeParticipants.user.presence',
                'client:id,uid,name,photo_url',
                'company:id,uid,name',
                'messages' => fn ($q) => $q->latest('id')->limit(1)->with('sender'),
            ])
            ->orderByDesc('last_message_at')
            ->limit(self::CHAT_LIMIT * 2)
            ->get();

        $participants = ConversationParticipant::query()
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->whereIn('conversation_id', $conversations->pluck('id'))
            ->get()
            ->keyBy('conversation_id');

        $unread = self::unreadCounts($user, $conversations->pluck('id')->all());

        $people = $conversations
            ->flatMap(fn (Conversation $c) => $c->activeParticipants->map(fn ($p) => $p->user))
            ->filter()
            ->unique('id')
            ->values();

        AvailabilityService::primeStates($people->pluck('id'));

        $rows = $conversations
            ->map(fn (Conversation $c) => MessagingPresenter::conversation(
                $c,
                $user,
                $participants->get($c->id),
                (int) ($unread[$c->id] ?? 0),
                collect(),
                [],
                true,
            ))
            ->reject(fn (array $row) => ! empty($row['archived']))
            ->sortBy([
                fn ($a, $b) => ($b['pinned'] <=> $a['pinned']),
                fn ($a, $b) => (($b['timestamp'] ?? '') <=> ($a['timestamp'] ?? '')),
            ])
            ->take(self::CHAT_LIMIT)
            ->values()
            ->all();

        return ['chats' => $rows];
    }

    /**
     * @param  list<int|string>  $conversationIds
     * @return \Illuminate\Support\Collection<int|string, int>
     */
    private static function unreadCounts(User $user, array $conversationIds)
    {
        if ($conversationIds === []) {
            return collect();
        }

        return DB::table('messages')
            ->join('conversation_participants as cp', function ($join) use ($user) {
                $join->on('cp.conversation_id', '=', 'messages.conversation_id')
                    ->where('cp.user_id', '=', $user->id)
                    ->whereNull('cp.left_at');
            })
            ->whereIn('messages.conversation_id', $conversationIds)
            ->whereNull('messages.deleted_at')
            ->where('messages.type', '!=', Message::TYPE_SYSTEM)
            ->whereRaw('messages.id > coalesce(cp.last_read_message_id, 0)')
            ->whereRaw('messages.id > coalesce(cp.cleared_before_message_id, 0)')
            ->where(function ($q) use ($user) {
                $q->whereNull('messages.user_id')
                    ->orWhere('messages.user_id', '!=', $user->id);
            })
            ->groupBy('messages.conversation_id')
            ->selectRaw('messages.conversation_id, count(*) as aggregate')
            ->pluck('aggregate', 'messages.conversation_id');
    }
}
