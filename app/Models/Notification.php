<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Str;

/**
 * A single portal notification addressed to one recipient. Written only through
 * {@see \App\Support\Notifications\Notifier}. Lives in `portal_notifications`
 * so it never collides with Laravel's reserved `notifications` table.
 */
#[Fillable([
    'uid', 'user_id', 'actor_id', 'type', 'level', 'module', 'title', 'message',
    'icon', 'image', 'subject_type', 'subject_id', 'client_id', 'action_url',
    'action_label', 'priority', 'dedupe_key', 'read_at', 'completed_at', 'metadata',
])]
class Notification extends Model
{
    protected $table = 'portal_notifications';

    /** Semantic levels (§14) — drive icon tone, never a bespoke colour. */
    public const LEVEL_INFO = 'info';
    public const LEVEL_SUCCESS = 'success';
    public const LEVEL_WARNING = 'warning';
    public const LEVEL_ERROR = 'error';
    public const LEVEL_ACTION = 'action_required';
    public const LEVEL_APPROVAL = 'approval_required';
    public const LEVEL_SECURITY = 'security';
    public const LEVEL_REMINDER = 'reminder';

    public const PRIORITY_LOW = 'low';
    public const PRIORITY_NORMAL = 'normal';
    public const PRIORITY_HIGH = 'high';
    public const PRIORITY_URGENT = 'urgent';

    protected function casts(): array
    {
        return [
            'read_at' => 'datetime',
            'completed_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Notification $notification) {
            $notification->uid ??= (string) Str::ulid();
        });
    }

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    public function isRead(): bool
    {
        return $this->read_at !== null;
    }

    /** System-generated notifications render a circular icon, not an avatar. */
    public function isSystem(): bool
    {
        return $this->actor_id === null;
    }

    /**
     * Action-required and approval-required items stay easy to find until the
     * underlying task is done, even after they're marked read (§20).
     */
    public function requiresAction(): bool
    {
        return in_array($this->level, [self::LEVEL_ACTION, self::LEVEL_APPROVAL], true)
            && $this->completed_at === null;
    }

    public function scopeForUser(Builder $query, User $user): Builder
    {
        return $query->where('user_id', $user->id);
    }

    public function scopeUnread(Builder $query): Builder
    {
        return $query->whereNull('read_at');
    }

    public function scopeLatestFirst(Builder $query): Builder
    {
        return $query->orderByDesc('created_at')->orderByDesc('id');
    }
}
