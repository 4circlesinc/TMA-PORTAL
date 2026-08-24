<?php

namespace App\Http\Controllers\Feed;

use App\Events\FeedPostChanged;
use App\Http\Controllers\Controller;
use App\Models\FeedAcknowledgement;
use App\Models\FeedAttachment;
use App\Models\FeedBookmark;
use App\Models\FeedChannel;
use App\Models\FeedMention;
use App\Models\FeedPoll;
use App\Models\FeedPollOption;
use App\Models\FeedPost;
use App\Models\FeedPostView;
use App\Models\FeedReaction;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Activity\ActivityLogger;
use App\Support\Feed\FeedAccess;
use App\Support\Feed\FeedAttachmentIntake;
use App\Support\Feed\FeedContent;
use App\Support\Feed\FeedNotifier;
use App\Support\Feed\FeedPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Posts: writing them, scheduling them, publishing them, and everything a
 * reader does to one (§4, §5, §6, §11, §12, §15).
 *
 * A draft, a scheduled post and a published post are the same row in three
 * states, so most of this file is shared between them. `store` writes a draft
 * or publishes outright depending on the status asked for, and `update` moves
 * a post between states without ever re-parenting its attachments.
 */
class FeedPostController extends Controller
{
    /** How many posts one page of the stream carries. */
    private const PAGE_SIZE = 20;

    /* ── Reading ──────────────────────────────────────────────────── */

    /**
     * The stream: one channel's posts, or everything the reader can see.
     *
     * Pinned posts are fetched separately and prepended rather than sorted
     * inline, because a pinned post has to stay on top of page one without
     * also reappearing further down as paging walks back through time.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $data = $request->validate([
            'channel' => ['nullable', 'string'],
            'before' => ['nullable', 'integer'],
            'type' => ['nullable', Rule::in(FeedPost::TYPES)],
            'author' => ['nullable', 'integer'],
            'hashtag' => ['nullable', 'string', 'max:80'],
            'hasAttachments' => ['nullable', 'boolean'],
            'hasPoll' => ['nullable', 'boolean'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'q' => ['nullable', 'string', 'max:200'],
            // all | bookmarks | mentions | pinned | drafts | scheduled | archived
            'view' => ['nullable', 'string', 'max:20'],
        ]);

        $view = $data['view'] ?? 'all';
        $channel = null;

        if (! empty($data['channel'])) {
            $channel = FeedChannelController::resolve($request, $data['channel']);
        }

        $visibleIds = $channel
            ? [$channel->id]
            : FeedAccess::visibleChannelIds($user);

        if ($visibleIds === []) {
            return response()->json(['posts' => [], 'pinned' => [], 'hasMore' => false]);
        }

        $query = $this->baseQuery($user, $visibleIds, $view);
        $this->applyFilters($query, $data, $user);

        if (! empty($data['before'])) {
            $query->where('feed_posts.id', '<', (int) $data['before']);
        }

        $posts = $query
            ->orderByDesc('feed_posts.id')
            ->limit(self::PAGE_SIZE + 1)
            ->get();

        $hasMore = $posts->count() > self::PAGE_SIZE;
        $posts = $posts->take(self::PAGE_SIZE);

        // The pinned band belongs to a channel's own stream, and only to the
        // first page, beyond that it would repeat on every scroll.
        $pinned = ($channel && empty($data['before']) && $view === 'all')
            ? $this->baseQuery($user, $visibleIds, 'all')
                ->where('feed_posts.is_pinned', true)
                ->where(fn (Builder $q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', Carbon::now()))
                ->orderByDesc('pinned_at')
                ->limit(10)
                ->get()
            : collect();

        $state = $this->viewerState($posts->concat($pinned), $user);

        return response()->json([
            'posts' => $posts->map(fn (FeedPost $p) => FeedPresenter::post($p, $user, $state[$p->id] ?? []))->values(),
            'pinned' => $pinned->map(fn (FeedPost $p) => FeedPresenter::post($p, $user, $state[$p->id] ?? []))->values(),
            'hasMore' => $hasMore,
            'cursor' => $posts->last()?->id,
        ]);
    }

    /**
     * The query behind every listing, with the relations a card needs.
     *
     * @param  array<int, int>  $channelIds
     */
    private function baseQuery(User $user, array $channelIds, string $view): Builder
    {
        $query = FeedPost::query()
            ->with([
                'channel',
                'author',
                'attachments',
                'poll.options',
                'hashtags',
                'mentions.user',
                'mentions.group',
                'reactions.user',
            ])
            ->whereIn('feed_posts.channel_id', $channelIds);

        return match ($view) {
            // Drafts and scheduled posts are private to their author (§5).
            'drafts' => $query
                ->where('feed_posts.author_id', $user->id)
                ->where('feed_posts.status', FeedPost::STATUS_DRAFT),

            'scheduled' => $query
                ->where('feed_posts.author_id', $user->id)
                ->where('feed_posts.status', FeedPost::STATUS_SCHEDULED),

            'archived' => $query->where('feed_posts.status', FeedPost::STATUS_ARCHIVED),

            'bookmarks' => $query
                ->where('feed_posts.status', FeedPost::STATUS_PUBLISHED)
                ->whereExists(fn ($q) => $q->select(DB::raw(1))
                    ->from('feed_bookmarks')
                    ->whereColumn('feed_bookmarks.post_id', 'feed_posts.id')
                    ->where('feed_bookmarks.user_id', $user->id)),

            'mentions' => $query
                ->where('feed_posts.status', FeedPost::STATUS_PUBLISHED)
                ->whereExists(fn ($q) => $q->select(DB::raw(1))
                    ->from('feed_mentions')
                    ->whereColumn('feed_mentions.post_id', 'feed_posts.id')
                    ->where('feed_mentions.user_id', $user->id)),

            'pinned' => $query
                ->where('feed_posts.status', FeedPost::STATUS_PUBLISHED)
                ->where('feed_posts.is_pinned', true),

            default => $query->where('feed_posts.status', FeedPost::STATUS_PUBLISHED),
        };
    }

