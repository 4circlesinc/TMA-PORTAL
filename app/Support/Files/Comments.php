<?php

namespace App\Support\Files;

use App\Events\FileCommentChanged;
use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Companies\ContactIdentity;
use App\Support\Files\Workflow\Hub;
use App\Support\Notifications\Notifier;
use App\Support\Realtime\Live;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Comment threads on a file: writing, editing, resolving, and telling the right
 * people about it.
 *
 * Two rules here are load-bearing and easy to get wrong:
 *
 *  - **A mention never reaches someone the author could not have shared with.**
 *    Mentions arrive as user ids from the composer, and the composer's
 *    suggestion list is itself filtered, but the list is a courtesy, not the
 *    control. Every mention runs through AccessGrants before it is stored: an
 *    author who may share the file brings the named person in and access
 *    follows, while one who may not cannot notify a stranger at all (and so
 *    cannot, through the notification's own text, leak the file's name).
 *
 *  - **Bodies are stored and returned as plain text, never markup.** The client
 *    escapes and then decorates the mentioned names. Nothing a user types is
 *    ever interpreted as HTML, so a comment cannot smuggle a script into
 *    anybody else's viewer.
 */
class Comments
{
    public const MAX_LENGTH = 4000;

    /** Comments (threads) per page. */
    public const PER_PAGE = 20;

    /**
     * Post a comment or a reply.
     *
     * @param  list<int>  $mentionIds  user ids the composer marked
     */
    public static function create(
        FileItem $file,
        User $author,
        string $body,
        ?FileComment $parent = null,
        array $mentionIds = [],
        ?array $anchor = null,
    ): FileComment {
        $body = trim($body);

        /*
         * The same words from the same person in the same place, seconds
         * apart, are one comment pressed twice — a send button clicked again
         * while the first request was still crossing the wire — not two
         * comments. Absorb the resend into the row it duplicates, whatever
         * client it came from; the caller gets a comment back either way.
         */
        $resent = FileComment::where('file_id', $file->id)
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

        $comment = DB::transaction(function () use ($file, $author, $body, $parent, $mentionIds, $anchor) {
            $stamp = ContactIdentity::stamp($author, ContactIdentity::companyIdForFile($file));

            $comment = FileComment::create([
                'uuid' => (string) Str::uuid(),
                'file_id' => $file->id,
                'author_id' => $author->id,
                'company_member_id' => $stamp['company_member_id'],
                'author_name' => $stamp['actor_name'],
                'parent_id' => $parent?->id,
                // Threading is one level deep: replying to a reply attaches to
                // the same root, so a thread never becomes an endless indent.
                'root_id' => $parent ? ($parent->root_id ?? $parent->id) : null,
                'body' => $body,
                // Only a thread points at the document, a reply is about the
                // conversation, and it inherits its thread's anchor by being
                // in it.
                'anchor' => $parent ? null : $anchor,
            ]);

            // A top-level comment is its own root, which makes "load one whole
            // thread" a single indexed query.
            if (! $parent) {
                $comment->update(['root_id' => $comment->id]);
            } else {
                FileComment::where('id', $parent->root_id ?? $parent->id)->increment('replies_count');
            }

            self::syncMentions($comment, $file, $mentionIds);

            return $comment;
        });

        Activity::forFile($author->id, $file, $parent ? 'comment-reply' : 'comment', [
            'comment' => $comment->uuid,
        ]);

        self::notify($comment->fresh(), $file, $author, $parent);
        self::broadcast($file, $comment, 'created');
        self::signal($file, $comment->fresh());

        /*
         * Writing in a thread means you have read it.
         *
         * Your own comment was never unread to you, but anything already in the
         * thread was — answering somebody's question and still being told the
         * question is waiting is the sort of thing that teaches people to stop
         * trusting the badge.
         */
        CommentReads::markThreadsRead($author, [$comment->root_id ?? $comment->id]);

        return $comment;
    }

    public static function update(FileComment $comment, User $editor, string $body, array $mentionIds = []): FileComment
    {
        $file = $comment->file;

        DB::transaction(function () use ($comment, $body, $mentionIds, $file) {
            $comment->update(['body' => trim($body), 'edited_at' => now()]);
            self::syncMentions($comment, $file, $mentionIds);
        });

        self::broadcast($file, $comment->fresh(), 'updated');
        self::signal($file, $comment->fresh());

        return $comment->fresh();
    }

    /**
     * Soft-delete, and blank the body.
     *
     * The row stays so replies beneath it keep their place in the thread, but
     * the text must actually go, a "deleted" comment whose words are still in
     * the database is not deleted in any sense the author would recognise.
     */
    public static function delete(FileComment $comment, User $actor): void
    {
        $file = $comment->file;

        DB::transaction(function () use ($comment, $actor) {
            $comment->mentions()->delete();
            $comment->update(['body' => '', 'deleted_by' => $actor->id]);
            $comment->delete();
        });

        self::broadcast($file, $comment, 'deleted');
        self::signal($file, $comment);
    }

