<?php

namespace App\Support\Files\Workflow;

use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\Comments;
use App\Support\Files\CommentReads;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Requests and discussion gathered across the whole library, rather than one
 * file at a time.
 *
 * {@see WorkflowPresenter} answers "what is happening to THIS file", which is
 * the right question once you already have the file open. It is the wrong
 * question for somebody arriving in the morning: they do not know which of
 * forty thousand documents is waiting on them, and there is no sequence of
 * clicks in a file browser that will tell them. That is what this answers —
 * everything addressed to you, everything you asked of other people, and the
 * conversations you are part of, in one list.
 *
 * Three rules hold it together:
 *
 *  - **Nothing here widens access.** Every row is re-checked against
 *    {@see FileAccess} before it is returned, after the query, so a workflow
 *    on a file you can no longer open simply does not appear. The database
 *    query narrows; it never authorizes.
 *  - **The page size is the unit of work.** Access is per-file and cannot be
 *    expressed in SQL, so it is applied to a page of rows and never to the
 *    whole table. A library of forty thousand files must not be walked to
 *    render twenty rows.
 *  - **Actions are not reimplemented.** Every row carries its file's uuid, so
 *    responding, cancelling, replying and resolving all go back through the
 *    per-file endpoints that already enforce these rules. This class reads.
 */
final class Hub
{
    /** Requests addressed to you and still waiting. */
    public const SCOPE_INBOX = 'inbox';

    /** Requests you sent to other people. */
    public const SCOPE_SENT = 'sent';

    /** Everything on files you can open, staff only. */
    public const SCOPE_ALL = 'all';

    public const SCOPES = [self::SCOPE_INBOX, self::SCOPE_SENT, self::SCOPE_ALL];

    /** Comments that concern you: naming you, answering you, or on your files. */
    public const COMMENTS_MINE = 'mine';

    /** The same set, narrowed to threads nobody has closed off. */
    public const COMMENTS_UNRESOLVED = 'unresolved';

    /** All recent discussion on files you can open, staff only. */
    public const COMMENTS_ALL = 'all';

    public const COMMENT_SCOPES = [self::COMMENTS_MINE, self::COMMENTS_UNRESOLVED, self::COMMENTS_ALL];

    /**
     * How many rows are fetched per page before access filtering.
     *
     * Over-fetching is deliberate: some of what the query returns will be
     * dropped by the access check, and a page that renders four rows because
     * sixteen were filtered out reads as a bug. The page is trimmed back to
     * PAGE afterwards.
     */
    private const PAGE = 20;

    private const OVERSCAN = 60;

    /**
     * @param  array{scope?:string,type?:string,state?:string,q?:string,cursor?:int,limit?:int}  $filters
     * @return array{items:array,nextCursor:?int,counts:array,canSeeAll:bool}
     */
    public static function requests(User $viewer, array $filters = []): array
    {
        $scope = in_array($filters['scope'] ?? '', self::SCOPES, true)
            ? $filters['scope']
            : self::SCOPE_INBOX;

        $canSeeAll = FileAccess::isStaff($viewer);

        // Asked for everything without being staff: fall back to your own
        // rather than erroring. A client following a stale link gets their
        // list, not a wall.
        if ($scope === self::SCOPE_ALL && ! $canSeeAll) {
            $scope = self::SCOPE_INBOX;
        }

        $query = self::baseQuery($viewer, $scope, $filters);

        if (! empty($filters['cursor'])) {
            $query->where('file_workflows.id', '<', (int) $filters['cursor']);
        }

        /** @var EloquentCollection<int, FileWorkflow> $rows */
        $rows = $query->orderByDesc('file_workflows.id')
            ->limit(self::OVERSCAN)
            ->get();

        $visible = self::filterByAccess($viewer, $rows, fn (FileWorkflow $w) => $w->file);

        $limit = self::pageSize($filters);
        $page = $visible->take($limit);
        // Only claim there is more when this page was actually full; a short
        // page after access filtering means the query is exhausted.
        $more = $rows->count() >= self::OVERSCAN && $visible->count() > $limit;

        $paths = self::folderPaths($page->map(fn (FileWorkflow $w) => $w->file)->all());

        return [
            'items' => $page->map(fn (FileWorkflow $w) => self::request($w, $viewer, $paths))->values()->all(),
            'nextCursor' => $more ? (int) $page->last()->id : null,
            'counts' => self::counts($viewer),
            'canSeeAll' => $canSeeAll,
        ];
    }

