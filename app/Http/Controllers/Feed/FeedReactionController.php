<?php

namespace App\Http\Controllers\Feed;

use App\Events\FeedPostChanged;
use App\Http\Controllers\Controller;
use App\Models\FeedComment;
use App\Models\FeedPost;
use App\Models\FeedReaction;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedNotifier;
use App\Support\Feed\FeedPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Emoji reactions on posts and comments (§10).
 *
 * One endpoint covers add, change and remove, because from the reader's side
 * they are one gesture: tapping an emoji you already chose takes it back,
 * tapping a different one replaces what you had. That is enforced by the
 * unique (target, user) index, so a double-tap cannot leave two rows.
 */
class FeedReactionController extends Controller
{
    /** How long an emoji string may be — enough for a ZWJ sequence. */
    private const MAX_EMOJI_LENGTH = 32;

    /** React to a post, change the reaction, or take it back. */
    public function post(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $uuid);

        abort_unless(FeedAccess::canEngage($post->channel, $user), 403, 'You cannot react here.');

        $emoji = $this->emoji($request);
        $removed = $this->toggle(FeedReaction::TARGET_POST, $post->id, $user->id, $emoji);

        $post->forceFill([
            'reactions_count' => FeedReaction::query()->forPost($post->id)->count(),
        ])->save();

        if (! $removed) {
            FeedNotifier::reacted($post, $user, $emoji);

            ActivityLogger::log([
                'type' => 'post.reacted',
                'actor' => $user,
                'description' => $user->name.' reacted to a post in '.$post->channel->name,
                'subject' => $post,
                'metadata' => ['emoji' => $emoji],
            ]);
        }

        FeedPostChanged::dispatch($post->channel->uuid, 'reacted', $post->uuid);

        $fresh = $post->fresh(['channel', 'author', 'reactions.user']);

        return response()->json([
            'reactions' => FeedPresenter::post($fresh, $user, [
                'reaction' => $removed ? null : $emoji,
            ])['reactions'],
        ]);
    }

    /** The same, for a comment. */
    public function comment(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $comment = $this->commentFor($request, $uuid);
        $post = $comment->post;

        abort_unless(FeedAccess::canEngage($post->channel, $user), 403, 'You cannot react here.');

        $emoji = $this->emoji($request);
        $removed = $this->toggle(FeedReaction::TARGET_COMMENT, $comment->id, $user->id, $emoji);

        $comment->forceFill([
            'reactions_count' => FeedReaction::query()->forComment($comment->id)->count(),
        ])->save();

        FeedPostChanged::dispatch($post->channel->uuid, 'commented', $post->uuid);

        $fresh = $comment->fresh(['author', 'reactions.user']);

        return response()->json([
            'comment' => FeedPresenter::comment(
                $fresh, $user, $post->channel, $post,
                $removed ? [] : [$comment->id => $emoji],
            ),
        ]);
    }

    /**
     * Who reacted, grouped by emoji (§10).
     *
     * Everyone who reacted is named — reactions are public by design, unlike
     * an anonymous poll vote.
     */
    public function people(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = FeedPostController::resolve($request, $uuid);

        $reactions = FeedReaction::query()
            ->forPost($post->id)
            ->with('user')
            ->get();

        return response()->json([
            'groups' => $reactions
                ->groupBy('emoji')
                ->map(fn ($rows, $emoji) => [
                    'emoji' => $emoji,
                    'count' => $rows->count(),
                    'people' => $rows->map(fn ($r) => FeedPresenter::person($r->user))
                        ->filter()->values(),
                ])
                ->sortByDesc('count')
                ->values(),
            'total' => $reactions->count(),
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Apply one reaction gesture. Returns true when the reaction was removed.
     *
     * updateOrCreate on the unique key, so two rapid taps resolve to one row
     * rather than a constraint violation.
     */
    private function toggle(string $type, int $targetId, int $userId, string $emoji): bool
    {
        return DB::transaction(function () use ($type, $targetId, $userId, $emoji) {
            $existing = FeedReaction::query()
                ->where('reactable_type', $type)
                ->where('reactable_id', $targetId)
                ->where('user_id', $userId)
                ->first();

            // The same emoji again means "take it back".
            if ($existing && $existing->emoji === $emoji) {
                $existing->delete();

                return true;
            }

            FeedReaction::updateOrCreate(
                ['reactable_type' => $type, 'reactable_id' => $targetId, 'user_id' => $userId],
                ['emoji' => $emoji],
            );

            return false;
        });
    }

    /** Validate and bound the emoji. */
    private function emoji(Request $request): string
    {
        $data = $request->validate([
            'emoji' => ['required', 'string', 'max:'.self::MAX_EMOJI_LENGTH],
        ]);

        return $data['emoji'];
    }

    private function commentFor(Request $request, string $uuid): FeedComment
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $comment = FeedComment::query()
            ->with(['post.channel.members' => fn ($q) => $q->where('user_id', $user->id)])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($comment && $comment->post && $comment->post->channel, 404);
        FeedAccess::authorizeView($comment->post->channel, $user);

        return $comment;
    }
}
