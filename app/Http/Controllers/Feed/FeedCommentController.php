<?php

namespace App\Http\Controllers\Feed;

use App\Events\FeedPostChanged;
use App\Http\Controllers\Controller;
use App\Models\FeedComment;
use App\Models\FeedMention;
use App\Models\FeedPost;
use App\Models\FeedReaction;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedAttachmentIntake;
use App\Support\Feed\FeedContent;
use App\Support\Feed\FeedNotifier;
use App\Support\Feed\FeedPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Comments and replies (§9).
 *
 * Threads are one level deep — a reply to a reply keeps the same `root_id` —
 * so a post's whole comment tree loads in one query and is assembled here
 * rather than walked recursively.
 */
class FeedCommentController extends Controller
{
    /** A post's comments, top-level first with their replies nested. */
    public function index(Request $request, string $postUuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $postUuid);
        $channel = $post->channel;

        // One query for the whole tree; the split into roots and replies
        // happens in memory, which is cheaper than a second round trip.
        $all = $post->comments()
            ->with(['author', 'attachments', 'reactions.user'])
            ->orderBy('created_at')
            ->get();

        $myReactions = $this->myReactions($all, $user);

        $roots = $all->whereNull('parent_id');
        $repliesByRoot = $all->whereNotNull('parent_id')->groupBy('root_id');

