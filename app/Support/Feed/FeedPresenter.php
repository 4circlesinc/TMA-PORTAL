<?php

namespace App\Support\Feed;

use App\Models\FeedAttachment;
use App\Models\FeedChannel;
use App\Models\FeedChannelMember;
use App\Models\FeedComment;
use App\Models\FeedPoll;
use App\Models\FeedPost;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Every JSON shape the Feed hands to the browser.
 *
 * One class so the client can rely on a channel looking the same in the
 * sidebar, in a search result and in a post's header. Two rules run through
 * all of it:
 *
 *  - **Permissions travel with the record.** Each payload carries a `can`
 *    object saying what *this viewer* may do with it, so the UI never has to
 *    re-derive the rules and never renders a button the server would refuse.
 *    The server still enforces every one of them.
 *  - **Anonymity is enforced here.** An anonymous poll's voters are never
 *    named in a payload, and a private channel's member list is only
 *    populated for someone who may manage it.
 */
final class FeedPresenter
{
    /* ── Channels ─────────────────────────────────────────────────── */

    /**
     * One channel, as the sidebar and the channel header see it.
     *
     * @return array<string, mixed>
     */
    public static function channel(FeedChannel $channel, User $viewer, ?int $unread = null): array
    {
        $member = FeedAccess::member($channel, $viewer);

        return [
            'id' => $channel->uuid,
            'name' => $channel->name,
            'slug' => $channel->slug,
            'description' => $channel->description,
            'type' => $channel->channel_type,
            'visibility' => $channel->visibility,
            'colour' => $channel->colour,
            'icon' => $channel->icon,
            'avatar' => self::imageUrl($channel, 'avatar'),
            'cover' => self::imageUrl($channel, 'cover'),
            'tags' => $channel->tags ?: [],
            'owner' => $channel->relationLoaded('owner') ? self::person($channel->owner) : null,
            'clientId' => $channel->client?->uuid,
            'groupId' => $channel->group?->uuid,
            'postsCount' => (int) $channel->posts_count,
            'memberCount' => (int) $channel->members_count,
            'lastActivityAt' => $channel->last_activity_at?->toIso8601String(),
            'isArchived' => (bool) $channel->is_archived,
            'isSystem' => (bool) $channel->is_system,
            'isDefault' => (bool) $channel->is_default,
            'createdAt' => $channel->created_at?->toIso8601String(),

            // The viewer's own relationship to the channel.
            'membership' => $member ? [
                'role' => $member->role,
                'muted' => (bool) $member->is_muted,
                'emailFrequency' => $member->email_frequency,
                'lastReadAt' => $member->last_read_at?->toIso8601String(),
                'joinedAt' => $member->joined_at?->toIso8601String(),
            ] : null,
            'isMember' => $member !== null,
            'unread' => $unread,

            'policies' => [
                'post' => $channel->post_policy,
                'comment' => $channel->comment_policy,
                'join' => $channel->join_policy,
            ],

            'can' => [
                'post' => FeedAccess::canPost($channel, $viewer),
                'join' => FeedAccess::canJoin($channel, $viewer),
                'leave' => FeedAccess::canLeave($channel, $viewer),
                'moderate' => FeedAccess::canModerate($channel, $viewer),
                'manage' => FeedAccess::canManageChannel($channel, $viewer),
                'delete' => FeedAccess::canDeleteChannel($channel, $viewer),
                'analytics' => FeedAccess::canViewAnalytics($channel, $viewer),
            ],
        ];
    }

    /** A channel reduced to what a post header needs. */
    public static function channelStub(?FeedChannel $channel): ?array
    {
        if (! $channel) {
            return null;
        }

        return [
            'id' => $channel->uuid,
            'name' => $channel->name,
            'slug' => $channel->slug,
            'colour' => $channel->colour,
            'icon' => $channel->icon,
        ];
    }

    /** One channel member row, for the members screen. */
    public static function member(FeedChannelMember $member): array
    {
        return [
            'user' => self::person($member->user),
            'role' => $member->role,
            'muted' => (bool) $member->is_muted,
            'emailFrequency' => $member->email_frequency,
            'joinedAt' => $member->joined_at?->toIso8601String(),
        ];
    }

    /* ── Posts ────────────────────────────────────────────────────── */