    /** @param array<string, mixed> $data */
    private function applyFilters(Builder $query, array $data, User $user): void
    {
        if (! empty($data['type'])) {
            $query->where('feed_posts.post_type', $data['type']);
        }

        if (! empty($data['author'])) {
            $query->where('feed_posts.author_id', (int) $data['author']);
        }

        if (! empty($data['from'])) {
            $query->where('feed_posts.created_at', '>=', Carbon::parse($data['from'])->startOfDay());
        }

        if (! empty($data['to'])) {
            $query->where('feed_posts.created_at', '<=', Carbon::parse($data['to'])->endOfDay());
        }

        if (! empty($data['hashtag'])) {
            $tag = \App\Models\FeedHashtag::normalise($data['hashtag']);
            $query->whereHas('hashtags', fn ($q) => $q->where('tag', $tag));
        }

        if (! empty($data['hasAttachments'])) {
            $query->whereHas('attachments');
        }

        if (! empty($data['hasPoll'])) {
            $query->whereHas('poll');
        }

        if (! empty($data['q'])) {
            // Matched against the flattened copy, so a search for "budget"
            // cannot be satisfied by the word appearing inside a tag name.
            $term = '%'.str_replace(['%', '_'], ['\%', '\_'], $data['q']).'%';
            $query->where(fn (Builder $q) => $q
                ->where('feed_posts.body_text', 'like', $term)
                ->orWhere('feed_posts.title', 'like', $term));
        }
    }

    /**
     * The per-viewer facts for a page of posts, in three queries rather than
     * three per card: their own reaction, their bookmarks, their
     * acknowledgements, and which poll options they chose.
     *
     * @param  Collection<int, FeedPost>  $posts
     * @return array<int, array<string, mixed>>
     */
    private function viewerState(Collection $posts, User $user): array
    {
        $ids = $posts->pluck('id')->all();

        if ($ids === []) {
            return [];
        }

        $reactions = FeedReaction::query()
            ->where('reactable_type', FeedReaction::TARGET_POST)
            ->whereIn('reactable_id', $ids)
            ->where('user_id', $user->id)
            ->pluck('emoji', 'reactable_id');

        $bookmarks = FeedBookmark::query()
            ->whereIn('post_id', $ids)
            ->where('user_id', $user->id)
            ->pluck('post_id');

        $acks = FeedAcknowledgement::query()
            ->whereIn('post_id', $ids)
            ->where('user_id', $user->id)
            ->pluck('post_id');

        $pollIds = $posts->pluck('poll.id')->filter()->all();
        $votes = $pollIds === []
            ? collect()
            : DB::table('feed_poll_votes')
                ->join('feed_poll_options', 'feed_poll_options.id', '=', 'feed_poll_votes.option_id')
                ->whereIn('feed_poll_votes.poll_id', $pollIds)
                ->where('feed_poll_votes.user_id', $user->id)
                ->get(['feed_poll_votes.poll_id', 'feed_poll_options.uuid'])
                ->groupBy('poll_id');

        $state = [];
        foreach ($posts as $post) {
            $state[$post->id] = [
                'reaction' => $reactions[$post->id] ?? null,
                'bookmarked' => $bookmarks->contains($post->id),
                'acknowledged' => $acks->contains($post->id),
                'voted' => $post->poll
                    ? ($votes[$post->poll->id] ?? collect())->pluck('uuid')->all()
                    : [],
            ];
        }

        return $state;
    }

