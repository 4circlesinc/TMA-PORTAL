<?php

namespace App\Support\Files\Workflow;

use App\Models\CipDocument;
use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileItem;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\FolderAccess;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\CommentReads;
use App\Support\Files\Comments;
use App\Support\Files\FileAccess;
use App\Support\Files\FileType;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Presenter;
use App\Support\Files\Thumbnail;
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
 *  - **Nothing here widens access.** Requests and comments are re-checked
 *    against {@see FileAccess} before they are returned. CIP documents
 *    waiting on an update use {@see ApplicationScope} instead, the same
 *    door as the application itself.
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

        // Every chain the access walk is about to climb, fetched a level at
        // a time for the whole page rather than a folder at a time per file.
        FileAccess::warmChains($rows->map(fn (FileWorkflow $w) => $w->file?->folder_id)->all());

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
     * @param  array{scope?:string,q?:string,cursor?:int,limit?:int,unread?:bool}  $filters
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

        $unreadOrder = [];

        if (! empty($filters['unread'])) {
            $unreadIds = CommentReads::latestUnreadCommentIds($viewer, self::OVERSCAN);
            if ($unreadIds->isEmpty()) {
                return [
                    'items' => [],
                    'nextCursor' => null,
                    'counts' => self::counts($viewer),
                    'canSeeAll' => $canSeeAll,
                ];
            }
            $unreadOrder = array_flip($unreadIds->map(fn ($id) => (int) $id)->all());
        }

        $query = FileComment::query()
            ->with([
                'author',
                'companyMember',
                'resolver:id,name',
                // Not withTrashed: a comment on a binned file loads a null
                // file and drops out below. The bin is where that history
                // belongs, not somebody's open-work list.
                'file:id,uuid,name,extension,folder_id,owner_id,review_status',
            ]);

        if ($scope !== self::COMMENTS_ALL) {
            $query->where(fn (Builder $q) => self::concernsMe($q, $viewer));
        }

        if ($unreadOrder !== []) {
            $query->whereIn('file_comments.id', array_keys($unreadOrder));
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

        FileAccess::warmChains($rows->map(fn (FileComment $c) => $c->file->folder_id)->all());

        $visible = self::filterByAccess($viewer, $rows, fn (FileComment $c) => $c->file);

        if ($unreadOrder !== []) {
            $visible = $visible->sortBy(fn (FileComment $c) => $unreadOrder[$c->id] ?? PHP_INT_MAX)->values();
        }

        $limit = self::pageSize($filters);
        $page = $visible->take($limit);
        $more = $visible->count() > $limit;

        $paths = self::folderPaths($page->map(fn (FileComment $c) => $c->file)->all());
        $mentions = self::mentionNames($page->pluck('id'));
        // The thread each reply belongs to, one query for the page rather than
        // one per reply.
        $threadUuids = FileComment::withTrashed()
            ->whereIn('id', $page->filter(fn (FileComment $c) => $c->isReply())->pluck('root_id')->filter()->unique()->all())
            ->pluck('uuid', 'id')
            ->all();

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

        $items = $page->map(function (FileComment $c) use ($viewer, $paths, $mentions, $unread, $threadUuids) {
            $row = self::comment($c, $viewer, $paths, $mentions, $threadUuids);
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
     * CIP documents currently marked Update required, across applications
     * this account may see.
     *
     * Feedback and Comments lists file comments, and that page defaults to
     * threads that name you. An officer requesting a clearer scan is not in
     * that set, so the reason never appeared there. This list is the
     * checklist question instead: which slots on files you hold still need
     * an update, and why. Access is {@see ApplicationScope}, the same door
     * as the application itself, not {@see FileAccess} — a reviewer who can
     * open the file in CIP can see the reason here even when the library
     * folder is assigned to someone else.
     *
     * @param  array{q?:string,cursor?:int,limit?:int}  $filters
     * @return array{items:array,nextCursor:?int,counts:array,canSeeAll:bool}
     */
    public static function updates(User $viewer, array $filters = []): array
    {
        $canSeeAll = FileAccess::isStaff($viewer);

        $query = CipDocument::query()
            ->where('cip_documents.status', DocumentStatus::UPDATE_REQUIRED)
            ->whereIn('cip_documents.application_id', ApplicationScope::query($viewer)->select('id'))
            ->with([
                'file:id,uuid,name,extension,folder_id,owner_id,review_note,review_status,deleted_at',
                'person:id,uuid,first_name,last_name,role,application_id',
                'application:id,uuid,internal_number,cip_number,status,client_id,provider_id',
                'application.client:id,uid,name',
            ]);

        if (! empty($filters['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim($filters['q'])).'%';
            $query->where(function (Builder $q) use ($like) {
                $q->where('cip_documents.label', 'like', $like)
                    ->orWhereHas('file', fn ($f) => $f->where('name', 'like', $like))
                    ->orWhereHas('person', function ($p) use ($like) {
                        $p->where('first_name', 'like', $like)
                            ->orWhere('last_name', 'like', $like);
                    })
                    ->orWhereHas('application', function ($a) use ($like) {
                        $a->where('internal_number', 'like', $like)
                            ->orWhere('cip_number', 'like', $like)
                            ->orWhereHas('client', fn ($c) => $c->where('name', 'like', $like));
                    });
            });
        }

        if (! empty($filters['cursor'])) {
            $query->where('cip_documents.id', '<', (int) $filters['cursor']);
        }

        /** @var EloquentCollection<int, CipDocument> $rows */
        $rows = $query->orderByDesc('cip_documents.id')->limit(self::OVERSCAN)->get();

        $limit = self::pageSize($filters);
        $page = $rows->take($limit);
        $more = $rows->count() > $limit;

        $reasons = DocumentComments::latestOpenBodies($page->pluck('id')->all());
        $paths = self::folderPaths(
            $page->map(fn (CipDocument $slot) => self::liveFile($slot))->all()
        );

        $items = $page->map(function (CipDocument $slot) use ($reasons, $paths) {
            $file = self::liveFile($slot);
            $reason = $reasons[$slot->id] ?? $file?->review_note;

            return [
                'id' => $slot->uuid,
                'kind' => 'cip',
                'label' => $slot->label,
                'reason' => is_string($reason) && trim($reason) !== '' ? trim($reason) : null,
                'status' => DocumentStatus::UPDATE_REQUIRED,
                'statusLabel' => DocumentStatus::label(DocumentStatus::UPDATE_REQUIRED),
                'person' => $slot->person?->fullName() ?: null,
                'required' => (bool) $slot->required,
                'application' => $slot->application ? [
                    'id' => $slot->application->uuid,
                    'number' => $slot->application->displayNumber(),
                    'clientUid' => $slot->application->client?->uid,
                ] : null,
                'file' => self::file($file, $paths),
                'updatedAt' => optional($slot->status_changed_at ?? $slot->updated_at)->toIso8601String(),
            ];
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
     * @return array{waiting:int,sent:int,mentions:int,unread:int,updates:int}
     */
    public static function counts(User $viewer): array
    {
        $waiting = FileWorkflowStep::query()
            ->where(function ($q) use ($viewer) {
                $q->where('user_id', $viewer->id);
                $memberIds = ContactIdentity::idsFor($viewer);
                if ($memberIds !== []) {
                    $q->orWhereIn('company_member_id', $memberIds);
                }
            })
            ->whereIn('status', ['pending', 'invited'])
            ->whereHas('workflow', fn ($q) => $q->whereNotIn('status', Status::TERMINAL))
            ->count();

        $sent = FileWorkflow::query()
            ->where(function ($q) use ($viewer) {
                $q->where('created_by', $viewer->id);
                $memberIds = ContactIdentity::idsFor($viewer);
                if ($memberIds !== []) {
                    $q->orWhereIn('created_by_member_id', $memberIds);
                }
            })
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
            'updates' => self::updateRequiredCount($viewer),
        ];
    }

    /* ── queries ──────────────────────────────────────────────── */

    /** Slots on applications this account may open that still need an update. */
    private static function updateRequiredCount(User $viewer): int
    {
        return CipDocument::query()
            ->where('cip_documents.status', DocumentStatus::UPDATE_REQUIRED)
            ->whereIn('cip_documents.application_id', ApplicationScope::query($viewer)->select('id'))
            ->count();
    }

    private static function liveFile(CipDocument $slot): ?FileItem
    {
        $file = $slot->file;

        if ($file === null || $file->deleted_at !== null) {
            return null;
        }

        return $file;
    }

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
                'sender',
                'senderMember',
                'version:id,version_number',
                'supersededByVersion:id,version_number',
                'steps.user',
                'steps.companyMember',
                'file:id,uuid,name,extension,folder_id,owner_id,review_status',
            ]);

        $memberIds = ContactIdentity::idsFor($viewer);

        match ($scope) {
            self::SCOPE_SENT => $query->where(function ($q) use ($viewer, $memberIds) {
                $q->where('file_workflows.created_by', $viewer->id);
                if ($memberIds !== []) {
                    $q->orWhereIn('file_workflows.created_by_member_id', $memberIds);
                }
            }),
            self::SCOPE_INBOX => $query->whereHas(
                'steps',
                function ($q) use ($viewer, $memberIds) {
                    $q->whereIn('status', ['pending', 'invited'])
                        ->where(function ($s) use ($viewer, $memberIds) {
                            $s->where('user_id', $viewer->id);
                            if ($memberIds !== []) {
                                $s->orWhereIn('company_member_id', $memberIds);
                            }
                        });
                }
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

    /**
     * Threads that concern this reader: they wrote in it, were named in it,
     * the file is theirs, or — for a service-provider contact — it sits in a
     * client tree their firm filed.
     *
     * CIP uploads are owned by the service account, so "the file is yours"
     * never fires for the contact who actually works the document. Without
     * the folder grant they would never see a reviewer's reason in Feedback
     * and Comments, even when the File Library already opens the file.
     *
     * Public because it is the definition of "yours" for comments, and the
     * unread count has to use the same one — a badge that counted a wider set
     * than the page it opens would send people looking for work that is not
     * listed anywhere. {@see CommentReads}
     */
    public static function concernsMe(Builder $query, User $viewer): void
    {
        /*
         * Every column is table-qualified. The unread count joins this against
         * file_comment_reads, which carries a root_id of its own, and a bare
         * name there is ambiguous — the kind of break that only appears once
         * somebody joins the query, which is exactly what happened.
         */
        $memberIds = ContactIdentity::idsFor($viewer);
        $clientIds = FileAccess::isStaff($viewer) ? [] : FolderAccess::clientIdsFor($viewer);

        $query
            ->where('file_comments.author_id', $viewer->id)
            ->when($memberIds !== [], fn (Builder $q) => $q->orWhereIn('file_comments.company_member_id', $memberIds))
            ->orWhereHas('mentions', fn ($m) => $m->where('file_comment_mentions.user_id', $viewer->id))
            ->orWhereHas('file', fn ($f) => $f->where('owner_id', $viewer->id))
            /*
             * Replies under a thread I started, and the thread under a reply I
             * wrote. Both directions matter: answering somebody's question
             * should keep the follow-up in front of me, and so should somebody
             * answering mine.
             */
            ->orWhereIn('file_comments.root_id', function ($sub) use ($viewer, $memberIds) {
                $sub->select('root_id')
                    ->from('file_comments as mine')
                    ->where(function ($q) use ($viewer, $memberIds) {
                        $q->where('mine.author_id', $viewer->id);
                        if ($memberIds !== []) {
                            $q->orWhereIn('mine.company_member_id', $memberIds);
                        }
                    })
                    ->whereNotNull('mine.root_id');
            })
            ->orWhereIn('file_comments.id', function ($sub) use ($viewer, $memberIds) {
                $sub->select('root_id')
                    ->from('file_comments as mine')
                    ->where(function ($q) use ($viewer, $memberIds) {
                        $q->where('mine.author_id', $viewer->id);
                        if ($memberIds !== []) {
                            $q->orWhereIn('mine.company_member_id', $memberIds);
                        }
                    })
                    ->whereNotNull('mine.root_id');
            });

        if ($clientIds !== []) {
            $query->orWhereHas(
                'file.folder',
                fn ($folder) => $folder->whereIn('folders.client_id', $clientIds),
            );

            if (CipAccess::enabled()) {
                $query->orWhereHas(
                    'file.cipDocument',
                    fn ($d) => $d->whereIn('application_id', ApplicationScope::query($viewer)->select('id')),
                );
            }
        }
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
        $memberIds = ContactIdentity::idsFor($viewer);
        $myStep = $workflow->steps->first(fn (FileWorkflowStep $s) => ContactIdentity::isSelf(
            $viewer, $s->user_id, $s->company_member_id, $memberIds,
        ));
        $waiting = $workflow->steps->filter(fn (FileWorkflowStep $s) => $s->isOpen());
        $isOpen = ! Status::isTerminal($workflow->status);
        $senderDrawn = ContactIdentity::present(
            $workflow->sender,
            $workflow->senderMember,
            $workflow->sender?->name,
        );
        $hasSender = $workflow->sender !== null
            || $workflow->senderMember !== null
            || $workflow->created_by
            || $workflow->created_by_member_id;

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
            'sender' => $hasSender ? [
                'name' => $senderDrawn['name'],
                'avatar' => $senderDrawn['avatar'],
                'isSelf' => ContactIdentity::isSelf(
                    $viewer, $workflow->created_by, $workflow->created_by_member_id, $memberIds,
                ),
            ] : null,
            'people' => $workflow->steps->map(fn (FileWorkflowStep $s) => [
                'name' => $s->user?->name ?? $s->companyMember?->displayName() ?? $s->name ?? $s->email,
                'avatar' => $s->user?->photoUrl(),
                'status' => $s->status,
                'statusLabel' => WorkflowPresenter::stepLabel($s->status),
                'comment' => $s->comment,
                'answered' => ! $s->isOpen(),
                'isSelf' => ContactIdentity::isSelf($viewer, $s->user_id, $s->company_member_id, $memberIds),
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
            $name = ContactIdentity::isSelf($viewer, $one->user_id, $one->company_member_id)
                ? 'you, once it reaches your turn'
                : ($one->user?->name ?? $one->companyMember?->displayName() ?? $one->name ?? $one->email ?? 'someone');

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

    /** @param  array<int, string>  $threadUuids  root comment id => uuid */
    private static function comment(FileComment $comment, User $viewer, array $paths, array $mentions, array $threadUuids): array
    {
        $file = $comment->file;
        $named = in_array($viewer->id, $mentions[$comment->id]['ids'] ?? [], true);
        $author = ContactIdentity::present(
            $comment->author,
            $comment->companyMember,
            $comment->author_name,
        );

        return [
            'id' => $comment->uuid,
            'body' => $comment->trashed() ? null : $comment->body,
            'deleted' => $comment->trashed(),
            'author' => [
                'name' => $author['name'],
                'avatar' => $author['avatar'],
                'isSelf' => ContactIdentity::isSelf($viewer, $comment->author_id, $comment->company_member_id),
            ],
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
                ? ($threadUuids[$comment->root_id] ?? null)
                : $comment->uuid,
        ];
    }

    /** @param  array<int, string>  $paths */
    private static function file(?FileItem $file, array $paths): ?array
    {
        if (! $file) {
            return null;
        }

        $ext = (string) $file->extension;

        return [
            'id' => $file->uuid,
            'name' => $file->name,
            'extension' => $ext,
            'mime' => $file->mime_type,
            'category' => FileType::category($ext),
            'size' => (int) $file->size,
            'folder' => $paths[$file->folder_id] ?? null,
            // What the File Library needs to open straight to it. Both halves
            // are required: the browser loads a folder, then looks for the file
            // inside the folder it just loaded.
            'folderId' => $paths['uuid:'.$file->folder_id] ?? null,
            'reviewStatus' => $file->review_status,
            // Same preview URLs the File Library cards use, so a PDF or photo
            // on this page can show a picture of itself instead of a chip.
            'thumbUrl' => Thumbnail::supportsExt($ext)
                ? Presenter::revisionedUrl('files.thumb', $file)
                : null,
            'previewUrl' => FileType::isPreviewable($ext)
                ? Presenter::revisionedUrl('files.preview', $file)
                : null,
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
