<?php

namespace App\Http\Controllers\Feed;

use App\Http\Controllers\Controller;
use App\Models\FeedAttachment;
use App\Models\FeedChannel;
use App\Models\FeedComment;
use App\Models\FeedHashtag;
use App\Models\FeedPost;
use App\Models\Group;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedContent;
use App\Support\Feed\FeedPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Search across the Feed, and the composer's @/# autocomplete (§14, §16, §17).
 *
 * Every result set is constrained to the channels the caller may read, which
 * is resolved once as a list of ids rather than re-derived per row. Without
 * that a search would be a way to read the contents of a private channel.
 */
class FeedSearchController extends Controller
{
    /** Results per group. Search is a jumping-off point, not a listing. */
    private const LIMIT = 12;

    /**
     * Grouped search: posts, comments, channels, people, hashtags, files.
     *
     * Grouped rather than ranked into one list because the groups answer
     * different questions, "where was this discussed" and "who works on this"
     * are not competing for the same slot.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $data = $request->validate([
            'q' => ['required', 'string', 'min:2', 'max:200'],
            'channel' => ['nullable', 'string'],
            'author' => ['nullable', 'integer'],
            'type' => ['nullable', 'string', 'max:24'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'hasAttachments' => ['nullable', 'boolean'],
            'hasPoll' => ['nullable', 'boolean'],
        ]);

        $term = trim($data['q']);
        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $term).'%';

        $channelIds = FeedAccess::visibleChannelIds($user);

        if ($channelIds === []) {
            return response()->json($this->empty());
        }

        // A channel filter narrows the visible set; it never widens it.
        if (! empty($data['channel'])) {
            $channel = FeedChannelController::resolve($request, $data['channel']);
            $channelIds = [$channel->id];
        }

        return response()->json([
            'posts' => $this->posts($user, $channelIds, $like, $data),
            'comments' => $this->comments($user, $channelIds, $like),
            'channels' => $this->channels($user, $like),
            'people' => $this->people($user, $like),
            'hashtags' => $this->hashtags($like),
            'attachments' => $this->attachments($channelIds, $like),
        ]);
    }

    /** @param array<int, int> $channelIds */
    private function posts(User $user, array $channelIds, string $like, array $filters): array
    {
        $query = FeedPost::query()
            ->with(['channel', 'author'])
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->where(fn ($q) => $q
                ->where('body_text', 'like', $like)
                ->orWhere('title', 'like', $like));

        if (! empty($filters['author'])) {
            $query->where('author_id', (int) $filters['author']);
        }
        if (! empty($filters['type'])) {
            $query->where('post_type', $filters['type']);
        }
        if (! empty($filters['from'])) {
            $query->whereDate('published_at', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->whereDate('published_at', '<=', $filters['to']);
        }
        if (! empty($filters['hasAttachments'])) {
            $query->whereHas('attachments');
        }
        if (! empty($filters['hasPoll'])) {
            $query->whereHas('poll');
        }

        return $query->orderByDesc('published_at')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (FeedPost $p) => [
                'id' => $p->uuid,
                'title' => $p->title,
                'excerpt' => FeedContent::excerpt($p->body, 160),
                'type' => $p->post_type,
                'channel' => FeedPresenter::channelStub($p->channel),
                'author' => FeedPresenter::person($p->author),
                'publishedAt' => $p->published_at?->toIso8601String(),
            ])
            ->values()
            ->all();
    }