    /**
     * @param  array{scope?:string,q?:string,cursor?:int,limit?:int}  $filters
     * @return array{items:array,nextCursor:?int,counts:array,canSeeAll:bool}
     */
    public static function comments(User $viewer, array $filters = []): array
    {
        $scope = in_array($filters['scope'] ?? '', self::COMMENT_SCOPES, true)
            ? $filters['scope']
            : self::COMMENTS_MINE;

        $canSeeAll = FileAccess::isStaff($viewer);

        if ($scope === self::COMMENTS_ALL && ! $canSeeAll) {
            $scope = self::COMMENTS_MINE;
        }

        $query = FileComment::query()
            ->with([
                'author:id,name,email,avatar_url,provider_avatar_url',
                'resolver:id,name',
                // Not withTrashed: a comment on a binned file loads a null
                // file and drops out below. The bin is where that history
                // belongs, not somebody's open-work list.
                'file:id,uuid,name,extension,folder_id,owner_id,review_status',
            ]);

        if ($scope !== self::COMMENTS_ALL) {
            $query->where(fn (Builder $q) => self::concernsMe($q, $viewer));
        }

        if ($scope === self::COMMENTS_UNRESOLVED) {
            /*
             * A reply is not a thread. Resolution lives on the top-level
             * comment, so "unresolved" has to be asked of the root, a reply
             * under a closed thread is closed too, and listing it would put
             * settled work back on somebody's plate.
             */
            $query->whereNull('parent_id')->whereNull('resolved_at');
        }

        if (! empty($filters['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($filters['q'])).'%';
            $query->where(function (Builder $q) use ($like) {
                $q->where('body', 'like', $like)
                    ->orWhereHas('file', fn ($f) => $f->where('name', 'like', $like));
            });
        }

        if (! empty($filters['cursor'])) {
            $query->where('id', '<', (int) $filters['cursor']);
        }

        /** @var EloquentCollection<int, FileComment> $rows */
        $rows = $query->orderByDesc('id')->limit(self::OVERSCAN)->get();

        // A comment whose file has been deleted is history, not an open thread.
        $rows = $rows->filter(fn (FileComment $c) => $c->file !== null)->values();

        $visible = self::filterByAccess($viewer, $rows, fn (FileComment $c) => $c->file);

        $limit = self::pageSize($filters);
        $page = $visible->take($limit);
        $more = $visible->count() > $limit;

        $paths = self::folderPaths($page->map(fn (FileComment $c) => $c->file)->all());
        $mentions = self::mentionNames($page->pluck('id'));

        /*
         * Read state per row — and asking for it does not spend it.
         *
         * This listing used to mark everything read as it served it, which made
         * the state impossible to draw: by the time a card reached the screen it
         * was already read, so every card looked alike and nothing told the
         * reader what was new. Listing is not reading, the same way a page of
         * notifications is not. A thread turns read when it is opened — from
         * here, from the file, by replying to it, or by resolving it.
         */
        $unread = CommentReads::unreadThreads(
            $viewer,
            $page->map(fn (FileComment $c) => $c->root_id ?? $c->id)
        );

        $items = $page->map(function (FileComment $c) use ($viewer, $paths, $mentions, $unread) {
            $row = self::comment($c, $viewer, $paths, $mentions);
            $row['unread'] = isset($unread[$c->root_id ?? $c->id]);

            return $row;
        })->values()->all();

        return [
            'items' => $items,
            'nextCursor' => $more ? (int) $page->last()->id : null,
            'counts' => self::counts($viewer),
            'canSeeAll' => $canSeeAll,
        ];
    }

    /**
     * The numbers on the tabs.
     *
     * Deliberately unfiltered by access: they count rows that name this person
     * directly, their own open steps, their own sent requests, comments that
     * named them, none of which can exist on a file they were never given.
     * Running the per-file check over every one of them to render three
     * numbers would cost more than the page it labels.
     *
     * @return array{waiting:int,sent:int,mentions:int,unread:int}
     */
    public static function counts(User $viewer): array
    {
        $waiting = FileWorkflowStep::query()
            ->where('user_id', $viewer->id)
            ->whereIn('status', ['pending', 'invited'])
            ->whereHas('workflow', fn ($q) => $q->whereNotIn('status', Status::TERMINAL))
            ->count();

        $sent = FileWorkflow::query()
            ->where('created_by', $viewer->id)
            ->whereNotIn('status', Status::TERMINAL)
            ->count();

        /*
         * Unsettled rather than unread: the portal has no per-comment read
         * marker, and inventing one here would make the badge a guess.
         *
         * Resolution lives on the thread's first comment, so a mention inside
         * a reply has to be judged by its root, otherwise closing a thread
         * would leave its replies still counted, and the badge would never
         * reach zero.
         */
        $mentions = FileCommentMention::query()
            ->where('file_comment_mentions.user_id', $viewer->id)
            ->whereHas('comment', fn ($q) => $q->where(function (Builder $w) {
                $w->where(fn (Builder $x) => $x->whereNull('parent_id')->whereNull('resolved_at'))
                    ->orWhereIn('root_id', fn ($sub) => $sub->select('id')
                        ->from('file_comments')
                        ->whereNull('resolved_at')
                        ->whereNull('deleted_at'));
            }))
            ->count();

        /*
         * What the badge actually counts.
         *
         * `mentions` is kept because the Involving-you tab still wants to say
         * how many name you outright, but it was never a badge: it fires only
         * on an explicit @, so a thread you started and somebody answered
         * counted as nothing, and no amount of reading could clear one that
         * did. `unread` is the honest number — threads that concern you with
         * something in them you have not seen — and it goes down as you read.
         */
        return [
            'waiting' => $waiting,
            'sent' => $sent,
            'mentions' => $mentions,
            'unread' => CommentReads::unreadCount($viewer),
        ];
    }

    /* ── queries ──────────────────────────────────────────────── */

    /**
     * How many rows the caller wants back, capped at the page size.
     *
     * The cap is the point: the overscan above is sized for one page, so a
     * caller asking for more than PAGE would be handed a page that quietly
     * stops short of what it asked for.
     *
     * @param  array{limit?:int}  $filters
     */
    private static function pageSize(array $filters): int
    {
        $limit = (int) ($filters['limit'] ?? self::PAGE);

        return max(1, min(self::PAGE, $limit));
    }

    private static function baseQuery(User $viewer, string $scope, array $filters): Builder
    {
        $query = FileWorkflow::query()
            ->with([
                'sender:id,name,email,avatar_url,provider_avatar_url',
                'version:id,version_number',
                'supersededByVersion:id,version_number',
                'steps.user:id,name,email,avatar_url,provider_avatar_url',
                'file:id,uuid,name,extension,folder_id,owner_id,review_status',
            ]);

        match ($scope) {
            self::SCOPE_SENT => $query->where('file_workflows.created_by', $viewer->id),
            self::SCOPE_INBOX => $query->whereHas(
                'steps',
                fn ($q) => $q->where('user_id', $viewer->id)->whereIn('status', ['pending', 'invited'])
            )->whereNotIn('file_workflows.status', Status::TERMINAL),
            default => null,
        };

        // "Open" is the default on every scope but the inbox, which is open by
        // construction, a settled request is not waiting on anybody.
        $state = $filters['state'] ?? 'open';
        if ($state === 'open') {
            $query->whereNotIn('file_workflows.status', Status::TERMINAL);
        } elseif ($state === 'closed') {
            $query->whereIn('file_workflows.status', Status::TERMINAL);
        }

        if (! empty($filters['type']) && in_array($filters['type'], Status::TYPES, true)) {
            $query->where('file_workflows.type', $filters['type']);
        }

        // Two types under one filter: the sidebar row is called "Feedback and
        // Approval", and splitting it into two half-empty lists would answer a
        // question nobody asked.
        if (($filters['type'] ?? '') === 'feedback_approval') {
            $query->whereIn('file_workflows.type', [Status::TYPE_FEEDBACK, Status::TYPE_APPROVAL]);
        }

        if (! empty($filters['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($filters['q'])).'%';
            $query->whereHas('file', fn ($f) => $f->where('name', 'like', $like));
        }

        // A request on a file somebody has binned is not actionable. It stays
        // in the file's own history, where the context makes sense of it —
        // whereHas on a soft-deleting relation already excludes it.
        $query->whereHas('file');

        return $query;
    }

    /** Comments that name me, answer me, or sit on a file I own. */
    /**
     * Threads that concern this reader: they wrote in it, were named in it, or
     * the file is theirs.
     *
     * Public because it is the definition of "yours" for comments, and the
     * unread count has to use the same one — a badge that counted a wider set
     * than the page it opens would send people looking for work that is not
     * listed anywhere. {@see \App\Support\Files\CommentReads}
     */
    public static function concernsMe(Builder $query, User $viewer): void
    {
        /*
         * Every column is table-qualified. The unread count joins this against
         * file_comment_reads, which carries a root_id of its own, and a bare
         * name there is ambiguous — the kind of break that only appears once
         * somebody joins the query, which is exactly what happened.
         */
        $query
            ->where('file_comments.author_id', $viewer->id)
            ->orWhereHas('mentions', fn ($m) => $m->where('file_comment_mentions.user_id', $viewer->id))
            ->orWhereHas('file', fn ($f) => $f->where('owner_id', $viewer->id))
            /*
             * Replies under a thread I started, and the thread under a reply I
             * wrote. Both directions matter: answering somebody's question
             * should keep the follow-up in front of me, and so should somebody
             * answering mine.
             */
            ->orWhereIn('file_comments.root_id', function ($sub) use ($viewer) {
                $sub->select('root_id')
                    ->from('file_comments as mine')
                    ->where('mine.author_id', $viewer->id)
                    ->whereNotNull('mine.root_id');
            })
            ->orWhereIn('file_comments.id', function ($sub) use ($viewer) {
                $sub->select('root_id')
                    ->from('file_comments as mine')
                    ->where('mine.author_id', $viewer->id)
                    ->whereNotNull('mine.root_id');
            });
    }

    /**
     * Drop everything the viewer may not open.
     *
     * @template T of \Illuminate\Database\Eloquent\Model
     *
     * @param  Collection<int, T>  $rows
     * @param  callable(T): ?FileItem  $fileOf
     * @return Collection<int, T>
     */
    private static function filterByAccess(User $viewer, Collection $rows, callable $fileOf): Collection
    {
        $allowed = [];

        return $rows->filter(function ($row) use ($viewer, $fileOf, &$allowed) {
            $file = $fileOf($row);
            if (! $file) {
                return false;
            }

            // Several requests and a whole thread commonly sit on one file;
            // resolving its role once is the difference between twenty access
            // walks and three.
            if (! array_key_exists($file->id, $allowed)) {
                $allowed[$file->id] = FileAccess::fileRole($viewer, $file) !== null;
            }

            return $allowed[$file->id];
        })->values();
    }

    /* ── presentation ─────────────────────────────────────────── */

    /**
     * One request, told as a sentence rather than a state name.
     *
     * The viewer's panel already learned this lesson: "Awaiting approval" names
     * an internal state and leaves the reader to work out whether it is their
     * problem. Away from the file it is worse, because there is no context at
     * all, so every row leads with whose turn it is.
     */
    private static function request(FileWorkflow $workflow, User $viewer, array $paths): array
    {
        $mine = Engine::stepFor($workflow, $viewer);
        $myStep = $workflow->steps->firstWhere('user_id', $viewer->id);
        $waiting = $workflow->steps->filter(fn (FileWorkflowStep $s) => $s->isOpen());
        $isOpen = ! Status::isTerminal($workflow->status);

        return [
            'id' => $workflow->uuid,
            'type' => $workflow->type,
            'typeLabel' => ucfirst($workflow->type),
            'status' => $workflow->status,
            'statusLabel' => Status::label($workflow->status),
            'tone' => Status::tone($workflow->status),
            'headline' => self::headline($workflow, $viewer, $mine !== null, $waiting),
            'message' => $workflow->message,
            'file' => self::file($workflow->file, $paths),
            'sender' => $workflow->sender ? [
                'name' => $workflow->sender->name,
                'avatar' => $workflow->sender->photoUrl(),
                'isSelf' => $workflow->sender->id === $viewer->id,
            ] : null,
            'people' => $workflow->steps->map(fn (FileWorkflowStep $s) => [
                'name' => $s->user?->name ?? $s->name ?? $s->email,
                'avatar' => $s->user?->photoUrl(),
                'status' => $s->status,
                'statusLabel' => WorkflowPresenter::stepLabel($s->status),
                'comment' => $s->comment,
                'answered' => ! $s->isOpen(),
                'isSelf' => $s->user_id === $viewer->id,
            ])->values()->all(),
            'answered' => $workflow->steps->count() - $waiting->count(),
            'total' => $workflow->steps->count(),
            'sentAt' => optional($workflow->created_at)->toIso8601String(),
            'dueAt' => optional($workflow->due_at)->toIso8601String(),
            'overdue' => $workflow->due_at !== null && $workflow->due_at->isPast() && $isOpen,
            'completedAt' => optional($workflow->completed_at)->toIso8601String(),
            'version' => $workflow->version?->version_number,
            'supersededBy' => $workflow->supersededByVersion?->version_number,
            'requireComment' => (bool) $workflow->require_comment,
            'isOpen' => $isOpen,
            // What this reader can do about it, from here, right now. `myStep`
            // is null while an ordered flow has not reached them, they are on
            // the request, but it is not yet their turn.
            'myStep' => $mine?->uuid,
            'myActions' => $mine ? Status::actionsFor($workflow->type) : [],
            'onMe' => $myStep !== null && $myStep->isOpen(),
            'notYourTurn' => $mine === null && $myStep !== null && $myStep->isOpen(),
            'canCancel' => $isOpen && Engine::canManage($viewer, $workflow),
        ];
    }

    /** @param  Collection<int, FileWorkflowStep>  $waiting */
    private static function headline(FileWorkflow $workflow, User $viewer, bool $isMine, Collection $waiting): array
    {
        if (Status::isTerminal($workflow->status)) {
            return ['text' => Status::label($workflow->status), 'tone' => Status::tone($workflow->status)];
        }

        if ($isMine) {
            return ['text' => 'Your response is needed', 'tone' => 'action'];
        }

        if ($waiting->count() === 1) {
            $one = $waiting->first();
            $name = $one->user_id === $viewer->id
                ? 'you, once it reaches your turn'
                : ($one->user?->name ?? $one->name ?? $one->email ?? 'someone');

            return ['text' => 'Waiting on '.$name, 'tone' => Status::tone($workflow->status)];
        }

        if ($waiting->count() > 1) {
            return [
                'text' => 'Waiting on '.$waiting->count().' people',
                'tone' => Status::tone($workflow->status),
            ];
        }

        return ['text' => Status::label($workflow->status), 'tone' => Status::tone($workflow->status)];
    }

    private static function comment(FileComment $comment, User $viewer, array $paths, array $mentions): array
    {
        $file = $comment->file;
        $named = in_array($viewer->id, $mentions[$comment->id]['ids'] ?? [], true);

        return [
            'id' => $comment->uuid,
            'body' => $comment->trashed() ? null : $comment->body,
            'deleted' => $comment->trashed(),
            'author' => $comment->author ? [
                'name' => $comment->author->name,
                'avatar' => $comment->author->photoUrl(),
                'isSelf' => $comment->author->id === $viewer->id,
            ] : null,
            'mentions' => $mentions[$comment->id]['names'] ?? [],
            'mentionsMe' => $named,
            'file' => self::file($file, $paths),
            'createdAt' => optional($comment->created_at)->toIso8601String(),
            'editedAt' => optional($comment->edited_at)->toIso8601String(),
            'resolved' => $comment->isResolved(),
            'resolvedBy' => $comment->resolver?->name,
            'isReply' => $comment->isReply(),
            'replyCount' => (int) $comment->replies_count,
            'can' => [
                // A reply from here goes on the thread, never as a reply to a
                // reply, the store endpoint threads one level and would
                // re-parent it anyway.
                'reply' => $file !== null && Comments::canComment($viewer, $file),
                'resolve' => ! $comment->trashed() && ! $comment->isReply()
                    && $file !== null && Comments::canResolve($viewer, $comment, $file),
            ],
            // The thread this belongs to, so a reply from the list lands in the
            // right place rather than starting a new one.
            'threadId' => $comment->isReply()
                ? FileComment::withTrashed()->whereKey($comment->root_id)->value('uuid')
                : $comment->uuid,
        ];
    }

    /** @param  array<int, string>  $paths */
    private static function file(?FileItem $file, array $paths): ?array
    {
        if (! $file) {
            return null;
        }

        return [
            'id' => $file->uuid,
            'name' => $file->name,
            'extension' => $file->extension,
            'folder' => $paths[$file->folder_id] ?? null,
            // What the File Library needs to open straight to it. Both halves
            // are required: the browser loads a folder, then looks for the file
            // inside the folder it just loaded.
            'folderId' => $paths['uuid:'.$file->folder_id] ?? null,
            'reviewStatus' => $file->review_status,
        ];
    }

    /**
     * folder id => "Citizenship By Investment Application / Acme Ltd", plus
     * "uuid:<id>" => folder uuid.
     *
     * One query for the whole page rather than walking each file's ancestry on
     * its own; the trail is short and the parents repeat heavily.
     *
     * @param  array<int, ?FileItem>  $files
     * @return array<int|string, ?string>
     */
    private static function folderPaths(array $files): array
    {
        $ids = collect($files)->filter()->pluck('folder_id')->filter()->unique();

        if ($ids->isEmpty()) {
            return [];
        }

        $index = [];
        $wanted = $ids->all();

        // Walk up a generation at a time. Depth is small and bounded by the
        // guard below; the alternative is one query per file per level.
        for ($depth = 0; $depth < 12 && $wanted !== []; $depth++) {
            $rows = Folder::withTrashed()
                ->whereIn('id', $wanted)
                ->get(['id', 'uuid', 'name', 'parent_id', 'folder_type']);

            $wanted = [];
            foreach ($rows as $folder) {
                $index[$folder->id] = $folder;
                if ($folder->parent_id && ! isset($index[$folder->parent_id])) {
                    $wanted[] = $folder->parent_id;
                }
            }
        }

        $paths = [];
        foreach ($ids as $id) {
            $trail = [];
            $node = $index[$id] ?? null;
            $seen = [];

            while ($node && ! isset($seen[$node->id])) {
                $seen[$node->id] = true;
                array_unshift($trail, FolderProvisioner::displayName($node));
                $node = $node->parent_id ? ($index[$node->parent_id] ?? null) : null;
            }

            $paths[$id] = $trail === [] ? null : implode(' / ', $trail);
            $paths['uuid:'.$id] = ($index[$id] ?? null)?->uuid;
        }

        return $paths;
    }

    /**
     * comment id => the people it named.
     *
     * @param  Collection<int, int>  $commentIds
     * @return array<int, array{ids:array<int,int>,names:array<int,string>}>
     */
    private static function mentionNames(Collection $commentIds): array
    {
        if ($commentIds->isEmpty()) {
            return [];
        }

        $map = [];

        FileCommentMention::query()
            ->whereIn('comment_id', $commentIds->all())
            ->with('user:id,name')
            ->get()
            ->each(function (FileCommentMention $m) use (&$map) {
                if (! $m->user) {
                    return;
                }
                $map[$m->comment_id]['ids'][] = $m->user->id;
                $map[$m->comment_id]['names'][] = $m->user->name;
            });

        return $map;
    }
}
