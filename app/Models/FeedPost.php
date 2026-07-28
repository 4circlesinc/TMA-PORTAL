<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A post — and, in the same row, the draft it started as and the scheduled
 * publication it may be waiting on. See the migration for why those are
 * states rather than separate tables.
 */
#[Fillable([
    'uuid', 'channel_id', 'author_id', 'post_type', 'title', 'body', 'body_text',
    'status', 'is_pinned', 'pinned_at', 'pinned_by',
    'requires_acknowledgement', 'expires_at',
    'scheduled_for', 'timezone', 'published_at', 'edited_at', 'comments_locked',
    'email_audience', 'email_groups', 'email_sent_at', 'notify_portal',
    'views_count', 'comments_count', 'reactions_count', 'shares_count', 'metadata',
])]
class FeedPost extends Model
{
    use SoftDeletes;

    public const TYPE_DISCUSSION = 'discussion';

    public const TYPE_QUESTION = 'question';

    public const TYPE_PRAISE = 'praise';

    public const TYPE_POLL = 'poll';

    public const TYPE_ANNOUNCEMENT = 'announcement';

    public const TYPES = [
        self::TYPE_DISCUSSION, self::TYPE_QUESTION, self::TYPE_PRAISE,
        self::TYPE_POLL, self::TYPE_ANNOUNCEMENT,
    ];

    public const STATUS_DRAFT = 'draft';

    public const STATUS_SCHEDULED = 'scheduled';

    public const STATUS_PUBLISHED = 'published';

    public const STATUS_ARCHIVED = 'archived';

    public const STATUSES = [
        self::STATUS_DRAFT, self::STATUS_SCHEDULED,
        self::STATUS_PUBLISHED, self::STATUS_ARCHIVED,
    ];

    /** Who a publish emails. */
    public const EMAIL_NONE = 'none';

    public const EMAIL_EVERYONE = 'everyone';

    public const EMAIL_MEMBERS = 'members';

    public const EMAIL_MENTIONED = 'mentioned';

    public const EMAIL_GROUPS = 'groups';

    public const EMAIL_AUDIENCES = [
        self::EMAIL_NONE, self::EMAIL_EVERYONE, self::EMAIL_MEMBERS,
        self::EMAIL_MENTIONED, self::EMAIL_GROUPS,
    ];

    protected function casts(): array
    {
        return [
            'is_pinned' => 'boolean',
            'pinned_at' => 'datetime',
            'requires_acknowledgement' => 'boolean',
            'expires_at' => 'datetime',
            'scheduled_for' => 'datetime',
            'published_at' => 'datetime',
            'edited_at' => 'datetime',
            'comments_locked' => 'boolean',
            'email_groups' => 'array',
            'email_sent_at' => 'datetime',
            'notify_portal' => 'boolean',
            'metadata' => 'array',
            'deleted_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(FeedChannel::class, 'channel_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function comments(): HasMany
    {
        return $this->hasMany(FeedComment::class, 'post_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(FeedAttachment::class, 'post_id');
    }

    public function poll(): HasOne
    {
        return $this->hasOne(FeedPoll::class, 'post_id');
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(FeedReaction::class, 'reactable_id')
            ->where('reactable_type', FeedReaction::TARGET_POST);
    }

    public function bookmarks(): HasMany
    {
        return $this->hasMany(FeedBookmark::class, 'post_id');
    }

    public function acknowledgements(): HasMany
    {
        return $this->hasMany(FeedAcknowledgement::class, 'post_id');
    }

    public function views(): HasMany
    {
        return $this->hasMany(FeedPostView::class, 'post_id');
    }

    public function mentions(): HasMany
    {
        return $this->hasMany(FeedMention::class, 'post_id');
    }

    public function hashtags(): BelongsToMany
    {
        return $this->belongsToMany(FeedHashtag::class, 'feed_post_hashtag', 'post_id', 'hashtag_id')
            ->withTimestamps();
    }

    public function pinner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'pinned_by');
    }

    public function isPublished(): bool
    {
        return $this->status === self::STATUS_PUBLISHED;
    }

    /**
     * An announcement stops being highlighted once it expires — the record
     * stands, but it no longer demands attention or holds the pinned band.
     */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /** Pinned posts float to the top until they expire. */
    public function isPinnedNow(): bool
    {
        return $this->is_pinned && ! $this->isExpired();
    }

    public function scopePublished(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_PUBLISHED);
    }

    /**
     * Posts in channels this user can read. Used by every cross-channel view
     * (bookmarks, mentions, search) so none of them can leak a post from a
     * channel the reader was never in.
     *
     * @param  array<int, int>  $channelIds  the ids FeedAccess resolved
     */
    public function scopeInChannels(Builder $query, array $channelIds): Builder
    {
        return $query->whereIn('channel_id', $channelIds);
    }
}