    /** One post. Opening it is what records a view (§19). */
    public function show(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);

        $this->recordView($post, $user);

        $state = $this->viewerState(collect([$post]), $user);

        return response()->json([
            'post' => FeedPresenter::post($post, $user, $state[$post->id] ?? []),
        ]);
    }

    /* ── Writing ──────────────────────────────────────────────────── */

    /**
     * Create a post, as a draft, a scheduled publication, or live now.
     *
     * The whole write is one transaction: body, attachments, poll, mentions
     * and hashtags either all land or none do. Notifying and emailing happen
     * *after* it commits, so a slow mail queue cannot roll back a published
     * post, and a failed notification cannot un-publish one.
     */
    public function store(Request $request): JsonResponse
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $data = $this->validatePayload($request);
        $channel = FeedChannelController::resolve($request, $data['channelId']);

        abort_unless(FeedAccess::canPost($channel, $user), 403, 'You cannot post in this channel.');

        $status = $data['status'] ?? FeedPost::STATUS_DRAFT;
        $this->assertPublishable($data, $status, $channel, $user);

        $post = DB::transaction(function () use ($data, $channel, $user, $status) {
            $body = FeedContent::sanitise($data['body'] ?? null);

            $post = FeedPost::create([
                'uuid' => (string) Str::uuid(),
                'channel_id' => $channel->id,
                'author_id' => $user->id,
                'post_type' => $data['type'] ?? FeedPost::TYPE_DISCUSSION,
                'title' => $data['title'] ?? null,
                'body' => $body,
                'body_text' => FeedContent::flatten($body),
                'status' => $status,
                'requires_acknowledgement' => $data['requiresAcknowledgement'] ?? false,
                'expires_at' => ! empty($data['expiresAt']) ? Carbon::parse($data['expiresAt']) : null,
                'scheduled_for' => $status === FeedPost::STATUS_SCHEDULED
                    ? Carbon::parse($data['scheduledFor'])
                    : null,
                'timezone' => $data['timezone'] ?? null,
                'published_at' => $status === FeedPost::STATUS_PUBLISHED ? Carbon::now() : null,
                'email_audience' => $data['emailAudience'] ?? FeedPost::EMAIL_NONE,
                'email_groups' => $data['emailGroups'] ?? null,
                'notify_portal' => $data['notifyPortal'] ?? true,
            ]);

            $this->syncSidecars($post, $channel, $user, $data, $body);

            if ($status === FeedPost::STATUS_PUBLISHED) {
                $this->stampPublished($post, $channel);
            }

            return $post;
        });

        if ($post->isPublished()) {
            FeedNotifier::postPublished($post);
            FeedPostChanged::dispatch($channel->uuid, 'created', $post->uuid);
        }

        ActivityLogger::log([
            'type' => 'post.'.($status === FeedPost::STATUS_PUBLISHED ? 'published' : 'created'),
            'actor' => $user,
            'description' => $status === FeedPost::STATUS_PUBLISHED
                ? $user->name.' published a post in '.$channel->name
                : $user->name.' saved a '.$status.' post for '.$channel->name,
            'subject' => $post,
            'new' => ['type' => $post->post_type, 'status' => $post->status],
        ]);

        return response()->json([
            'post' => FeedPresenter::post($this->reload($post), $user),
        ], 201);
    }

    /**
     * Edit a post, or move it between states.
     *
     * A body change stamps `edited_at`; pinning or rescheduling does not, so
     * the "Edited" chip means what a reader assumes it means.
     */
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid, published: false);
        $channel = $post->channel;

        abort_unless(FeedAccess::canEditPost($post, $user), 403, 'You cannot edit this post.');

        $data = $this->validatePayload($request, creating: false);
        $status = $data['status'] ?? $post->status;

        $wasPublished = $post->isPublished();
        $this->assertPublishable($data, $status, $channel, $user, $post);

        DB::transaction(function () use ($post, $channel, $user, $data, $status, $wasPublished) {
            $bodyChanged = array_key_exists('body', $data);
            $body = $bodyChanged ? FeedContent::sanitise($data['body']) : $post->body;

            $post->fill(array_filter([
                'post_type' => $data['type'] ?? null,
                'timezone' => $data['timezone'] ?? null,
                'email_audience' => $data['emailAudience'] ?? null,
            ], fn ($v) => $v !== null));

            if ($bodyChanged) {
                $post->body = $body;
                $post->body_text = FeedContent::flatten($body);
                // Only a real content edit marks the post as edited, and only
                // once it is already live, editing a draft is just writing.
                if ($wasPublished) {
                    $post->edited_at = Carbon::now();
                }
            }

            if (array_key_exists('title', $data)) {
                $post->title = $data['title'];
            }
            if (array_key_exists('requiresAcknowledgement', $data)) {
                $post->requires_acknowledgement = $data['requiresAcknowledgement'];
            }
            if (array_key_exists('expiresAt', $data)) {
                $post->expires_at = $data['expiresAt'] ? Carbon::parse($data['expiresAt']) : null;
            }
            if (array_key_exists('emailGroups', $data)) {
                $post->email_groups = $data['emailGroups'];
            }
            if (array_key_exists('notifyPortal', $data)) {
                $post->notify_portal = $data['notifyPortal'];
            }

            $post->status = $status;
            $post->scheduled_for = $status === FeedPost::STATUS_SCHEDULED
                ? Carbon::parse($data['scheduledFor'] ?? $post->scheduled_for)
                : null;

            if ($status === FeedPost::STATUS_PUBLISHED && ! $wasPublished) {
                $post->published_at = Carbon::now();
            }

            $post->save();

            $this->syncSidecars($post, $channel, $user, $data, $post->body);

            if ($status === FeedPost::STATUS_PUBLISHED && ! $wasPublished) {
                $this->stampPublished($post, $channel);
            }
        });

        // Only a first publication announces itself. Editing a live post must
        // not re-notify everyone who already read it.
        if ($post->isPublished() && ! $wasPublished) {
            FeedNotifier::postPublished($post);
        }

        FeedPostChanged::dispatch($channel->uuid, $wasPublished ? 'updated' : 'created', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.'.($post->isPublished() && ! $wasPublished ? 'published' : 'updated'),
            'actor' => $user,
            'description' => $user->name.' updated a post in '.$channel->name,
            'subject' => $post,
            'new' => ['status' => $post->status],
        ]);

        $state = $this->viewerState(collect([$post]), $user);

        return response()->json([
            'post' => FeedPresenter::post($this->reload($post), $user, $state[$post->id] ?? []),
        ]);
    }

    /**
     * Autosave a draft (§5).
     *
     * Separate from update() because it runs on a timer while someone types:
     * it touches only the body and title, never the status or the schedule,
     * and it does not log an activity entry or stamp an edit. A keystroke is
     * not an audit event.
     */
    public function autosave(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid, published: false);

        abort_unless(FeedAccess::canEditPost($post, $user), 403);
        abort_unless(
            in_array($post->status, [FeedPost::STATUS_DRAFT, FeedPost::STATUS_SCHEDULED], true),
            422,
            'Only drafts autosave.'
        );

        $data = $request->validate([
            'body' => ['nullable', 'string', 'max:'.FeedContent::MAX_BODY_LENGTH],
            'title' => ['nullable', 'string', 'max:255'],
        ]);

        $body = FeedContent::sanitise($data['body'] ?? null);

        $post->forceFill([
            'body' => $body,
            'body_text' => FeedContent::flatten($body),
            'title' => $data['title'] ?? $post->title,
        ])->save();

        return response()->json([
            'savedAt' => $post->updated_at?->toIso8601String(),
        ]);
    }

    /** Publish a draft or scheduled post straight away (§6). */
    public function publish(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid, published: false);
        $channel = $post->channel;

        abort_unless(FeedAccess::canEditPost($post, $user), 403, 'You cannot publish this post.');
        abort_unless(FeedAccess::canPost($channel, $user), 403, 'You cannot post in this channel.');
        abort_if($post->isPublished(), 422, 'This post is already published.');

        DB::transaction(function () use ($post, $channel) {
            $post->forceFill([
                'status' => FeedPost::STATUS_PUBLISHED,
                'published_at' => Carbon::now(),
                'scheduled_for' => null,
            ])->save();

            $this->stampPublished($post, $channel);
        });

        FeedNotifier::postPublished($post);
        FeedPostChanged::dispatch($channel->uuid, 'created', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.published',
            'actor' => $user,
            'description' => $user->name.' published a post in '.$channel->name,
            'subject' => $post,
        ]);

        return response()->json(['post' => FeedPresenter::post($this->reload($post), $user)]);
    }

    /** Duplicate a post as a fresh draft (§5). */
    public function duplicate(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid, published: false);
        $channel = $post->channel;

        abort_unless(FeedAccess::canPost($channel, $user), 403, 'You cannot post in this channel.');

        $copy = DB::transaction(function () use ($post, $channel, $user) {
            $copy = FeedPost::create([
                'uuid' => (string) Str::uuid(),
                'channel_id' => $post->channel_id,
                'author_id' => $user->id,
                'post_type' => $post->post_type,
                'title' => $post->title,
                'body' => $post->body,
                'body_text' => $post->body_text,
                // Always a draft: a duplicate that inherited a schedule would
                // publish itself without anyone choosing to.
                'status' => FeedPost::STATUS_DRAFT,
                'requires_acknowledgement' => $post->requires_acknowledgement,
                'email_audience' => $post->email_audience,
                'email_groups' => $post->email_groups,
                'notify_portal' => $post->notify_portal,
            ]);

            $this->syncMentions($copy, $user);
            FeedContent::syncHashtags($copy, FeedContent::hashtags($copy->body));

            // A poll is copied without its votes, the tally belongs to the
            // post that gathered it.
            if ($post->poll) {
                $poll = FeedPoll::create([
                    'uuid' => (string) Str::uuid(),
                    'post_id' => $copy->id,
                    'question' => $post->poll->question,
                    'multiple_choice' => $post->poll->multiple_choice,
                    'is_anonymous' => $post->poll->is_anonymous,
                    'hide_results_until_closed' => $post->poll->hide_results_until_closed,
                ]);

                foreach ($post->poll->options as $option) {
                    FeedPollOption::create([
                        'uuid' => (string) Str::uuid(),
                        'poll_id' => $poll->id,
                        'label' => $option->label,
                        'position' => $option->position,
                    ]);
                }
            }

            return $copy;
        });

        return response()->json(['post' => FeedPresenter::post($this->reload($copy), $user)], 201);
    }

    /** Delete a post. Its author, or a moderator of its channel (§20). */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid, published: false);
        $channel = $post->channel;

        abort_unless(FeedAccess::canDeletePost($channel, $post, $user), 403, 'You cannot delete this post.');

        $post->delete();

        if ($post->isPublished()) {
            $channel->forceFill(['posts_count' => max(0, $channel->posts_count - 1)])->save();
        }

        FeedPostChanged::dispatch($channel->uuid, 'deleted', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.deleted',
            'actor' => $user,
            'description' => $user->name.' deleted a post in '.$channel->name,
            'subject' => $post,
            'old' => ['author_id' => $post->author_id, 'type' => $post->post_type],
        ]);

        return response()->json(['deleted' => true]);
    }

    /* ── Moderation and reader actions ────────────────────────────── */

    /** Pin or unpin a post (§11). */
    public function togglePin(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);
        $channel = $post->channel;

        abort_unless(FeedAccess::canModerate($channel, $user), 403, 'You cannot pin posts here.');

        $pinning = ! $post->is_pinned;

        $post->forceFill([
            'is_pinned' => $pinning,
            'pinned_at' => $pinning ? Carbon::now() : null,
            'pinned_by' => $pinning ? $user->id : null,
        ])->save();

        FeedPostChanged::dispatch($channel->uuid, 'updated', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.'.($pinning ? 'pinned' : 'unpinned'),
            'actor' => $user,
            'description' => $user->name.($pinning ? ' pinned' : ' unpinned').' a post in '.$channel->name,
            'subject' => $post,
        ]);

        return response()->json(['post' => FeedPresenter::post($this->reload($post), $user)]);
    }

    /** Lock or unlock a post's comments (§20). */
    public function toggleLock(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);
        $channel = $post->channel;

        abort_unless(FeedAccess::canModerate($channel, $user), 403, 'You cannot lock comments here.');

        $post->forceFill(['comments_locked' => ! $post->comments_locked])->save();

        FeedPostChanged::dispatch($channel->uuid, 'updated', $post->uuid);

        ActivityLogger::log([
            'type' => 'post.'.($post->comments_locked ? 'comments_locked' : 'comments_unlocked'),
            'actor' => $user,
            'description' => $user->name.($post->comments_locked ? ' locked' : ' unlocked')
                .' comments on a post in '.$channel->name,
            'subject' => $post,
        ]);

        return response()->json(['post' => FeedPresenter::post($this->reload($post), $user)]);
    }

    /** Bookmark or un-bookmark a post (§15). */
    public function toggleBookmark(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);

        abort_unless(FeedAccess::canEngage($post->channel, $user), 403);

        $existing = FeedBookmark::query()
            ->where('post_id', $post->id)
            ->where('user_id', $user->id)
            ->first();

        if ($existing) {
            $existing->delete();

            return response()->json(['bookmarked' => false]);
        }

        FeedBookmark::create(['post_id' => $post->id, 'user_id' => $user->id]);

        return response()->json(['bookmarked' => true]);
    }

    /**
     * Record that a post's link was taken (§4).
     *
     * Deliberately just a counter: the portal has no way to know where a
     * copied link then goes, so this counts the act of sharing rather than
     * pretending to measure reach. Reading a post is already covered by views.
     */
    public function share(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);

        abort_unless(FeedAccess::canEngage($post->channel, $user), 403);

        $post->increment('shares_count');

        return response()->json(['shares' => $post->fresh()->shares_count]);
    }

    /**
     * Acknowledge an announcement (§12).
     *
     * firstOrCreate rather than create: acknowledging twice is a double-click,
     * not an error, and it must not 500 on the unique index.
     */
    public function acknowledge(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);

        abort_unless(FeedAccess::canEngage($post->channel, $user), 403);
        abort_unless($post->requires_acknowledgement, 422, 'This post does not need acknowledgement.');

        FeedAcknowledgement::firstOrCreate(
            ['post_id' => $post->id, 'user_id' => $user->id],
            ['acknowledged_at' => Carbon::now()],
        );

        ActivityLogger::log([
            'type' => 'post.acknowledged',
            'actor' => $user,
            'description' => $user->name.' acknowledged an announcement',
            'subject' => $post,
        ]);

        return response()->json([
            'acknowledged' => true,
            'count' => $post->acknowledgements()->count(),
        ]);
    }

    /**
     * Who has acknowledged an announcement, and who has not (§12).
     *
     * The "not yet" side is what makes this useful, an administrator needs to
     * know who to chase, which a list of the compliant cannot tell them.
     */
    public function acknowledgements(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $post = $this->postFor($request, $uuid);
        $channel = $post->channel;

        abort_unless(FeedAccess::canModerate($channel, $user), 403);

        $acknowledged = $post->acknowledgements()->with('user')->get();
        $acknowledgedIds = $acknowledged->pluck('user_id')->all();

        $outstanding = $channel->members()
            ->with('user')
            ->whereNotIn('user_id', $acknowledgedIds ?: [0])
            ->get()
            ->pluck('user')
            ->filter();

        return response()->json([
            'acknowledged' => $acknowledged->map(fn (FeedAcknowledgement $a) => [
                'user' => FeedPresenter::person($a->user),
                'at' => $a->acknowledged_at?->toIso8601String(),
            ])->values(),
            'outstanding' => $outstanding->map(fn (User $u) => FeedPresenter::person($u))->values(),
            'total' => $channel->members_count,
        ]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    /**
     * Validate the composer's payload.
     *
     * `creating` decides whether the channel is required, a post never
     * changes channel after it is written, because its attachments, mentions
     * and audience were all resolved against the one it was written in.
     *
     * @return array<string, mixed>
     */
    private function validatePayload(Request $request, bool $creating = true): array
    {
        return $request->validate([
            'channelId' => [$creating ? 'required' : 'prohibited', 'string'],
            'type' => ['nullable', Rule::in(FeedPost::TYPES)],
            'title' => ['nullable', 'string', 'max:255'],
            'body' => ['nullable', 'string', 'max:'.FeedContent::MAX_BODY_LENGTH],
            'status' => ['nullable', Rule::in([
                FeedPost::STATUS_DRAFT, FeedPost::STATUS_SCHEDULED,
                FeedPost::STATUS_PUBLISHED, FeedPost::STATUS_ARCHIVED,
            ])],
            'scheduledFor' => ['nullable', 'date'],
            'timezone' => ['nullable', 'string', 'max:64'],
            'requiresAcknowledgement' => ['nullable', 'boolean'],
            'expiresAt' => ['nullable', 'date'],
            'notifyPortal' => ['nullable', 'boolean'],
            'emailAudience' => ['nullable', Rule::in(FeedPost::EMAIL_AUDIENCES)],
            'emailGroups' => ['nullable', 'array', 'max:50'],
            'emailGroups.*' => ['string'],
            // uuids of files already staged by the attachment endpoint.
            'attachments' => ['nullable', 'array', 'max:'.FeedAttachmentIntake::MAX_PER_POST],
            'attachments.*' => ['string'],
            'poll' => ['nullable', 'array'],
            'poll.question' => ['required_with:poll', 'string', 'max:255'],
            'poll.options' => ['required_with:poll', 'array', 'min:2', 'max:12'],
            'poll.options.*' => ['string', 'max:255'],
            'poll.multipleChoice' => ['nullable', 'boolean'],
            'poll.anonymous' => ['nullable', 'boolean'],
            'poll.closesAt' => ['nullable', 'date'],
            'poll.hideResults' => ['nullable', 'boolean'],
        ]);
    }

    /**
     * Refuse a publish or schedule that cannot work.
     *
     * A draft may be empty, that is what a draft is for. A published post
     * may not be, and a scheduled one needs a time that is actually in the
     * future. Choosing an email audience beyond the channel's own members is
     * a moderator's decision, not any author's.
     *
     * @param  array<string, mixed>  $data
     */
    private function assertPublishable(
        array $data,
        string $status,
        FeedChannel $channel,
        User $user,
        ?FeedPost $existing = null,
    ): void {
        if ($status === FeedPost::STATUS_SCHEDULED) {
            $when = $data['scheduledFor'] ?? $existing?->scheduled_for;

            if (! $when) {
                throw ValidationException::withMessages([
                    'scheduledFor' => 'Choose when this should publish.',
                ]);
            }

            if (Carbon::parse($when)->isPast()) {
                throw ValidationException::withMessages([
                    'scheduledFor' => 'Choose a time in the future.',
                ]);
            }
        }

        if ($status === FeedPost::STATUS_PUBLISHED) {
            $body = array_key_exists('body', $data)
                ? FeedContent::flatten(FeedContent::sanitise($data['body']))
                : FeedContent::flatten($existing?->body);

            $hasPoll = ! empty($data['poll']) || $existing?->poll !== null;
            $hasFiles = ! empty($data['attachments'])
                || ($existing && $existing->attachments()->exists());

            if ($body === '' && ! $hasPoll && ! $hasFiles) {
                throw ValidationException::withMessages([
                    'body' => 'A post needs something in it.',
                ]);
            }
        }

        $audience = $data['emailAudience'] ?? $existing?->email_audience ?? FeedPost::EMAIL_NONE;

        if (
            in_array($audience, [FeedPost::EMAIL_EVERYONE, FeedPost::EMAIL_GROUPS], true)
            && ! FeedAccess::canModerate($channel, $user)
        ) {
            throw ValidationException::withMessages([
                'emailAudience' => 'Only channel moderators can email beyond this channel.',
            ]);
        }
    }

    /**
     * Everything that hangs off a post: attachments, poll, mentions, hashtags.
     *
     * Called by both store() and update(), inside their transaction.
     *
     * @param  array<string, mixed>  $data
     */
    private function syncSidecars(FeedPost $post, FeedChannel $channel, User $user, array $data, ?string $body): void
    {
        if (! empty($data['attachments'])) {
            FeedAttachmentIntake::claim(
                $data['attachments'],
                $channel,
                $user,
                ['post_id' => $post->id],
            );
        }

        if (array_key_exists('poll', $data)) {
            $this->syncPoll($post, $data['poll']);
        }

        $this->syncMentions($post, $user);
        FeedContent::syncHashtags($post, FeedContent::hashtags($body));
    }

    /**
     * Create or replace a post's poll.
     *
     * An existing poll's options are only replaced when the labels actually
     * changed, rewriting them on every edit would discard every vote cast so
     * far, because the votes hang off the option rows.
     *
     * @param  array<string, mixed>|null  $spec
     */
    private function syncPoll(FeedPost $post, ?array $spec): void
    {
        if (! $spec) {
            $post->poll?->delete();

            return;
        }

        $poll = $post->poll ?: FeedPoll::create([
            'uuid' => (string) Str::uuid(),
            'post_id' => $post->id,
            'question' => $spec['question'],
        ]);

        $poll->forceFill([
            'question' => $spec['question'],
            'multiple_choice' => (bool) ($spec['multipleChoice'] ?? false),
            'is_anonymous' => (bool) ($spec['anonymous'] ?? false),
            'hide_results_until_closed' => (bool) ($spec['hideResults'] ?? false),
            'closes_at' => ! empty($spec['closesAt']) ? Carbon::parse($spec['closesAt']) : null,
        ])->save();

        $wanted = array_values(array_filter(array_map('trim', $spec['options'] ?? [])));
        $current = $poll->options()->get();

        if ($current->pluck('label')->all() === $wanted) {
            return;
        }

        // Labels changed, so the options are rebuilt. Votes go with them —
        // which is correct: a vote for an option that no longer exists is not
        // a vote for whatever replaced it.
        $poll->options()->delete();
        $poll->forceFill(['votes_count' => 0])->save();

        foreach ($wanted as $i => $label) {
            FeedPollOption::create([
                'uuid' => (string) Str::uuid(),
                'poll_id' => $poll->id,
                'label' => $label,
                'position' => $i,
            ]);
        }

        $post->setRelation('poll', $poll->fresh('options'));
    }

    /** Rewrite a post's mention rows from what its body now says. */
    private function syncMentions(FeedPost $post, User $actor): void
    {
        $resolved = FeedContent::resolveMentions(
            FeedContent::mentionTokens($post->body),
            $actor,
        );

        $post->mentions()->delete();

        foreach ($resolved['users'] as $user) {
            FeedMention::create(['post_id' => $post->id, 'user_id' => $user->id]);
        }

        foreach ($resolved['groups'] as $group) {
            FeedMention::create(['post_id' => $post->id, 'group_id' => $group->id]);
        }
    }

    /** Bump the channel's post count and activity clock on a publish. */
    private function stampPublished(FeedPost $post, FeedChannel $channel): void
    {
        $channel->forceFill([
            'posts_count' => $channel->posts()->where('status', FeedPost::STATUS_PUBLISHED)->count(),
            'last_activity_at' => Carbon::now(),
        ])->save();
    }

    /**
     * Record that this person has seen the post (§19).
     *
     * A repeat view bumps the row rather than adding one, so the row count is
     * the post's reach while the summed counter is its views. Never throws:
     * a failed view record must not stop the post from opening.
     */
    private function recordView(FeedPost $post, User $user): void
    {
        try {
            $view = FeedPostView::query()
                ->where('post_id', $post->id)
                ->where('user_id', $user->id)
                ->first();

            if ($view) {
                $view->forceFill([
                    'view_count' => $view->view_count + 1,
                    'last_viewed_at' => Carbon::now(),
                ])->save();
            } else {
                FeedPostView::create([
                    'post_id' => $post->id,
                    'user_id' => $user->id,
                    'last_viewed_at' => Carbon::now(),
                    'view_count' => 1,
                ]);
            }

            $post->increment('views_count');
        } catch (\Throwable) {
            // Analytics are not worth failing a page load over.
        }
    }

    /**
     * Resolve a post the caller may read, or 404.
     *
     * `published` false lets the author's own draft through; everything else
     * still has to be visible in a channel they can see.
     */
    public static function resolve(Request $request, string $uuid, bool $published = true): FeedPost
    {
        $user = $request->user();
        Role::authorize($user, 'feed.view');

        $post = FeedPost::query()
            ->with([
                'channel.members' => fn ($q) => $q->where('user_id', $user->id),
                'author', 'attachments', 'poll.options', 'hashtags',
                'mentions.user', 'mentions.group', 'reactions.user',
            ])
            ->where('uuid', $uuid)
            ->first();

        abort_unless($post && $post->channel, 404);
        FeedAccess::authorizeView($post->channel, $user);

        // An unpublished post belongs to its author alone until it goes live.
        if (
            $post->status !== FeedPost::STATUS_PUBLISHED
            && $post->author_id !== $user->id
            && ! FeedAccess::canModerate($post->channel, $user)
        ) {
            abort(404);
        }

        if ($published && ! $post->isPublished() && $post->author_id !== $user->id) {
            abort(404);
        }

        return $post;
    }

    private function postFor(Request $request, string $uuid, bool $published = true): FeedPost
    {
        return self::resolve($request, $uuid, $published);
    }

    /** Reload a post with everything the presenter reads. */
    private function reload(FeedPost $post): FeedPost
    {
        return $post->fresh([
            'channel', 'author', 'attachments', 'poll.options',
            'hashtags', 'mentions.user', 'mentions.group', 'reactions.user',
        ]);
    }
}