    public static function resolve(FileComment $comment, User $actor, bool $resolved): FileComment
    {
        $comment->update([
            'resolved_at' => $resolved ? now() : null,
            'resolved_by' => $resolved ? $actor->id : null,
        ]);

        // Settling a thread is reading it. A resolved thread drops out of the
        // unread count anyway; reopening one must not resurrect it as unread
        // for the person who just reopened it.
        CommentReads::markThreadsRead($actor, [$comment->root_id ?? $comment->id]);

        $file = $comment->file;

        if ($resolved) {
            Activity::forFile($actor->id, $file, 'comment-resolved', ['comment' => $comment->uuid]);

            // Tell the author their thread was closed, unless they closed it.
            if ($comment->author_id !== $actor->id) {
                self::notifyOne($comment->author_id, 'file.comment_resolved', $file, $actor,
                    $actor->name.' resolved your comment on '.$file->name);
            }
        }

        self::broadcast($file, $comment->fresh(), 'updated');
        self::signal($file, $comment->fresh());

        return $comment->fresh();
    }

    /**
     * Replace a comment's mentions.
     *
     * Somebody who cannot open the file is given access, see AccessGrants —
     * provided the author is allowed to share it. Naming a colleague is how
     * people ask for a second pair of eyes, and refusing to deliver that
     * because the file had not been shared with them yet made the author go and
     * arrange access in another panel before they could ask their question.
     *
     * When the author cannot share, the mention is dropped silently rather than
     * erroring: they should not learn, from an error message, that a particular
     * colleague lacks access to this file.
     */
    private static function syncMentions(FileComment $comment, FileItem $file, array $mentionIds): void
    {
        $comment->mentions()->delete();

        $ids = array_values(array_filter(array_map('intval', $mentionIds), fn (int $id) => $id > 0));
        if (! $ids) {
            return;
        }

        $users = User::query()
            ->whereIn('id', array_slice(array_unique($ids), 0, 50))
            // A suspended or pending account is not a person you can address.
            ->where('status', User::STATUS_APPROVED)
            ->get();

        $author = $comment->author ?? User::find($comment->author_id);

        foreach ($users as $user) {
            if ($user->id === $comment->author_id) {
                continue;
            }
            if (! $author || AccessGrants::ensure($author, $user, $file, 'mention') === null) {
                continue;
            }

            FileCommentMention::create(['comment_id' => $comment->id, 'user_id' => $user->id]);
        }
    }

    /**
     * Who hears about a new comment.
     *
     * Mentions first and unconditionally, being named is the whole point.
     * Then the person replied to. Then everyone the conversation belongs to,
     * each only once, and never the author of the comment itself:
     *
     *  - the thread's other participants and the file's owner, and
     *  - everyone holding a grant on the file, administrators included, which
     *    is {@see CommentAudience} — the people who can open the document are
     *    the people a question about it is for.
     *
     * That second set is deliberately narrower than "everyone who could open
     * this": the firm-wide default is excluded, or a comment on a routine file
     * would notify all staff. The audience notifications carry a dedupe key so
     * a busy thread refreshes one row per reader per file rather than filling
     * a bell — and a dedupe refresh never sends a second email.
     */
    private static function notify(FileComment $comment, FileItem $file, User $author, ?FileComment $parent): void
    {
        try {
            $mentioned = $comment->mentions()->pluck('user_id')->all();

            foreach ($mentioned as $userId) {
                self::notifyOne($userId, 'file.mention', $file, $author,
                    $author->name.' mentioned you in a comment on '.$file->name, $comment->body);
            }

            $told = array_flip($mentioned);
            $told[$author->id] = true;

            // The person being replied to.
            if ($parent && ! isset($told[$parent->author_id])) {
                $told[$parent->author_id] = true;
                self::notifyOne($parent->author_id, 'file.comment_reply', $file, $author,
                    $author->name.' replied to your comment on '.$file->name, $comment->body);
            }

            // Everyone else already in this thread, plus the file's owner, plus
            // everyone the file itself is granted to.
            $others = self::participants($file, $comment)
                ->merge(CommentAudience::forFile($file))
                ->unique()
                ->reject(fn (int $id) => isset($told[$id]));

            foreach ($others as $userId) {
                self::notifyOne($userId, 'file.comment', $file, $author,
                    $author->name.' commented on '.$file->name, $comment->body,
                    'file.comment:'.$file->id);
            }
        } catch (\Throwable $e) {
            // A comment that saved but failed to notify is a smaller problem
            // than a comment that was rejected because the mail queue was down.
            Log::error('Comments.notify failed', ['comment' => $comment->uuid, 'error' => $e->getMessage()]);
        }
    }

