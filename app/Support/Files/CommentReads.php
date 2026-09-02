<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileCommentRead;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Files\Workflow\Hub;
use App\Support\Realtime\Live;
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
     *
     * Returns whether any marker actually moved, so the caller can tell the
     * indicators to redraw and say nothing when there was nothing to clear.
     */
    public static function markFileRead(User $user, FileItem $file): bool
    {
        $rows = FileComment::query()
            ->where('file_id', $file->id)
            ->whereNotNull('root_id')
            ->groupBy('root_id')
            ->selectRaw('root_id, MAX(id) as newest')
            ->pluck('newest', 'root_id');

        return self::mark($user, $rows);
    }

    /**
     * Mark specific threads read, up to the newest comment each one holds.
     *
     * The Workflows list draws every thread it returns in full, so what it
     * returned is what was read.
     *
     * @param  iterable<int>  $rootIds
     */
    public static function markThreadsRead(User $user, iterable $rootIds): bool
    {
        $ids = collect($rootIds)->filter()->unique()->values();

        if ($ids->isEmpty()) {
            return false;
        }

        $rows = FileComment::query()
            ->whereIn('root_id', $ids)
            ->groupBy('root_id')
            ->selectRaw('root_id, MAX(id) as newest')
            ->pluck('newest', 'root_id');

        return self::mark($user, $rows);
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
     * The newest unseen comment in each unread thread, newest activity first.
     *
     * The dashboard strip asks for this rather than the latest comments that
     * merely concern you: a page of already-opened threads would hide an older
     * mention that is still unread, which is exactly the number on the badge.
     *
     * @return Collection<int, int> comment ids
     */
    public static function latestUnreadCommentIds(User $user, int $limit): Collection
    {
        return self::unreadQuery($user)
            ->selectRaw('MAX(file_comments.id) as newest_id')
            ->groupBy('file_comments.root_id')
            ->orderByDesc('newest_id')
            ->limit(max(1, $limit))
            ->pluck('newest_id');
    }

    /**
     * Everything a row indicator needs about a set of files, in three queries
     * for the whole page.
     *
     * `open` is conversations still going, `unread` is the part of that this
     * reader has not seen, `mentionsMe` is whether any of it names them. A file
     * with nothing to say is left out entirely rather than returned as zeroes,
     * so a caller can treat absence as "draw nothing".
     *
     * The File Library listing, a client's Documents tab and the CIP document
     * checklist all draw the same chip, so they all read it from here.
     *
     * @param  list<int>  $fileIds
     * @return array<int, array{open: int, unread: int, mentionsMe: bool}>
     */
    public static function flagsForFiles(User $user, array $fileIds): array
    {
        $fileIds = array_values(array_unique(array_filter($fileIds)));

        if ($fileIds === []) {
            return [];
        }

        $open = FileComment::query()
            ->whereIn('file_id', $fileIds)
            ->whereNull('parent_id')
            ->whereNull('resolved_at')
            ->groupBy('file_id')
            ->selectRaw('file_id, COUNT(*) as n')
            ->pluck('n', 'file_id');

        $unread = self::unreadByFile($user, $fileIds);

        $mentions = FileCommentMention::query()
            ->where('file_comment_mentions.user_id', $user->id)
            ->whereHas('comment', fn ($q) => $q
                ->whereIn('file_id', $fileIds)
                ->whereIn('root_id', fn ($sub) => $sub->select('id')
                    ->from('file_comments')
                    ->whereNull('resolved_at')
                    ->whereNull('deleted_at')))
            ->with('comment:id,file_id')
            ->get()
            ->pluck('comment.file_id')
            ->filter()
            ->flip();

        $out = [];

        foreach ($fileIds as $id) {
            $count = (int) ($open[$id] ?? 0);
            $new = (int) ($unread[$id] ?? 0);
            $mentioned = $mentions->has($id);

            if ($count === 0 && $new === 0 && ! $mentioned) {
                continue;
            }

            $out[$id] = ['open' => $count, 'unread' => $new, 'mentionsMe' => $mentioned];
        }

        return $out;
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
     * Unread threads anywhere beneath each folder, for a folder row.
     *
     * A folder is a lid: the Client documents panel lists "Dependent 2 — 5
     * files" and nothing about it says one of those five has a question waiting
     * on it. This is what lets the row say so without opening it.
     *
     * Counted over the whole subtree, because that is what a closed folder
     * hides, and de-duplicated by thread so a conversation spanning two files
     * is one thing to go and read.
     *
     * Walks UP from the reader's unread threads, not DOWN from every folder
     * on the page. The old subtree expansion of a library root (Citizenship
     * Applications, Staff Files) pulled tens of thousands of descendant ids
     * into PHP and rebound them as a WHERE IN — that is the 504 on
     * `/portal/files`, and past Postgres's bind limit it is the 500.
     *
     * @param  list<int>  $folderIds
     * @return array<int, int> folder id => unread thread count beneath it
     */
    public static function unreadByFolder(User $user, array $folderIds): array
    {
        $folderIds = array_values(array_unique(array_filter(array_map('intval', $folderIds))));

        if ($folderIds === []) {
            return [];
        }

        $rows = self::unreadQuery($user)
            ->join('files', 'files.id', '=', 'file_comments.file_id')
            ->whereNotNull('files.folder_id')
            ->whereNull('files.deleted_at')
            ->select('file_comments.root_id as thread_id', 'files.folder_id as folder_id')
            ->distinct()
            ->toBase()
            ->get();

        if ($rows->isEmpty()) {
            return [];
        }

        $hits = [];
        $touched = [];
        foreach ($rows as $row) {
            $threadId = (int) $row->thread_id;
            $folderId = (int) $row->folder_id;
            if (! $threadId || ! $folderId) {
                continue;
            }
            $hits[$threadId][$folderId] = true;
            $touched[$folderId] = true;
        }

        if ($touched === []) {
            return [];
        }

        FileAccess::warmChains(array_keys($touched));

        $wanted = array_fill_keys($folderIds, true);
        $out = [];

        foreach ($hits as $folders) {
            $counted = [];
            foreach (array_keys($folders) as $folderId) {
                foreach (FileAccess::lineage($folderId) as $node) {
                    $id = (int) $node->id;
                    if (isset($wanted[$id]) && ! isset($counted[$id])) {
                        $counted[$id] = true;
                        $out[$id] = ($out[$id] ?? 0) + 1;
                    }
                }
            }
        }

        return $out;
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

    /**
     * Which of these threads are unread for this reader.
     *
     * Returned as a lookup rather than a count, because the caller is drawing
     * one card per thread and needs to know about each. Asking does not change
     * anything: listing is not reading.
     *
     * @param  iterable<int>  $rootIds
     * @return array<int, true>
     */
    public static function unreadThreads(User $user, iterable $rootIds): array
    {
        $ids = collect($rootIds)->filter()->unique()->values();

        if ($ids->isEmpty()) {
            return [];
        }

        return self::unreadQuery($user)
            ->whereIn('file_comments.root_id', $ids->all())
            ->distinct()
            ->pluck('file_comments.root_id')
            ->flip()
            ->map(fn () => true)
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
            // A thread on a binned file is not something you can open, so it
            // must not sit on the badge either.
            ->whereExists(function ($q) {
                $q->selectRaw('1')
                    ->from('files')
                    ->whereColumn('files.id', 'file_comments.file_id')
                    ->whereNull('files.deleted_at');
            })
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
    private static function mark(User $user, Collection $newestByRoot): bool
    {
        if ($newestByRoot->isEmpty()) {
            return false;
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
            return false;
        }

        DB::table('file_comment_reads')->upsert(
            $rows,
            ['user_id', 'root_id'],
            ['last_read_comment_id', 'updated_at'],
        );

        /*
         * Tell this reader's other tabs, and nobody else's.
         *
         * Unread is the one count in the portal that is per-reader, so having
         * read something changes exactly one person's screens: the dot on the
         * CIP table, the chip on a checklist line and a folder row, the
         * Workflows badge. Signalling the staff room instead would have the
         * whole firm refetch to be told their own numbers are unchanged.
         *
         * The tab that did the reading is excluded by toOthers(), which is
         * correct rather than a gap: it is holding the response and redraws
         * from that, and a refetch racing its own write would be the one
         * request most likely to read back the old number.
         */
        Live::user(Live::FILES, $user->id);
        Live::user(Live::CIP, $user->id);
        Live::user(Live::WORKFLOWS, $user->id);

        return true;
    }
}