        return response()->json([
            'comments' => $roots->map(fn (FeedComment $c) => FeedPresenter::comment(
                $c, $user, $channel, $post, $myReactions, $repliesByRoot[$c->id] ?? collect(),
            ))->values(),
            'can' => ['comment' => FeedAccess::canComment($channel, $post, $user)],
        ]);
    }

    /** Post a comment, or a reply to one. */
    public function store(Request $request, string $postUuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $postUuid);
        $channel = $post->channel;

        abort_unless(
            FeedAccess::canComment($channel, $post, $user),
            403,
            $post->comments_locked ? 'Comments are locked on this post.' : 'You cannot comment here.'
        );

        $data = $request->validate([
            'body' => ['nullable', 'string', 'max:20000'],
            'parentId' => ['nullable', 'string'],
            'attachments' => ['nullable', 'array', 'max:'.FeedAttachmentIntake::MAX_PER_COMMENT],
            'attachments.*' => ['string'],
        ]);

        $body = FeedContent::sanitise($data['body'] ?? null);

        if (FeedContent::flatten($body) === '' && empty($data['attachments'])) {
            throw ValidationException::withMessages(['body' => 'A comment needs some text.']);
        }

        $parent = null;
        if (! empty($data['parentId'])) {
            // A parent must live on this same post, or a reply could quote a
            // comment from a thread the replier cannot see.
            $parent = $post->comments()->where('uuid', $data['parentId'])->first();

            if (! $parent) {
                throw ValidationException::withMessages([
                    'parentId' => 'That comment is no longer available.',
                ]);
            }
        }

        $comment = DB::transaction(function () use ($post, $channel, $user, $data, $body, $parent) {
            $comment = FeedComment::create([
                'uuid' => (string) Str::uuid(),
                'post_id' => $post->id,
                'author_id' => $user->id,
                'parent_id' => $parent?->id,
                // A reply to a reply joins its parent's thread rather than
                // starting a deeper one — see the class comment.
                'root_id' => $parent ? ($parent->root_id ?: $parent->id) : null,
                'body' => $body,
                'body_text' => FeedContent::flatten($body),
            ]);

            // A top-level comment is its own root, which is what lets the whole
            // tree be grouped by one column.
            if (! $parent) {
                $comment->forceFill(['root_id' => $comment->id])->save();
            } else {
                $root = $parent->root_id ? FeedComment::find($parent->root_id) : $parent;
                $root?->forceFill(['replies_count' => $root->replies_count + 1])->save();
            }

            if (! empty($data['attachments'])) {
                FeedAttachmentIntake::claim(
                    $data['attachments'], $channel, $user, ['comment_id' => $comment->id],
                );
            }

            $this->syncMentions($comment, $user);

            $post->forceFill(['comments_count' => $post->comments()->count()])->save();
            $channel->forceFill(['last_activity_at' => Carbon::now()])->save();

            return $comment;
        });

        FeedNotifier::commentAdded($comment);
        FeedPostChanged::dispatch($channel->uuid, 'commented', $post->uuid);

        ActivityLogger::log([
            'type' => 'comment.created',
            'actor' => $user,
            'description' => $user->name.' commented on a post in '.$channel->name,
            'subject' => $comment,
        ]);

        $fresh = $comment->fresh(['author', 'attachments', 'reactions.user']);

        return response()->json([
            'comment' => FeedPresenter::comment($fresh, $user, $channel, $post),
            'commentsCount' => $post->fresh()->comments_count,
        ], 201);
    }

    /** Edit a comment. Its author only. */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $comment = $this->commentFor($request, $uuid);
        $post = $comment->post;
        $channel = $post->channel;

        abort_unless(FeedAccess::canEditComment($comment, $user), 403, 'You cannot edit this comment.');

        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
        ]);

        $body = FeedContent::sanitise($data['body']);

        if (FeedContent::flatten($body) === '') {
            throw ValidationException::withMessages(['body' => 'A comment needs some text.']);
        }

        $comment->forceFill([
            'body' => $body,
            'body_text' => FeedContent::flatten($body),
            'edited_at' => Carbon::now(),
        ])->save();

        $this->syncMentions($comment, $user);

        FeedPostChanged::dispatch($channel->uuid, 'commented', $post->uuid);

        return response()->json([
            'comment' => FeedPresenter::comment(
                $comment->fresh(['author', 'attachments', 'reactions.user']),
                $user, $channel, $post,
            ),
        ]);
    }

    /** Delete a comment. Its author, or a moderator of the channel. */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $comment = $this->commentFor($request, $uuid);
        $post = $comment->post;
        $channel = $post->channel;

        abort_unless(
            FeedAccess::canDeleteComment($channel, $comment, $user),
            403,
            'You cannot delete this comment.'
        );

        DB::transaction(function () use ($comment, $post) {
            // Deleting a root takes its replies with it: a thread of answers
            // to a question nobody can see any more is not readable.
            if (! $comment->isReply()) {
                $post->comments()->where('root_id', $comment->id)->delete();
            } elseif ($comment->root_id) {
                $root = FeedComment::find($comment->root_id);
                $root?->forceFill(['replies_count' => max(0, $root->replies_count - 1)])->save();
            }

            $comment->delete();
            $post->forceFill(['comments_count' => $post->comments()->count()])->save();
        });

        FeedPostChanged::dispatch($channel->uuid, 'commented', $post->uuid);

        ActivityLogger::log([
            'type' => 'comment.deleted',
            'actor' => $user,
            'description' => $user->name.' deleted a comment in '.$channel->name,
            'subject' => $comment,
        ]);

        return response()->json([
            'deleted' => true,
            'commentsCount' => $post->fresh()->comments_count,
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Resolve a comment on a post the caller may read, or 404.
     */
    private function commentFor(Request $request, string $uuid): FeedComment
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $comment = FeedComment::query()
            ->with(['post.channel.members' => fn ($q) => $q->where('user_id', $user->id), 'author'])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($comment && $comment->post && $comment->post->channel, 404);
        FeedAccess::authorizeView($comment->post->channel, $user);

        return $comment;
    }

    /**
     * This viewer's own reaction on each comment, in one query.
     *
     * @param  Collection<int, FeedComment>  $comments
     * @return array<int, string> comment id => emoji
     */
    private function myReactions(Collection $comments, User $user): array
    {
        $ids = $comments->pluck('id')->all();

        if ($ids === []) {
            return [];
        }

        return FeedReaction::query()
            ->where('reactable_type', FeedReaction::TARGET_COMMENT)
            ->whereIn('reactable_id', $ids)
            ->where('user_id', $user->id)
            ->pluck('emoji', 'reactable_id')
            ->all();
    }

    /** Rewrite a comment's mention rows from what its body now says. */
    private function syncMentions(FeedComment $comment, User $actor): void
    {
        $resolved = FeedContent::resolveMentions(
            FeedContent::mentionTokens($comment->body),
            $actor,
        );

        $comment->mentions()->delete();

        foreach ($resolved['users'] as $user) {
            FeedMention::create(['comment_id' => $comment->id, 'user_id' => $user->id]);
        }

        foreach ($resolved['groups'] as $group) {
            FeedMention::create(['comment_id' => $comment->id, 'group_id' => $group->id]);
        }
    }
}
