<?php

namespace App\Support\Files;

use App\Events\FileCommentChanged;
use App\Models\FileComment;
use App\Models\FileCommentMention;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Notifications\Notifier;
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
 *  - **A mention can never reach someone who cannot open the file.** Mentions
 *    arrive as user ids from the composer, and the composer's suggestion list
 *    is itself filtered — but the list is a courtesy, not the control. Every
 *    mention is re-checked against FileAccess before it is stored, so a
 *    hand-crafted request cannot notify a stranger (and, through the
 *    notification's own text, leak the file's name to them).
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
    ): FileComment {
        $body = trim($body);

        $comment = DB::transaction(function () use ($file, $author, $body, $parent, $mentionIds) {
            $comment = FileComment::create([
                'uuid' => (string) Str::uuid(),
                'file_id' => $file->id,
                'author_id' => $author->id,
                'parent_id' => $parent?->id,
                // Threading is one level deep: replying to a reply attaches to
                // the same root, so a thread never becomes an endless indent.
                'root_id' => $parent ? ($parent->root_id ?? $parent->id) : null,
                'body' => $body,
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

        return $comment->fresh();
    }

    /**
     * Soft-delete, and blank the body.
     *
     * The row stays so replies beneath it keep their place in the thread, but
     * the text must actually go — a "deleted" comment whose words are still in
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
    }

    public static function resolve(FileComment $comment, User $actor, bool $resolved): FileComment
    {
        $comment->update([
            'resolved_at' => $resolved ? now() : null,
            'resolved_by' => $resolved ? $actor->id : null,
        ]);

        $file = $comment->file;

        if ($resolved) {
            Activity::forFile($actor->id, $file, 'comment-resolved', ['comment' => $comment->uuid]);

            // Tell the author their thread was closed — unless they closed it.
            if ($comment->author_id !== $actor->id) {
                self::notifyOne($comment->author_id, 'file.comment_resolved', $file, $actor,
                    $actor->name.' resolved your comment on '.$file->name);
            }
        }

        self::broadcast($file, $comment->fresh(), 'updated');

        return $comment->fresh();
    }

    /**
     * Replace a comment's mentions, dropping any user who cannot open the file.
     *
     * Silently dropping rather than erroring is deliberate: the author should
     * not learn, from an error message, that a particular colleague lacks
     * access to this file.
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

        foreach ($users as $user) {
            if ($user->id === $comment->author_id) {
                continue;
            }
            if (FileAccess::fileRole($user, $file) === null) {
                continue;
            }

            FileCommentMention::create(['comment_id' => $comment->id, 'user_id' => $user->id]);
        }
    }

    /**
     * Who hears about a new comment.
     *
     * Mentions first and unconditionally — being named is the whole point.
     * Then the thread's other participants and the file owner, each only once,
     * and never the author of the comment itself.
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

            // Everyone else already in this thread, plus the file's owner.
            $participants = self::participants($file, $comment)
                ->reject(fn (int $id) => isset($told[$id]));

            foreach ($participants as $userId) {
                self::notifyOne($userId, 'file.comment', $file, $author,
                    $author->name.' commented on '.$file->name, $comment->body);
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

    private static function notifyOne(int $userId, string $type, FileItem $file, User $actor, string $title, ?string $message = null): void
    {
        Notifier::send([
            'user' => $userId,
            'actor' => $actor,
            'type' => $type,
            'title' => $title,
            'message' => $message ? Str::limit($message, 140) : null,
            'subject' => $file,
            'action_url' => '/folders/all?file='.$file->uuid,
        ]);
    }

    /**
     * Push the change to everyone who has the file open.
     *
     * toOthers() is essential: without it the author's own browser processes
     * its own event and inserts the comment a second time, on top of the
     * optimistic copy it already rendered.
     */
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
        return $comment->author_id === $user->id;
    }

    /** The author, or anyone who could delete the file itself (moderation). */
    public static function canDelete(User $user, FileComment $comment, FileItem $file): bool
    {
        return $comment->author_id === $user->id || FileAccess::can($user, 'delete', $file);
    }

    /** The thread's author, or anyone with full control of the file. */
    public static function canResolve(User $user, FileComment $comment, FileItem $file): bool
    {
        return $comment->author_id === $user->id || FileAccess::can($user, 'share', $file);
    }
}