    /** @return Collection<int, int> user ids */
    private static function participants(FileItem $file, FileComment $comment): Collection
    {
        $ids = FileComment::query()
            ->where('file_id', $file->id)
            ->where('id', '!=', $comment->id)
            ->distinct()
            ->pluck('author_id');

        return $ids->push($file->owner_id)
            ->unique()
            ->values()
            // Someone who has since lost access to the file must stop hearing
            // about it, so this is re-checked at send time rather than trusted
            // from when they commented.
            ->filter(function (int $id) use ($file) {
                $user = User::find($id);

                return $user !== null && FileAccess::fileRole($user, $file) !== null;
            });
    }

    private static function notifyOne(int $userId, string $type, FileItem $file, User $actor, string $title, ?string $message = null, ?string $dedupeKey = null): void
    {
        Notifier::send([
            'user' => $userId,
            'actor' => $actor,
            'type' => $type,
            'title' => $title,
            'message' => $message ? Str::limit($message, 140) : null,
            'subject' => $file,
            'action_url' => '/folders/all?file='.$file->uuid,
            'dedupe_key' => $dedupeKey,
        ]);
    }

    /**
     * Push the change to everyone who has the file open.
     *
     * toOthers() is essential: without it the author's own browser processes
     * its own event and inserts the comment a second time, on top of the
     * optimistic copy it already rendered.
     */
    /**
     * Tell the lists this changed — the Workflows section and the home board's
     * Comments tile.
     *
     * Not the same thing as broadcast() above, which carries the comment to
     * people who have this one file open. This carries nothing at all: it says
     * "a conversation you are part of moved", and each reader refetches through
     * their own scoped endpoint. Keep them separate — a viewer needs the row,
     * and a list must never be handed one.
     */
    private static function signal(FileItem $file, FileComment $comment): void
    {
        Live::users(Live::WORKFLOWS, self::reach($file, $comment));

        /*
         * And the indicators outside Workflows, which read the same numbers.
         *
         * The File Library draws a chip on the file's row and on the folder
         * holding it, so the people the conversation concerns need their
         * listings to say so without a reload. The staff room does not: every
         * comment in the firm signalling every staff tab is the refetch storm
         * WORKFLOWS is scoped to avoid, and a chip on a file nobody has open
         * is not worth it.
         */
        Live::users(Live::FILES, self::reach($file, $comment));

        /*
         * CIP is the exception, and staff-wide on purpose. The dot on the
         * applications table is drawn for a reader who is not looking at the
         * file, is not in the thread, and may not know the conversation
         * exists — being told is the entire point of it. The module is
         * staff-only, so the staff room IS its audience.
         */
        $file->loadMissing('cipDocument');

        if ($file->cipDocument) {
            Live::staff(Live::CIP);
        }
    }

    /**
     * Everyone whose lists change when this comment does: the thread's other
     * authors, the file's owner, and anybody named in it.
     *
     * That is {@see Hub::concernsMe} said in ids
     * rather than in SQL, and it is deliberately NOT access-checked the way
     * notify()'s recipients are. The signal carries no rows, so the worst an
     * over-wide reach can do is make somebody refetch a list that comes back
     * exactly as it was. Checking would cost a User lookup and an access walk
     * per participant on every comment written, to prevent nothing.
     *
     * @return list<int>
     */
    private static function reach(FileItem $file, FileComment $comment): array
    {
        return FileComment::query()
            ->where('file_id', $file->id)
            ->distinct()
            ->pluck('author_id')
            ->push($file->owner_id)
            ->merge($comment->mentions()->pluck('user_id'))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private static function broadcast(FileItem $file, FileComment $comment, string $action): void
    {
        try {
            broadcast(new FileCommentChanged($file, $comment, $action))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('Comments.broadcast failed', ['file' => $file->uuid, 'error' => $e->getMessage()]);
        }
    }

    /* ── who may do what ─────────────────────────────────────────── */

    public static function canComment(User $user, FileItem $file): bool
    {
        return FileAccess::can($user, 'comment', $file);
    }

    /** Only the author edits their own words. Not even an administrator. */
    public static function canEdit(User $user, FileComment $comment): bool
    {
        return ContactIdentity::isSelf($user, $comment->author_id, $comment->company_member_id);
    }

    /** The author, or anyone who could delete the file itself (moderation). */
    public static function canDelete(User $user, FileComment $comment, FileItem $file): bool
    {
        return ContactIdentity::isSelf($user, $comment->author_id, $comment->company_member_id)
            || FileAccess::can($user, 'delete', $file);
    }

    /** The thread's author, or anyone with full control of the file. */
    public static function canResolve(User $user, FileComment $comment, FileItem $file): bool
    {
        return ContactIdentity::isSelf($user, $comment->author_id, $comment->company_member_id)
            || FileAccess::can($user, 'share', $file);
    }
}
