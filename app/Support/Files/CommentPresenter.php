<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Shapes comment threads for the viewer.
 *
 * Bodies go out as plain text — never HTML. The client escapes them and then
 * decorates the mentioned names, so nothing a user typed can be interpreted as
 * markup in somebody else's browser.
 */
class CommentPresenter
{
    /**
     * One page of threads for a file, oldest first (reading order), with each
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
        // thread — this panel opens on every file, so it must not be N+1.
        $replies = $roots->isEmpty() ? collect() : FileComment::query()
            ->whereIn('root_id', $roots->pluck('id'))
            ->whereNotNull('parent_id')
            ->with(['author:id,name,email,avatar_url,provider_avatar_url'])
            ->orderBy('id')
            ->get()
            ->groupBy('root_id');

        $mentions = self::mentionMap($roots->pluck('id')->merge($replies->flatten()->pluck('id')));

        $threads = $roots
            // Query order is newest-first for the cursor; reading order is
            // oldest-first, so flip after paging rather than before.
            ->sortBy('id')
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
        \App\Models\FileCommentMention::query()
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
     * People the author may mention: those who can already open this file.
     *
     * Filtered server-side so the composer cannot become a directory of names
     * the viewer has no other way to see.
     *
     * @return list<array>
     */
    public static function mentionable(FileItem $file, User $viewer, string $query = ''): array
    {
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
            ->get();

        return $candidates
            ->filter(fn (User $u) => FileAccess::fileRole($u, $file) !== null)
            ->take(8)
            ->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'avatar' => $u->photoUrl(),
            ])
            ->values()
            ->all();
    }
}