    /**
     * One post, as a card in the stream.
     *
     * `$viewerState` carries the per-viewer facts that would otherwise be one
     * query per card — their reaction, whether they bookmarked it, whether
     * they acknowledged it. The caller loads them in bulk for the whole page.
     *
     * @param  array{reaction?: ?string, bookmarked?: bool, acknowledged?: bool, voted?: array<int, string>}  $viewerState
     * @return array<string, mixed>
     */
    public static function post(FeedPost $post, User $viewer, array $viewerState = []): array
    {
        $channel = $post->channel;

        return [
            'id' => $post->uuid,
            // Monotonic ordering key. The client pages and de-duplicates on
            // this rather than on timestamps, which can collide.
            'seq' => $post->id,
            'type' => $post->post_type,
            'status' => $post->status,
            'title' => $post->title,
            'body' => $post->body,
            'excerpt' => FeedContent::excerpt($post->body, 240),
            'channel' => self::channelStub($channel),
            'author' => self::person($post->author),
            'publishedAt' => $post->published_at?->toIso8601String(),
            'createdAt' => $post->created_at?->toIso8601String(),
            'scheduledFor' => $post->scheduled_for?->toIso8601String(),
            'timezone' => $post->timezone,
            'edited' => $post->edited_at !== null,
            'editedAt' => $post->edited_at?->toIso8601String(),
            'visibility' => $channel?->visibility,

            'isPinned' => (bool) $post->is_pinned,
            'isAnnouncement' => $post->post_type === FeedPost::TYPE_ANNOUNCEMENT,
            'requiresAcknowledgement' => (bool) $post->requires_acknowledgement,
            'expiresAt' => $post->expires_at?->toIso8601String(),
            'isExpired' => $post->isExpired(),
            'commentsLocked' => (bool) $post->comments_locked,

            'counts' => [
                'views' => (int) $post->views_count,
                'comments' => (int) $post->comments_count,
                'reactions' => (int) $post->reactions_count,
                'shares' => (int) $post->shares_count,
            ],

            'reactions' => self::reactionSummary($post, $viewer, $viewerState['reaction'] ?? null),
            'attachments' => $post->relationLoaded('attachments')
                ? $post->attachments->map(fn (FeedAttachment $a) => self::attachment($a))->values()
                : [],
            'poll' => $post->relationLoaded('poll') && $post->poll
                ? self::poll($post->poll, $viewer, $viewerState['voted'] ?? [])
                : null,
            'hashtags' => $post->relationLoaded('hashtags')
                ? $post->hashtags->map(fn ($h) => $h->display_tag)->values()
                : [],
            'mentions' => $post->relationLoaded('mentions')
                ? $post->mentions->map(fn ($m) => [
                    'user' => $m->relationLoaded('user') ? self::person($m->user) : null,
                    'group' => $m->relationLoaded('group') && $m->group
                        ? ['id' => $m->group->uuid, 'name' => $m->group->name]
                        : null,
                ])->values()
                : [],

            'bookmarked' => (bool) ($viewerState['bookmarked'] ?? false),
            'acknowledged' => (bool) ($viewerState['acknowledged'] ?? false),

            // Email fan-out is the author's and moderators' business, not
            // every reader's — so it is only reported to those who may see it.
            'email' => $channel && FeedAccess::canModerate($channel, $viewer)
                ? [
                    'audience' => $post->email_audience,
                    'sentAt' => $post->email_sent_at?->toIso8601String(),
                ]
                : null,

            'can' => $channel ? [
                'comment' => FeedAccess::canComment($channel, $post, $viewer),
                'react' => FeedAccess::canEngage($channel, $viewer),
                'edit' => FeedAccess::canEditPost($post, $viewer),
                'delete' => FeedAccess::canDeletePost($channel, $post, $viewer),
                'pin' => FeedAccess::canModerate($channel, $viewer),
                'lock' => FeedAccess::canModerate($channel, $viewer),
                'viewAcknowledgements' => FeedAccess::canModerate($channel, $viewer),
            ] : [],
        ];
    }

    /* ── Comments ─────────────────────────────────────────────────── */

    /**
     * One comment. Replies are nested one level, matching how they are stored.
     *
     * @param  array<int, string>  $myReactions  comment id => emoji
     */
    public static function comment(
        FeedComment $comment,
        User $viewer,
        FeedChannel $channel,
        FeedPost $post,
        array $myReactions = [],
        Collection $replies = new Collection,
    ): array {
        return [
            'id' => $comment->uuid,
            'seq' => $comment->id,
            'body' => $comment->body,
            'author' => self::person($comment->author),
            'createdAt' => $comment->created_at?->toIso8601String(),
            'edited' => $comment->edited_at !== null,
            'parentId' => $comment->parent?->uuid,
            'repliesCount' => (int) $comment->replies_count,
            'reactions' => self::reactionSummary(
                $comment, $viewer, $myReactions[$comment->id] ?? null, 'reactions_count'
            ),
            'attachments' => $comment->relationLoaded('attachments')
                ? $comment->attachments->map(fn (FeedAttachment $a) => self::attachment($a))->values()
                : [],
            'replies' => $replies
                ->map(fn (FeedComment $r) => self::comment($r, $viewer, $channel, $post, $myReactions))
                ->values(),
            'can' => [
                'edit' => FeedAccess::canEditComment($comment, $viewer),
                'delete' => FeedAccess::canDeleteComment($channel, $comment, $viewer),
                'reply' => FeedAccess::canComment($channel, $post, $viewer),
                'react' => FeedAccess::canEngage($channel, $viewer),
            ],
        ];
    }