    /** @param array<int, int> $channelIds */
    private function comments(User $user, array $channelIds, string $like): array
    {
        return FeedComment::query()
            ->with(['author', 'post.channel'])
            ->whereHas('post', fn ($q) => $q
                ->whereIn('channel_id', $channelIds)
                ->where('status', FeedPost::STATUS_PUBLISHED))
            ->where('body_text', 'like', $like)
            ->orderByDesc('created_at')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (FeedComment $c) => [
                'id' => $c->uuid,
                'postId' => $c->post?->uuid,
                'excerpt' => FeedContent::excerpt($c->body, 140),
                'author' => FeedPresenter::person($c->author),
                'channel' => FeedPresenter::channelStub($c->post?->channel),
                'createdAt' => $c->created_at?->toIso8601String(),
            ])
            ->values()
            ->all();
    }

    private function channels(User $user, string $like): array
    {
        return FeedAccess::scopeVisible(FeedChannel::query(), $user)
            ->where(fn ($q) => $q
                ->where('name', 'like', $like)
                ->orWhere('description', 'like', $like))
            ->orderByDesc('last_activity_at')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (FeedChannel $c) => FeedPresenter::channel($c, $user))
            ->values()
            ->all();
    }

    /**
     * Authors, not the whole directory: someone who has never posted is not a
     * useful Feed search result, and surfacing them would leak the staff list
     * to anyone who can reach the Feed.
     */
    private function people(User $user, string $like): array
    {
        $channelIds = FeedAccess::visibleChannelIds($user);

        $authorIds = FeedPost::query()
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedPost::STATUS_PUBLISHED)
            ->distinct()
            ->pluck('author_id');

        return User::query()
            ->whereIn('id', $authorIds)
            ->where('name', 'like', $like)
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (User $u) => FeedPresenter::person($u))
            ->values()
            ->all();
    }

    private function hashtags(string $like): array
    {
        return FeedHashtag::query()
            ->where('tag', 'like', $like)
            ->orderByDesc('posts_count')
            ->limit(self::LIMIT)
            ->get()
            ->map(fn (FeedHashtag $h) => [
                'tag' => $h->display_tag,
                'count' => (int) $h->posts_count,
            ])
            ->values()
            ->all();
    }

    /** @param array<int, int> $channelIds */
    private function attachments(array $channelIds, string $like): array
    {
        return FeedAttachment::query()
            ->whereIn('channel_id', $channelIds)
            ->where('status', FeedAttachment::STATUS_READY)
            ->whereNotNull('post_id')
            ->where('name', 'like', $like)
            ->orderByDesc('created_at')
            ->limit(self::LIMIT)
            ->with('post')
            ->get()
            ->map(fn (FeedAttachment $a) => array_merge(
                FeedPresenter::attachment($a),
                ['postId' => $a->post?->uuid],
            ))
            ->values()
            ->all();
    }

    /**
     * The composer's @ autocomplete: people first, then groups (§16).
     *
     * Returns the same token shape the sanitiser expects on the way back in —
     * "user:{id}" or "group:{uuid}", so the client never has to construct it.
     */
    public function mentionable(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $data = $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            'channel' => ['nullable', 'string'],
        ]);

        $term = trim($data['q'] ?? '');
        $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $term).'%';

        // Inside a channel, its own members come first: mentioning someone who
        // cannot see the post is the most common way a mention goes nowhere.
        $memberIds = [];
        if (! empty($data['channel'])) {
            $channel = FeedChannelController::resolve($request, $data['channel']);
            $memberIds = $channel->members()->pluck('user_id')->all();
        }

        $people = User::query()
            ->where('status', User::STATUS_APPROVED)
            ->whereIn('account_type', Role::STAFF)
            ->when($term !== '', fn ($q) => $q->where('name', 'like', $like))
            ->orderByRaw($memberIds === [] ? '1' : 'case when id in ('.implode(',', array_map('intval', $memberIds)).') then 0 else 1 end')
            ->orderBy('name')
            ->limit(20)
            ->get()
            ->map(fn (User $u) => [
                'token' => 'user:'.$u->id,
                'kind' => 'user',
                'name' => $u->name,
                'photo' => $u->avatar_url,
                'meta' => $u->job_title,
                'isMember' => in_array($u->id, $memberIds, true),
            ]);

        $groups = Role::can($user, 'groups.view')
            ? Group::query()
                ->where('is_archived', false)
                ->when($term !== '', fn ($q) => $q->where('name', 'like', $like))
                ->orderBy('name')
                ->limit(10)
                ->get()
                ->map(fn (Group $g) => [
                    'token' => 'group:'.$g->uuid,
                    'kind' => 'group',
                    'name' => $g->name,
                    'photo' => null,
                    'meta' => ucfirst($g->group_type),
                    'isMember' => false,
                ])
            : collect();

        return response()->json([
            'results' => $people->concat($groups)->values(),
        ]);
    }

    /** The # autocomplete: tags already in use, most used first (§17). */
    public function hashtagSuggestions(Request $request): JsonResponse
    {
        Role::authorize($request->user(), 'feed.view');

        $data = $request->validate(['q' => ['nullable', 'string', 'max:80']]);

        $term = FeedHashtag::normalise($data['q'] ?? '');

        return response()->json([
            'results' => FeedHashtag::query()
                ->when($term !== '', fn ($q) => $q->where('tag', 'like', $term.'%'))
                ->orderByDesc('posts_count')
                ->limit(15)
                ->get()
                ->map(fn (FeedHashtag $h) => [
                    'tag' => $h->display_tag,
                    'count' => (int) $h->posts_count,
                ])
                ->values(),
        ]);
    }

    /** @return array<string, array<int, mixed>> */
    private function empty(): array
    {
        return [
            'posts' => [], 'comments' => [], 'channels' => [],
            'people' => [], 'hashtags' => [], 'attachments' => [],
        ];
    }
}
