<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A Feed channel — the container posts live in and the unit membership is
 * granted on. See the create_feed_channels_table migration for why type,
 * visibility and the *_policy columns are kept apart.
 */
#[Fillable([
    'uuid', 'name', 'slug', 'description', 'channel_type', 'visibility',
    'colour', 'icon', 'avatar_disk', 'avatar_path', 'cover_disk', 'cover_path',
    'owner_id', 'client_id', 'group_id', 'tags',
    'post_policy', 'comment_policy', 'join_policy',
    'is_system', 'is_default', 'is_archived', 'archived_at', 'archived_by',
    'posts_count', 'members_count', 'last_activity_at', 'created_by',
])]
class FeedChannel extends Model
{
    use SoftDeletes;

    public const TYPE_COMPANY = 'company';

    public const TYPE_DEPARTMENT = 'department';

    public const TYPE_TEAM = 'team';

    public const TYPE_PROJECT = 'project';

    public const TYPE_CLIENT = 'client';

    public const TYPE_PRIVATE = 'private';

    public const TYPE_PUBLIC = 'public';

    public const TYPES = [
        self::TYPE_COMPANY, self::TYPE_DEPARTMENT, self::TYPE_TEAM,
        self::TYPE_PROJECT, self::TYPE_CLIENT, self::TYPE_PRIVATE,
        self::TYPE_PUBLIC,
    ];

    /** Every staff account may find and join it. */
    public const VISIBILITY_ORG = 'org';

    /** Members only; invisible to everyone else. */
    public const VISIBILITY_PRIVATE = 'private';

    /** Members only, and the client's own people belong. */
    public const VISIBILITY_CLIENT = 'client';

    public const VISIBILITIES = [
        self::VISIBILITY_ORG, self::VISIBILITY_PRIVATE, self::VISIBILITY_CLIENT,
    ];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'is_system' => 'boolean',
            'is_default' => 'boolean',
            'is_archived' => 'boolean',
            'archived_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function members(): HasMany
    {
        return $this->hasMany(FeedChannelMember::class, 'channel_id');
    }

    public function posts(): HasMany
    {
        return $this->hasMany(FeedPost::class, 'channel_id');
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** This user's membership row, when they have one. */
    public function membershipFor(User $user): ?FeedChannelMember
    {
        // relationLoaded() so a list that eager-loaded memberships doesn't fire
        // one query per channel just to read the viewer's role.
        if ($this->relationLoaded('members')) {
            return $this->members->firstWhere('user_id', $user->id);
        }

        return $this->members()->where('user_id', $user->id)->first();
    }

    /**
     * Channels this user is a member of. Visibility is *not* considered here —
     * membership already implies access, and a person who was added to a
     * private channel keeps seeing it.
     */
    public function scopeMemberOf(Builder $query, User $user): Builder
    {
        return $query->whereHas('members', fn ($q) => $q->where('user_id', $user->id));
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_archived', false);
    }
}
