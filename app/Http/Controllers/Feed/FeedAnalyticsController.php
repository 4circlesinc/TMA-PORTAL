<?php

namespace App\Http\Controllers\Feed;

use App\Http\Controllers\Controller;
use App\Models\FeedChannel;
use App\Models\FeedComment;
use App\Models\FeedPost;
use App\Models\FeedPostView;
use App\Models\FeedReaction;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedContent;
use App\Support\Feed\FeedPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Feed analytics for channel owners and administrators (§19).
 *
 * Scoped like everything else: without `feed.analytics` a person sees only the
 * channels they administer, and the totals are computed over exactly that set
 * rather than over the whole portal and then filtered.
 *
 * Two numbers are easy to confuse and are kept apart deliberately:
 *   - **views** — how many times posts were opened (repeat views included)
 *   - **reach** — how many distinct people opened them
 * A post read five times by one person has five views and a reach of one.
 */
class FeedAnalyticsController extends Controller
{
    /** How many rows each leaderboard carries. */
    private const TOP_N = 10;

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $data = $request->validate([
            'channel' => ['nullable', 'string'],
            'days' => ['nullable', 'integer', 'min:1', 'max:365'],
        ]);

        $days = (int) ($data['days'] ?? 30);
        $since = Carbon::now()->subDays($days);

        $channelIds = $this->scope($request, $data['channel'] ?? null, $user);

        if ($channelIds === []) {
            abort(403, 'You do not have access to Feed analytics.');
        }

        $postIds = FeedPost::query()
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->where('published_at', '>=', $since)
            ->pluck('id');

