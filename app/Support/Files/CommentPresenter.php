<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileItem;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Shapes comment threads for the viewer.
 *
 * Bodies go out as plain text, never HTML. The client escapes them and then
 * decorates the mentioned names, so nothing a user typed can be interpreted as
 * markup in somebody else's browser.
 */
class CommentPresenter
{
    /**
     * One page of threads for a file, newest first (latest on top), with each
     * thread's replies attached.
     *
     * Paged by thread, not by comment: cutting a page mid-thread would show
     * replies whose parent is on the next page.
     *
     * @return array{threads: list<array>, nextCursor: ?int, openCount: int, total: int}
     */
    public static function page(FileItem $file, User $viewer, ?int $before = null): array
    {
        $roots = FileComment::query()
            ->where('file_id', $file->id)
            ->whereColumn('id', 'root_id')
            ->when($before !== null, fn ($q) => $q->where('id', '<', $before))
            ->with(['author:id,name,email,avatar_url,provider_avatar_url', 'resolver:id,name'])
            ->orderByDesc('id')
            ->limit(Comments::PER_PAGE + 1)
            ->get();

        $hasMore = $roots->count() > Comments::PER_PAGE;
        $roots = $roots->take(Comments::PER_PAGE);
        $nextCursor = $hasMore ? $roots->last()->id : null;

        // Every reply for these threads in one query rather than one per
        // thread, this panel opens on every file, so it must not be N+1.
        $replies = $roots->isEmpty() ? collect() : FileComment::query()
            ->whereIn('root_id', $roots->pluck('id'))
            ->whereNotNull('parent_id')
            ->with(['author:id,name,email,avatar_url,provider_avatar_url'])
            ->orderBy('id')
            ->get()
            ->groupBy('root_id');

        $mentions = self::mentionMap($roots->pluck('id')->merge($replies->flatten()->pluck('id')));

        $threads = $roots
            ->values()
            ->map(fn (FileComment $root) => self::comment($root, $viewer, $file, $mentions) + [
                'replies' => ($replies[$root->id] ?? collect())
                    ->map(fn (FileComment $r) => self::comment($r, $viewer, $file, $mentions))
                    ->values()->all(),
            ])
            ->all();

        return [
            'threads' => $threads,
            'nextCursor' => $nextCursor,
            'openCount' => FileComment::where('file_id', $file->id)
                ->whereColumn('id', 'root_id')->whereNull('resolved_at')->count(),
            'total' => FileComment::where('file_id', $file->id)->count(),
            'canComment' => Comments::canComment($viewer, $file),
        ];
    }

    /** @return array<string, mixed> */
    public static function comment(FileComment $comment, User $viewer, FileItem $file, array $mentions = []): array
    {
        $deleted = $comment->trashed();

        return [
            'id' => $comment->uuid,
            'body' => $deleted ? null : $comment->body,
            // The highlighted area the thread is about, or null, the viewer
            // draws it back onto the page on hover.
            'anchor' => $comment->anchor,
            'deleted' => $deleted,
            'author' => $comment->author ? [
                'id' => $comment->author->id,
                'name' => $comment->author->name,
                'isSelf' => $comment->author->id === $viewer->id,
                'email' => $comment->author->email,
                'avatar' => $comment->author->photoUrl(),
            ] : null,
            'mentions' => $mentions[$comment->id] ?? [],
            'createdAt' => optional($comment->created_at)->toIso8601String(),
            'editedAt' => optional($comment->edited_at)->toIso8601String(),
            'resolved' => $comment->isResolved(),
            'resolvedAt' => optional($comment->resolved_at)->toIso8601String(),
            'resolvedBy' => $comment->resolver?->name,
            'replyCount' => (int) $comment->replies_count,
            'isReply' => $comment->isReply(),
            // Computed per viewer: the client hides what it may not do, and the
            // server refuses it regardless.
            'can' => [
                'edit' => ! $deleted && Comments::canEdit($viewer, $comment),
                'delete' => ! $deleted && Comments::canDelete($viewer, $comment, $file),
                'resolve' => ! $deleted && ! $comment->isReply() && Comments::canResolve($viewer, $comment, $file),
                'reply' => ! $comment->isReply() && Comments::canComment($viewer, $file),
            ],
        ];
    }

    /**
     * comment id => [{id, name}] for the names the client should decorate.
     *
     * @param  Collection<int, int>  $commentIds
     */
    private static function mentionMap(Collection $commentIds): array
    {
        if ($commentIds->isEmpty()) {
            return [];
        }

        $map = [];
        FileCommentMention::query()
            ->whereIn('comment_id', $commentIds)
            ->with('user:id,name')
            ->get()
            ->each(function ($m) use (&$map) {
                if ($m->user) {
                    $map[$m->comment_id][] = ['id' => $m->user->id, 'name' => $m->user->name];
                }
            });

        return $map;
    }

    /**
     * People the author may add to this file, by mentioning them in a comment,
     * or by asking them to review it.
     *
     * Two lists, decided by what the viewer may do:
     *
     *  - **Somebody who may share the file sees everyone**, whether or not the
     *    file has reached them yet, because they can bring anyone in: naming a
     *    person grants them access (AccessGrants). Restricting this list to
     *    people who already hold the file would hide precisely the colleague
     *    the sender opened the composer to find.
     *  - **Everybody else sees only people who can already open it**, so the
     *    composer never becomes a directory of names the viewer has no other
     *    way to see.
     *
     * `hasAccess` travels with each person so the composer can say, before the
     * sender commits, that picking them will give them access.
     *
     * The wide list is staff-only. A client can hold `full` over their own
     * upload, and the answer to "who else exists in this portal?" is not theirs
     * to browse, the firm's other clients are on that list.
     *
     * @return list<array>
     */
    public static function mentionable(FileItem $file, User $viewer, string $query = ''): array
    {
        $mayAddAnyone = FileAccess::isStaff($viewer) && FileAccess::can($viewer, 'share', $file);

        $candidates = User::query()
            ->where('status', User::STATUS_APPROVED)
            ->where('id', '!=', $viewer->id)
            ->when($query !== '', function ($q) use ($query) {
                $like = '%'.strtolower($query).'%';
                // LOWER(...) LIKE, not ILIKE: production is Postgres, tests are
                // SQLite, and ILIKE does not exist there.
                $q->where(function ($w) use ($like) {
                    $w->whereRaw('LOWER(name) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(email) LIKE ?', [$like]);
                });
            })
            ->orderBy('name')
            ->limit(60)
            ->get()
            ->map(fn (User $u) => ['user' => $u, 'access' => FileAccess::fileRole($u, $file)]);

        return $candidates
            ->filter(fn (array $c) => $mayAddAnyone || $c['access'] !== null)
            // People already on the file first: the everyday case is unchanged
            // by the wider search, rather than buried in it.
            ->sortBy(fn (array $c) => [$c['access'] === null ? 1 : 0, $c['user']->name])
            ->take(8)
            ->map(fn (array $c) => [
                'id' => $c['user']->id,
                'name' => $c['user']->name,
                'email' => $c['user']->email,
                'avatar' => $c['user']->photoUrl(),
                'hasAccess' => $c['access'] !== null,
            ])
            ->values()
            ->all();
    }
}
