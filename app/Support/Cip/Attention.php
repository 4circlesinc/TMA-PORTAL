<?php

namespace App\Support\Cip;

use App\Models\Client;
use App\Models\Conversation;
use App\Models\FileComment;
use App\Models\Message;
use App\Models\User;
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
 *   comments — an unresolved thread on a document in that client's tree. The
 *              same definition the File Library row indicator uses, so a
 *              client marked here has a file marked when you open it.
 *   messages — unread direct correspondence with the person the firm deals
 *              with on that client. Not "the client is talking to anybody",
 *              which would light the dot for conversations this reader is not
 *              part of and cannot open.
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

        $comments = self::openThreads($clientIds);
        $mentions = self::threadsNaming($viewer, $clientIds);
        $messages = self::unreadMessages($viewer, $clientIds);

        $out = [];

        foreach ($clientIds as $id) {
            $open = (int) ($comments[$id] ?? 0);
            $unread = (int) ($messages[$id] ?? 0);
            $named = isset($mentions[$id]);

            if ($open === 0 && $unread === 0) {
                continue;
            }

            $out[$id] = ['comments' => $open, 'mentionsMe' => $named, 'messages' => $unread];
        }

        return $out;
    }

    /**
     * Unresolved root threads on documents in each client's tree.
     *
     * Joined through `folders.client_id`, which every folder under a client
     * carries as its subtree is provisioned, so a comment on a passport four
     * folders deep still counts against the client it belongs to.
     *
     * @param  list<int>  $clientIds
     * @return \Illuminate\Support\Collection<int, int>
     */
    private static function openThreads(array $clientIds)
    {
        return FileComment::query()
            ->join('files', 'files.id', '=', 'file_comments.file_id')
            ->join('folders', 'folders.id', '=', 'files.folder_id')
            ->whereIn('folders.client_id', $clientIds)
            ->whereNull('file_comments.parent_id')
            ->whereNull('file_comments.resolved_at')
            ->whereNull('file_comments.deleted_at')
            ->whereNull('files.deleted_at')
            ->whereNull('folders.deleted_at')
            ->groupBy('folders.client_id')
            ->selectRaw('folders.client_id as cid, COUNT(*) as n')
            ->pluck('n', 'cid');
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
}