        return response()->json([
            'range' => ['days' => $days, 'since' => $since->toIso8601String()],
            'totals' => $this->totals($channelIds, $postIds, $since),
            'topContributors' => $this->topContributors($channelIds, $since),
            'mostViewed' => $this->mostViewed($postIds),
            'mostReacted' => $this->mostReacted($postIds),
            'activity' => $this->dailyActivity($channelIds, $since, $days),
            'channels' => $this->perChannel($channelIds, $user, $since),
        ]);
    }

    /**
     * Which channels this request covers.
     *
     * @return array<int, int>
     */
    private function scope(Request $request, ?string $channelUuid, User $user): array
    {
        if ($channelUuid) {
            $channel = FeedChannelController::resolve($request, $channelUuid);
            abort_unless(FeedAccess::canViewAnalytics($channel, $user), 403);

            return [$channel->id];
        }

        if (FeedAccess::canViewAllAnalytics($user)) {
            return FeedAccess::visibleChannelIds($user);
        }

        // Otherwise: only the channels this person actually administers.
        return FeedChannel::query()
            ->whereHas('members', fn ($q) => $q
                ->where('user_id', $user->id)
                ->whereIn('role', ['owner', 'admin']))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * @param  array<int, int>  $channelIds
     * @return array<string, int>
     */
    private function totals(array $channelIds, $postIds, Carbon $since): array
    {
        return [
            'posts' => $postIds->count(),
            'views' => (int) FeedPostView::query()->whereIn('post_id', $postIds)->sum('view_count'),
            // Distinct people, not rows — see the class comment.
            'reach' => (int) FeedPostView::query()->whereIn('post_id', $postIds)->distinct('user_id')->count('user_id'),
            'comments' => FeedComment::query()->whereIn('post_id', $postIds)->count(),
            'reactions' => FeedReaction::query()
                ->where('reactable_type', FeedReaction::TARGET_POST)
                ->whereIn('reactable_id', $postIds)
                ->count(),
            'members' => (int) FeedChannel::query()->whereIn('id', $channelIds)->sum('members_count'),
            // Someone who posted, commented or reacted in the window — the
            // number that says whether the Feed is actually being used, as
            // opposed to how many people were added to it.
            'activeMembers' => $this->activeMembers($channelIds, $postIds, $since),
        ];
    }

    /** @param array<int, int> $channelIds */
    private function activeMembers(array $channelIds, $postIds, Carbon $since): int
    {
        $authors = FeedPost::query()
            ->whereIn('channel_id', $channelIds)
            ->where('published_at', '>=', $since)
            ->pluck('author_id');

        $commenters = FeedComment::query()
            ->whereIn('post_id', $postIds)
            ->where('created_at', '>=', $since)
            ->pluck('author_id');

        $reactors = FeedReaction::query()
            ->where('reactable_type', FeedReaction::TARGET_POST)
            ->whereIn('reactable_id', $postIds)
            ->where('created_at', '>=', $since)
            ->pluck('user_id');

        return $authors->concat($commenters)->concat($reactors)->unique()->count();
    }

    /**
     * Who is carrying the channel.
     *
     * Ranked on posts plus comments rather than posts alone: someone who
     * answers every question is contributing as much as someone who asks them.
     *
     * @param  array<int, int>  $channelIds
     */
    private function topContributors(array $channelIds, Carbon $since): array
    {
        $posts = FeedPost::query()
            ->select('author_id', DB::raw('count(*) as total'))
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->where('published_at', '>=', $since)
            ->groupBy('author_id')
            ->pluck('total', 'author_id');

        $comments = FeedComment::query()
            ->select('feed_comments.author_id', DB::raw('count(*) as total'))
            ->join('feed_posts', 'feed_posts.id', '=', 'feed_comments.post_id')
            ->whereIn('feed_posts.channel_id', $channelIds)
            ->where('feed_comments.created_at', '>=', $since)
            ->groupBy('feed_comments.author_id')
            ->pluck('total', 'author_id');

        $scores = [];
        foreach ($posts as $id => $count) {
            $scores[$id] = ['posts' => (int) $count, 'comments' => 0];
        }
        foreach ($comments as $id => $count) {
            $scores[$id]['posts'] ??= 0;
            $scores[$id]['comments'] = (int) $count;
        }

        $users = User::query()->whereIn('id', array_keys($scores))->get()->keyBy('id');

        $rows = [];
        foreach ($scores as $id => $score) {
            if (! isset($users[$id])) {
                continue;
            }
            $rows[] = [
                'user' => FeedPresenter::person($users[$id]),
                'posts' => $score['posts'],
                'comments' => $score['comments'],
                'total' => $score['posts'] + $score['comments'],
            ];
        }

        usort($rows, fn ($a, $b) => $b['total'] <=> $a['total']);

        return array_slice($rows, 0, self::TOP_N);
    }

    private function mostViewed($postIds): array
    {
        return FeedPost::query()
            ->with(['channel', 'author'])
            ->whereIn('id', $postIds)
            ->orderByDesc('views_count')
            ->limit(self::TOP_N)
            ->get()
            ->map(fn (FeedPost $p) => $this->postRow($p, 'views', (int) $p->views_count))
            ->values()
            ->all();
    }

    private function mostReacted($postIds): array
    {
        return FeedPost::query()
            ->with(['channel', 'author'])
            ->whereIn('id', $postIds)
            ->orderByDesc('reactions_count')
            ->limit(self::TOP_N)
            ->get()
            ->map(fn (FeedPost $p) => $this->postRow($p, 'reactions', (int) $p->reactions_count))
            ->values()
            ->all();
    }

    private function postRow(FeedPost $post, string $metric, int $value): array
    {
        return [
            'id' => $post->uuid,
            'title' => $post->title ?: FeedContent::excerpt($post->body, 80),
            'channel' => FeedPresenter::channelStub($post->channel),
            'author' => FeedPresenter::person($post->author),
            'publishedAt' => $post->published_at?->toIso8601String(),
            'metric' => $metric,
            'value' => $value,
        ];
    }

    /**
     * Posts per day across the window, zero-filled.
     *
     * Zero-filled in PHP rather than in SQL because a day with no posts has no
     * row to return, and a chart that silently skips empty days misreports a
     * quiet week as a busy one.
     *
     * @param  array<int, int>  $channelIds
     */
    private function dailyActivity(array $channelIds, Carbon $since, int $days): array
    {
        $rows = FeedPost::query()
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->where('published_at', '>=', $since)
            ->get(['published_at'])
            ->groupBy(fn (FeedPost $p) => $p->published_at?->toDateString())
            ->map->count();

        $series = [];
        for ($i = $days - 1; $i >= 0; $i--) {
            $date = Carbon::now()->subDays($i)->toDateString();
            $series[] = ['date' => $date, 'posts' => (int) ($rows[$date] ?? 0)];
        }

        return $series;
    }

    /**
     * The same headline numbers, per channel, so a Feed-wide view can be
     * broken down without a second request per channel.
     *
     * @param  array<int, int>  $channelIds
     */
    private function perChannel(array $channelIds, User $user, Carbon $since): array
    {
        return FeedChannel::query()
            ->whereIn('id', $channelIds)
            ->with(['members' => fn ($q) => $q->where('user_id', $user->id)])
            ->get()
            ->map(function (FeedChannel $channel) use ($since) {
                $postIds = FeedPost::query()
                    ->where('channel_id', $channel->id)
                    ->where('status', FeedPost::STATUS_PUBLISHED)
                    ->where('published_at', '>=', $since)
                    ->pluck('id');

                return [
                    'channel' => FeedPresenter::channelStub($channel),
                    'members' => (int) $channel->members_count,
                    'posts' => $postIds->count(),
                    'views' => (int) FeedPostView::query()->whereIn('post_id', $postIds)->sum('view_count'),
                    'reach' => (int) FeedPostView::query()->whereIn('post_id', $postIds)
                        ->distinct('user_id')->count('user_id'),
                    'comments' => FeedComment::query()->whereIn('post_id', $postIds)->count(),
                    'reactions' => FeedReaction::query()
                        ->where('reactable_type', FeedReaction::TARGET_POST)
                        ->whereIn('reactable_id', $postIds)
                        ->count(),
                ];
            })
            ->sortByDesc('posts')
            ->values()
            ->all();
    }
}
