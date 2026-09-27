<?php

namespace App\Support\Cip;

use App\Models\Client;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Support\Files\CommentReads;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * What on a client's file is waiting for somebody, measured for one reader.
 *
 * The applications table draws a dot on the applicant's face when there is
 * something addressed to this reader about that client, and an icon saying
 * which kind. Both answers come from here so the dot and the icon can never
 * disagree, and both are measured for a whole page at once — a row-by-row
 * lookup would be fifty queries per table draw.
 *
 * Two kinds, deliberately:
 *
 *   comments — a thread on a document in that client's tree with something in
 *              it this reader has not seen. Unread, not merely unresolved: a
 *              dot you cannot clear by reading is a dot people stop looking at.
 *              {@see CommentReads} owns the definition, so
 *              a client marked here has a file marked when you open it.
 *   messages — unread correspondence about this file: the application thread
 *              (section 24) plus a direct DM with the person the firm deals with on
 *              that client. Not "the client is talking to anybody", which
 *              would light the dot for conversations this reader is not
 *              part of and cannot open. Internal notes never count for an
 *              account that cannot see them.
 *
 * A count of zero is dropped rather than returned, so callers can treat the
 * absence of a key as "nothing to say" and never draw an empty indicator.
 */
final class Attention
{
    /**
     * @param  list<int>  $clientIds
     * @return array<int, array{comments: int, mentionsMe: bool, messages: int}>
     */
    public static function forClients(User $viewer, array $clientIds): array
    {
        $clientIds = array_values(array_unique(array_filter($clientIds)));

        if ($clientIds === []) {
            return [];
        }

        $comments = CommentReads::unreadByClient($viewer, $clientIds);
        $mentions = self::threadsNaming($viewer, $clientIds);
        $direct = self::unreadMessages($viewer, $clientIds);
        $thread = Threads::unreadByClient($viewer, $clientIds);

        $out = [];

        foreach ($clientIds as $id) {
            $open = (int) ($comments[$id] ?? 0);
            $unread = (int) ($direct[$id] ?? 0) + (int) ($thread[$id] ?? 0);
            $named = isset($mentions[$id]);

            if ($open === 0 && $unread === 0) {
                continue;
            }

            $out[$id] = ['comments' => $open, 'mentionsMe' => $named, 'messages' => $unread];
        }

        return $out;
    }

    /**
     * How many applications this reader can see still have something unread.
     *
     * The same mark as the dot on the applicant's face: an unread comment
     * thread or an unread message. Counted as applications, so the menu badge
     * matches the number of rows that are waiting, not the number of lines
     * inside them.
     */
    public static function unreadApplicationCount(User $viewer): int
    {
        $clientIds = ApplicationScope::visibleClientIds($viewer);

        if ($clientIds === []) {
            return 0;
        }

        $waiting = [];

        // Kept in slices: a whole caseload is more ids than one query should
        // bind, and the page indicator already measures clients this way.
        foreach (array_chunk($clientIds, 500) as $chunk) {
            $waiting += self::forClients($viewer, $chunk);
        }

        $ids = array_keys($waiting);

        if ($ids === []) {
            return 0;
        }

        $count = 0;

        foreach (array_chunk($ids, 500) as $chunk) {
            $count += ApplicationScope::query($viewer)
                ->whereIn('cip_applications.client_id', $chunk)
                ->count();
        }

        return $count;
    }

    /**
     * Which of those threads name this reader.
     *
     * Judged by the thread rather than the comment, the same way Hub::counts
     * does it: a mention inside a reply stops counting when the thread it is
     * part of is resolved, or the badge could never be cleared.
     *
     * @param  list<int>  $clientIds
     * @return array<int, true>
     */
    private static function threadsNaming(User $viewer, array $clientIds): array
    {
        return DB::table('file_comment_mentions')
            ->join('file_comments', 'file_comments.id', '=', 'file_comment_mentions.comment_id')
            ->join('files', 'files.id', '=', 'file_comments.file_id')
            ->join('folders', 'folders.id', '=', 'files.folder_id')
            ->join('file_comments as root', 'root.id', '=', 'file_comments.root_id')
            ->where('file_comment_mentions.user_id', $viewer->id)
            ->whereIn('folders.client_id', $clientIds)
            ->whereNull('root.resolved_at')
            ->whereNull('root.deleted_at')
            ->whereNull('file_comments.deleted_at')
            ->whereNull('files.deleted_at')
            ->distinct()
            ->pluck('folders.client_id')
            ->flip()
            ->map(fn () => true)
            ->all();
    }

