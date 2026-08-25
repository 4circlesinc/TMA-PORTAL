<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileCommentRead;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Files\Workflow\Hub;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What each reader has and has not seen of the comment threads that concern
 * them — the one definition of "unread" every indicator in the portal uses.
 *
 * WHAT COUNTS AS UNREAD
 *
 * A thread is unread for you when its newest comment is newer than the marker
 * you left on it, and that newest comment is not your own. Three parts, each
 * load-bearing:
 *
 *   newest comment      — a thread with a new reply is unread again, which is
 *                         the whole point; the old "unresolved" test could not
 *                         tell a fresh answer from a month of silence.
 *   your marker         — no marker means you have never opened it, so all of
 *                         it is unread.
 *   not your own        — you have read what you just wrote. Without this,
 *                         answering somebody would leave your own reply sitting
 *                         in your badge until you re-opened the thread to look
 *                         at yourself.
 *
 * Only threads that CONCERN you are ever counted — you wrote in it, you were
 * named in it, or the file is yours. {@see Hub::concernsMe} owns that
 * definition and this defers to it, so the badge counts exactly the set the
 * Workflows page opens on. Counting every thread in the firm would put a
 * three-figure number on an administrator's sidebar that no action of theirs
 * could ever clear.
 *
 * Resolved threads drop out. Settled work is not unread work.
 */
final class CommentReads
{
    /**
     * Mark every thread on a file read, up to what exists right now.
     *
     * Called when the file's comments are actually put on screen. Reading is
     * something the reader did, so it is recorded where the bodies are shown
     * and nowhere else — a listing that merely names a file must not clear it.
     */
    public static function markFileRead(User $user, FileItem $file): void
    {
        $rows = FileComment::query()
            ->where('file_id', $file->id)
            ->whereNotNull('root_id')
            ->groupBy('root_id')
            ->selectRaw('root_id, MAX(id) as newest')
            ->pluck('newest', 'root_id');

        self::mark($user, $rows);
    }

    /**
     * Mark specific threads read, up to the newest comment each one holds.
     *
     * The Workflows list draws every thread it returns in full, so what it
     * returned is what was read.
     *
     * @param  iterable<int>  $rootIds
     */
    public static function markThreadsRead(User $user, iterable $rootIds): void
    {
        $ids = collect($rootIds)->filter()->unique()->values();

        if ($ids->isEmpty()) {
            return;
        }

        $rows = FileComment::query()
            ->whereIn('root_id', $ids)
            ->groupBy('root_id')
            ->selectRaw('root_id, MAX(id) as newest')
            ->pluck('newest', 'root_id');

        self::mark($user, $rows);
    }

    /**
     * How many threads concerning this reader have something they have not
     * seen. The number on the Workflows badge.
     */
    public static function unreadCount(User $user): int
    {
        return self::unreadThreadIds($user)->count();
    }

    /**
     * Unread threads per file, for a listing's row indicators.
     *
     * One query for the page rather than one per row.
     *
     * @param  list<int>  $fileIds
     * @return array<int, int> file id => unread thread count
     */
    public static function unreadByFile(User $user, array $fileIds): array
    {
        if ($fileIds === []) {
            return [];
        }

        return self::unreadQuery($user)
            ->whereIn('file_comments.file_id', $fileIds)
            ->groupBy('file_comments.file_id')
            ->selectRaw('file_comments.file_id as fid, COUNT(DISTINCT file_comments.root_id) as n')
            ->pluck('n', 'fid')
            ->map(fn ($n) => (int) $n)
            ->all();
    }

