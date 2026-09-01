<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use App\Models\CipDocumentComment;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\Comments;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The conversation on one checklist document (§13).
 *
 * A separate thread from {@see Comments}, which talks about
 * a file. This talks about a *requirement*: the slot outlives the file in it,
 * so "we need a clearer scan of this" has to survive the clearer scan
 * arriving. Hanging the conversation off the file would lose it at the moment
 * it was answered, and would put it on a library object the provider side has
 * no reason to be reading.
 *
 * Threading is one level, exactly as file comments do it: a reply carries the
 * root it belongs to so a whole thread loads in one query, and a reply to a
 * reply is flattened onto the same root rather than growing a tree nobody asked
 * for.
 */
class DocumentComments
{
    /** Long enough for a reviewer's reasoning, short of an essay. */
    public const MAX_LENGTH = 4000;

    /**
     * Who may read and write a document's thread.
     *
     * The same answer for both, and the same answer as "may you see this
     * application at all". §13 exists so the provider side can be told what is
     * wrong with a document and reply about it; a conversation only the firm
     * could join would be a notes field with extra steps.
     */
    public static function canJoin(?User $user, CipDocument $document): bool
    {
        if ($user === null) {
            return false;
        }

        return ApplicationScope::query($user)
            ->whereKey($document->application_id)
            ->exists();
    }

    /** The author, or an administrator clearing up after somebody. */
    public static function canEdit(User $user, CipDocumentComment $comment): bool
    {
        return ContactIdentity::isSelf($user, $comment->author_id, $comment->company_member_id)
            || Role::isAdmin($user);
    }

    /**
     * One comment, or a reply to one.
     *
     * `replies_count` is kept on the root rather than counted on read: a
     * checklist draws the count for every document on the page, and counting
     * per thread would be a query per row.
     */
    public static function create(
        CipDocument $document,
        User $author,
        string $body,
        ?CipDocumentComment $parent = null,
    ): CipDocumentComment {
        $body = trim($body);

        // The same absorb as Files\Comments::create — a send button pressed
        // again while the first request is still on the wire is a resend of
        // one comment, not a second comment.
        $resent = CipDocumentComment::where('document_id', $document->id)
            ->where('author_id', $author->id)
            ->when($parent,
                fn ($q) => $q->where('parent_id', $parent->id),
                fn ($q) => $q->whereNull('parent_id'))
            ->where('body', $body)
            ->where('created_at', '>=', now()->subSeconds(10))
            ->whereNull('deleted_at')
            ->latest('id')
            ->first();

        if ($resent) {
            return $resent;
        }

        return DB::transaction(function () use ($document, $author, $body, $parent) {
            /*
             * A reply to a reply belongs to the same conversation as the one
             * it answers, not to a third level nobody will read in a table
             * cell. Taken from the id rather than by loading the root: a
             * reply already carries its root, and asking the relation for it
             * is both a query and, when the parent IS the root, and so has no
             * root_id, an answer of null that would strand the comment
             * outside every thread.
             */
            $rootId = $parent ? ($parent->root_id ?: $parent->id) : null;

            $document->loadMissing('application.provider');
            $stamp = ContactIdentity::stamp(
                $author,
                ContactIdentity::companyIdForApplication($document->application),
            );

            $comment = CipDocumentComment::create([
                'uuid' => (string) Str::uuid(),
                'document_id' => $document->id,
                'author_id' => $author->id,
                'company_member_id' => $stamp['company_member_id'],
                'author_name' => $stamp['actor_name'],
                'parent_id' => $parent?->id,
                'root_id' => $rootId,
                'body' => trim($body),
            ]);

            if ($rootId) {
                CipDocumentComment::whereKey($rootId)->increment('replies_count');
            }

            return $comment;
        });
    }

    /**
     * A thread, roots first with their replies under them.
     *
     * Two queries whatever the size of the conversation, the roots, then
     * every reply on the document at once, matched up in memory.
     */
    public static function thread(CipDocument $document, User $viewer): array
    {
        $all = $document->comments()
            ->with(['author', 'companyMember'])
            ->orderBy('id')
            ->get();
        $viewerMemberIds = ContactIdentity::idsFor($viewer);

        $repliesByRoot = $all->filter(fn (CipDocumentComment $c) => $c->parent_id !== null)
            ->groupBy('root_id');

        return $all
            ->filter(fn (CipDocumentComment $c) => $c->parent_id === null)
            ->map(fn (CipDocumentComment $root) => self::present($root, $viewer, $viewerMemberIds) + [
                'replies' => ($repliesByRoot[$root->id] ?? collect())
                    ->map(fn (CipDocumentComment $r) => self::present($r, $viewer, $viewerMemberIds))
                    ->values()->all(),
            ])
            ->values()
            ->all();
    }

    /** @param  list<int>  $viewerMemberIds */
    public static function present(CipDocumentComment $comment, User $viewer, ?array $viewerMemberIds = null): array
    {
        $author = ContactIdentity::present(
            $comment->author,
            $comment->companyMember,
            $comment->author_name,
        );

        return [
            'id' => $comment->uuid,
            'body' => $comment->body,
            'author' => [
                'name' => $author['name'],
                'email' => $author['email'],
                'avatar' => $author['avatar'],
            ],
            'mine' => ContactIdentity::isSelf(
                $viewer,
                $comment->author_id,
                $comment->company_member_id,
                $viewerMemberIds,
            ),
            'canEdit' => self::canEdit($viewer, $comment),
            'edited' => $comment->edited_at !== null,
            'resolved' => $comment->isResolved(),
            'resolvedBy' => $comment->resolver?->name,
            'repliesCount' => (int) $comment->replies_count,
            'createdAt' => $comment->created_at?->toIso8601String(),
        ];
    }

    /**
     * How many open comments a document carries.
     *
     * "Open" rather than "all", because the checklist uses this to decide
     * whether a row needs attention, and a document whose questions were all
     * answered and resolved does not.
     *
     * @param  array<int, int>  $documentIds
     * @return array<int, int> document id => open comment count
     */
    public static function openCounts(array $documentIds): array
    {
        if (! $documentIds) {
            return [];
        }

        return CipDocumentComment::query()
            ->whereIn('document_id', $documentIds)
            ->whereNull('resolved_at')
            ->selectRaw('document_id, COUNT(*) as total')
            ->groupBy('document_id')
            ->pluck('total', 'document_id')
            ->map(fn ($n) => (int) $n)
            ->all();
    }

    /**
     * The latest open reason on each slot, for the checklist and Overview.
     *
     * One query for the family rather than one per row: a main applicant
     * owes a dozen documents, and the reason has to ride with the chip.
     *
     * @param  array<int, int>  $documentIds
     * @return array<int, string> document id => body
     */
    public static function latestOpenBodies(array $documentIds): array
    {
        $documentIds = array_values(array_filter(array_map('intval', $documentIds)));
        if ($documentIds === []) {
            return [];
        }

        $latestIds = CipDocumentComment::query()
            ->selectRaw('MAX(id) as id')
            ->whereIn('document_id', $documentIds)
            ->whereNull('parent_id')
            ->whereNull('resolved_at')
            ->groupBy('document_id')
            ->pluck('id');

        if ($latestIds->isEmpty()) {
            return [];
        }

        return CipDocumentComment::query()
            ->whereIn('id', $latestIds)
            ->pluck('body', 'document_id')
            ->all();
    }
}