    /**
     * Unread direct messages from each client's own account.
     *
     * One grouped query joined to the reader's own participant row, rather
     * than ConversationParticipant::unreadCount() per conversation — that
     * method is right for the chat list and fifty round trips here. Its
     * conditions are reproduced exactly, so a row bolded in Messages is a dot
     * here: system lines are history rather than correspondence, and anything
     * at or below the read mark or a clear point is already dealt with.
     *
     * @param  list<int>  $clientIds
     * @return array<int, int>
     */
    private static function unreadMessages(User $viewer, array $clientIds): array
    {
        $accounts = Client::query()
            ->whereIn('id', $clientIds)
            ->whereNotNull('user_id')
            ->pluck('user_id', 'id');

        if ($accounts->isEmpty()) {
            return [];
        }

        /*
         * Two-person conversations only. A group chat that happens to include
         * a client is not correspondence about that client's file, and lighting
         * their row for it would make the dot mean "somebody said something
         * somewhere".
         */
        $shared = DB::table('conversation_participants as mine')
            ->join('conversation_participants as theirs', 'theirs.conversation_id', '=', 'mine.conversation_id')
            ->join('conversations', 'conversations.id', '=', 'mine.conversation_id')
            ->where('mine.user_id', $viewer->id)
            ->whereIn('theirs.user_id', $accounts->values()->all())
            // The two sides of the join must be two people. Without this a
            // client reading their own row matched themselves and was told
            // they had unread mail from themselves.
            ->whereColumn('theirs.user_id', '!=', 'mine.user_id')
            ->where('conversations.type', Conversation::TYPE_DIRECT)
            ->pluck('theirs.user_id', 'mine.conversation_id');

        if ($shared->isEmpty()) {
            return [];
        }

        $unread = Message::query()
            ->join('conversation_participants as mine', function ($join) use ($viewer) {
                $join->on('mine.conversation_id', '=', 'messages.conversation_id')
                    ->where('mine.user_id', '=', $viewer->id);
            })
            ->whereIn('messages.conversation_id', $shared->keys()->all())
            ->where('messages.type', '!=', Message::TYPE_SYSTEM)
            ->whereRaw('messages.id > COALESCE(mine.last_read_message_id, 0)')
            ->whereRaw('messages.id > COALESCE(mine.cleared_before_message_id, 0)')
            ->where(fn ($q) => $q->whereNull('messages.user_id')->orWhere('messages.user_id', '!=', $viewer->id))
            ->groupBy('messages.conversation_id')
            ->selectRaw('messages.conversation_id as cid, COUNT(*) as n')
            ->pluck('n', 'cid');

        $byUser = [];

        foreach ($unread as $conversationId => $n) {
            $other = $shared[$conversationId] ?? null;
            if ($other !== null) {
                $byUser[$other] = ($byUser[$other] ?? 0) + (int) $n;
            }
        }

        $out = [];

        foreach ($accounts as $clientId => $userId) {
            if (! empty($byUser[$userId])) {
                $out[$clientId] = $byUser[$userId];
            }
        }

        return $out;
    }

    /**
     * Unread correspondence first, then whatever order the table already asked for.
     *
     * The same messages the envelope on a row counts: the application thread
     * (internal notes only for someone who can read them) and a direct message
     * with that client's own account. A comment thread does not move a row.
     * Existence, not the count — one unread line and twenty both belong at
     * the top, and counting every one of them would sort the page twice.
     */
    public static function orderUnreadMessagesFirst(Builder $query, User $viewer): void
    {
        [$thread, $threadBindings] = self::unreadThreadExistsSql($viewer);
        [$direct, $directBindings] = self::unreadDirectExistsSql($viewer);

        $query->orderByRaw(
            'CASE WHEN ('.$thread.' OR '.$direct.') THEN 0 ELSE 1 END',
            array_merge($threadBindings, $directBindings),
        );
    }

    /**
     * @return array{0: string, 1: list<int|string>}
     */
    private static function unreadThreadExistsSql(User $viewer): array
    {
        $lanes = Threads::lanesFor($viewer);
        $marks = implode(',', array_fill(0, count($lanes), '?'));

        $sql = 'EXISTS (
            SELECT 1 FROM cip_application_messages AS unread_msgs
            INNER JOIN cip_applications AS unread_apps
                ON unread_apps.id = unread_msgs.application_id
                AND unread_apps.deleted_at IS NULL
            LEFT JOIN cip_application_message_reads AS unread_reads
                ON unread_reads.application_id = unread_msgs.application_id
                AND unread_reads.user_id = ?
            WHERE unread_apps.client_id = cip_applications.client_id
                AND unread_msgs.lane IN ('.$marks.')
                AND (unread_msgs.author_id IS NULL OR unread_msgs.author_id != ?)
                AND unread_msgs.id > COALESCE(unread_reads.last_read_id, 0)
        )';

        return [$sql, array_merge([$viewer->id], $lanes, [$viewer->id])];
    }

    /**
     * @return array{0: string, 1: list<int|string>}
     */
    private static function unreadDirectExistsSql(User $viewer): array
    {
        $sql = 'EXISTS (
            SELECT 1 FROM clients AS unread_clients
            INNER JOIN conversation_participants AS unread_theirs
                ON unread_theirs.user_id = unread_clients.user_id
            INNER JOIN conversation_participants AS unread_mine
                ON unread_mine.conversation_id = unread_theirs.conversation_id
                AND unread_mine.user_id = ?
                AND unread_mine.user_id != unread_theirs.user_id
            INNER JOIN conversations AS unread_conversations
                ON unread_conversations.id = unread_mine.conversation_id
                AND unread_conversations.type = ?
                AND unread_conversations.deleted_at IS NULL
            INNER JOIN messages AS unread_direct
                ON unread_direct.conversation_id = unread_mine.conversation_id
                AND unread_direct.deleted_at IS NULL
                AND unread_direct.type != ?
                AND unread_direct.id > COALESCE(unread_mine.last_read_message_id, 0)
                AND unread_direct.id > COALESCE(unread_mine.cleared_before_message_id, 0)
                AND (unread_direct.user_id IS NULL OR unread_direct.user_id != ?)
            WHERE unread_clients.id = cip_applications.client_id
                AND unread_clients.deleted_at IS NULL
        )';

        return [$sql, [
            $viewer->id,
            Conversation::TYPE_DIRECT,
            Message::TYPE_SYSTEM,
            $viewer->id,
        ]];
    }
}
