<?php

namespace App\Support\Dashboard;

use App\Http\Controllers\Cip\CipDashboardController;
use App\Http\Controllers\DashboardMetricsController;
use App\Http\Controllers\DashboardWorkController;
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
 */
final class HomeBoard
{
    public const PARTS = ['metrics', 'staff', 'work', 'cip', 'mail', 'chats', 'pending'];

    public const CHAT_LIMIT = 5;

    public const MAIL_LIMIT = 8;

    /**
     * @param  list<string>|null  $parts
     * @return array<string, mixed>
     */
    public static function payload(Request $request, ?array $parts = null): array
    {
        $user = $request->user();
        $want = $parts === null || $parts === []
            ? self::PARTS
            : array_values(array_intersect(self::PARTS, $parts));

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

        return $out;
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