    /* ── Polls ────────────────────────────────────────────────────── */

    /**
     * A poll and its live tally.
     *
     * When results are hidden until closing, the counts are withheld rather
     * than rendered as zero — a zero would read as "nobody voted", which is a
     * different and misleading statement.
     *
     * @param  array<int, string>  $votedOptionUuids
     */
    public static function poll(FeedPoll $poll, User $viewer, array $votedOptionUuids = []): array
    {
        $closed = $poll->isClosed();
        $showResults = $poll->resultsVisible();

        return [
            'id' => $poll->uuid,
            'question' => $poll->question,
            'multipleChoice' => (bool) $poll->multiple_choice,
            'anonymous' => (bool) $poll->is_anonymous,
            'closesAt' => $poll->closes_at?->toIso8601String(),
            'closedAt' => $poll->closed_at?->toIso8601String(),
            'isClosed' => $closed,
            'resultsVisible' => $showResults,
            'totalVotes' => $showResults ? (int) $poll->votes_count : null,
            'hasVoted' => $votedOptionUuids !== [],
            'options' => $poll->options->map(fn ($option) => [
                'id' => $option->uuid,
                'label' => $option->label,
                'votes' => $showResults ? (int) $option->votes_count : null,
                'chosen' => in_array($option->uuid, $votedOptionUuids, true),
            ])->values(),
        ];
    }

    /* ── Attachments ──────────────────────────────────────────────── */

    public static function attachment(FeedAttachment $attachment): array
    {
        return [
            'id' => $attachment->uuid,
            'name' => $attachment->name,
            'mime' => $attachment->mime,
            'extension' => $attachment->extension,
            'size' => (int) $attachment->size,
            'width' => $attachment->width,
            'height' => $attachment->height,
            'durationMs' => $attachment->duration_ms,
            'kind' => match (true) {
                $attachment->isImage() => 'image',
                $attachment->isVideo() => 'video',
                $attachment->isAudio() => 'audio',
                default => 'file',
            },
            // Bytes are never public: both routes re-check channel access.
            'url' => route('feed.attachments.show', ['uuid' => $attachment->uuid]),
            'thumbUrl' => $attachment->thumb_path
                ? route('feed.attachments.thumb', ['uuid' => $attachment->uuid])
                : null,
        ];
    }

    /* ── People ───────────────────────────────────────────────────── */

    /** A person, as every card header renders them. */
    public static function person(?User $user): ?array
    {
        if (! $user) {
            return null;
        }

        return [
            'id' => $user->id,
            'name' => $user->name,
            'photo' => $user->avatar_url,
            'role' => $user->job_title,
            'accountType' => $user->account_type,
        ];
    }

    /* ── Reactions ────────────────────────────────────────────────── */

    /**
     * A target's reactions grouped by emoji, with the viewer's own marked.
     *
     * Expects `reactions` to be loaded; falls back to the stored counter when
     * it is not, so a list view that skipped the relation still shows a total.
     *
     * @return array{total: int, mine: ?string, groups: array<int, array<string, mixed>>}
     */
    private static function reactionSummary(
        FeedPost|FeedComment $target,
        User $viewer,
        ?string $mine = null,
        string $counterColumn = 'reactions_count',
    ): array {
        if (! $target->relationLoaded('reactions')) {
            return [
                'total' => (int) $target->{$counterColumn},
                'mine' => $mine,
                'groups' => [],
            ];
        }

        $groups = $target->reactions
            ->groupBy('emoji')
            ->map(fn (Collection $rows, string $emoji) => [
                'emoji' => $emoji,
                'count' => $rows->count(),
                'mine' => $rows->contains('user_id', $viewer->id),
                // Names for the "who reacted" popover (§10). Capped, because a
                // company-wide announcement can gather hundreds.
                'people' => $rows->take(12)
                    ->map(fn ($r) => $r->relationLoaded('user') ? self::person($r->user) : null)
                    ->filter()
                    ->values(),
            ])
            ->sortByDesc('count')
            ->values()
            ->all();

        return [
            'total' => $target->reactions->count(),
            'mine' => $mine ?? $target->reactions->firstWhere('user_id', $viewer->id)?->emoji,
            'groups' => $groups,
        ];
    }

    /* ── Images ───────────────────────────────────────────────────── */

    /**
     * A channel's avatar or cover URL, or null when it has none.
     *
     * Like every other stored image in the portal these are served through a
     * controller rather than from a public path, so access is re-checked and
     * the storage disk stays invisible.
     */
    private static function imageUrl(FeedChannel $channel, string $which): ?string
    {
        $path = $which === 'avatar' ? $channel->avatar_path : $channel->cover_path;

        if (! $path) {
            return null;
        }

        return route('feed.channels.image', [
            'uuid' => $channel->uuid,
            'which' => $which,
            // Cache-buster: the URL is stable per channel, so without this a
            // replaced picture keeps showing the old bytes.
            'v' => substr(md5($path), 0, 8),
        ]);
    }
}