    /**
     * Unread threads per client, for the applicant row indicator.
     *
     * @param  list<int>  $clientIds
     * @return array<int, int> client id => unread thread count
     */
    public static function unreadByClient(User $user, array $clientIds): array
    {
        if ($clientIds === []) {
            return [];
        }

        return self::unreadQuery($user)
            ->join('files', 'files.id', '=', 'file_comments.file_id')
            ->join('folders', 'folders.id', '=', 'files.folder_id')
            ->whereIn('folders.client_id', $clientIds)
            ->whereNull('files.deleted_at')
            ->whereNull('folders.deleted_at')
            ->groupBy('folders.client_id')
            ->selectRaw('folders.client_id as cid, COUNT(DISTINCT file_comments.root_id) as n')
            ->pluck('n', 'cid')
            ->map(fn ($n) => (int) $n)
            ->all();
    }

    /** @return Collection<int, int> */
    private static function unreadThreadIds(User $user): Collection
    {
        return self::unreadQuery($user)
            ->distinct()
            ->pluck('file_comments.root_id');
    }

    /**
     * The shared shape: every comment that makes its thread unread for this
     * reader. Callers group it however their indicator needs.
     */
    private static function unreadQuery(User $user): Builder
    {
        return FileComment::query()
            // The reader's marker for this comment's thread, if they have one.
            ->leftJoin('file_comment_reads', function ($join) use ($user) {
                $join->on('file_comment_reads.root_id', '=', 'file_comments.root_id')
                    ->where('file_comment_reads.user_id', '=', $user->id);
            })
            // Your own writing is already read.
            ->where('file_comments.author_id', '!=', $user->id)
            ->whereNotNull('file_comments.root_id')
            ->where(function (Builder $q) {
                $q->whereNull('file_comment_reads.last_read_comment_id')
                    ->orWhereColumn('file_comments.id', '>', 'file_comment_reads.last_read_comment_id');
            })
            // Settled work is not unread work: resolution lives on the root.
            ->whereIn('file_comments.root_id', fn ($sub) => $sub->select('id')
                ->from('file_comments')
                ->whereNull('resolved_at')
                ->whereNull('deleted_at'))
            /*
             * Asked of the THREAD, not of each comment.
             *
             * Hub::comments applies concernsMe per row because it lists rows.
             * Here it decides whether a conversation is yours, and it plainly
             * is once you have been named in it — so the reply that arrives
             * afterwards is yours to read too. Testing each comment instead
             * meant being @-mentioned bought you exactly one unread comment
             * and every answer to it counted as somebody else's business.
             */
            ->whereIn('file_comments.root_id', self::threadsConcerning($user));
    }

    /** Thread ids this reader has any stake in. */
    private static function threadsConcerning(User $user): Builder
    {
        return FileComment::query()
            ->select('file_comments.root_id')
            ->whereNotNull('file_comments.root_id')
            ->where(fn (Builder $q) => Hub::concernsMe($q, $user));
    }

    /**
     * Write the markers.
     *
     * An upsert rather than read-then-write: two tabs open on the same file is
     * ordinary, and the unique index is what makes the second one an update
     * instead of a duplicate row. `GREATEST` is avoided for the same reason it
     * is avoided elsewhere — SQLite spells it differently — so a marker that
     * would move backwards is simply not written.
     *
     * @param  Collection<int, int>  $newestByRoot
     */
    private static function mark(User $user, Collection $newestByRoot): void
    {
        if ($newestByRoot->isEmpty()) {
            return;
        }

        $existing = FileCommentRead::query()
            ->where('user_id', $user->id)
            ->whereIn('root_id', $newestByRoot->keys())
            ->pluck('last_read_comment_id', 'root_id');

        $now = now();
        $rows = [];

        foreach ($newestByRoot as $rootId => $newest) {
            // Already at or past this point: nothing to say, and writing it
            // would touch every row on every page view.
            if ((int) ($existing[$rootId] ?? 0) >= (int) $newest) {
                continue;
            }

            $rows[] = [
                'user_id' => $user->id,
                'root_id' => (int) $rootId,
                'last_read_comment_id' => (int) $newest,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        if ($rows === []) {
            return;
        }

        DB::table('file_comment_reads')->upsert(
            $rows,
            ['user_id', 'root_id'],
            ['last_read_comment_id', 'updated_at'],
        );
    }
}
