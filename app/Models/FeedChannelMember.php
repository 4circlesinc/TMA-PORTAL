<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person's membership of one channel, and the role it carries.
 *
 * The ladder is owner > admin > moderator > member; App\Support\Feed\FeedAccess
 * turns a rung plus the channel's policy columns into a yes or no.
 */
#[Fillable([
    'channel_id', 'user_id', 'role', 'is_muted', 'email_frequency',
    'last_read_at', 'joined_at', 'added_by',
])]
class FeedChannelMember extends Model
{
    public const ROLE_OWNER = 'owner';

    public const ROLE_ADMIN = 'admin';

    public const ROLE_MODERATOR = 'moderator';

    public const ROLE_MEMBER = 'member';

    /** Ascending reach. Index position *is* the rung. */
    public const ROLES = [
        self::ROLE_MEMBER, self::ROLE_MODERATOR, self::ROLE_ADMIN, self::ROLE_OWNER,
    ];

    public const EMAIL_ALL = 'all';

    public const EMAIL_MENTIONS = 'mentions';

    public const EMAIL_NONE = 'none';

    public const EMAIL_FREQUENCIES = [self::EMAIL_ALL, self::EMAIL_MENTIONS, self::EMAIL_NONE];

    protected function casts(): array
    {
        return [
            'is_muted' => 'boolean',
            'last_read_at' => 'datetime',
            'joined_at' => 'datetime',
        ];
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(FeedChannel::class, 'channel_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** How far up the ladder this member sits. Higher wins. */
    public function rank(): int
    {
        $index = array_search($this->role, self::ROLES, true);

        return $index === false ? 0 : $index;
    }
}
