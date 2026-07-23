<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Support\Str;

/**
 * One row of the portal audit trail. Written only through
 * {@see \App\Support\Activity\ActivityLogger}; never mass-assigned from input.
 */
#[Fillable([
    'uid', 'actor_id', 'activity_type', 'module', 'action', 'description',
    'subject_type', 'subject_id', 'client_id', 'old_values', 'new_values',
    'ip_address', 'user_agent', 'status', 'metadata',
])]
class ActivityLog extends Model
{
    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILURE = 'failure';
    public const STATUS_PENDING = 'pending';

    protected function casts(): array
    {
        return [
            'old_values' => 'array',
            'new_values' => 'array',
            'metadata' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (ActivityLog $log) {
            $log->uid ??= (string) Str::ulid();
        });
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

    /** Whether the system (not a person) performed this activity. */
    public function isSystem(): bool
    {
        return $this->actor_id === null;
    }

    /** Newest first — the order every surface renders in. */
    public function scopeLatestFirst(Builder $query): Builder
    {
        return $query->orderByDesc('created_at')->orderByDesc('id');
    }

    /**
     * Scope the log to what a viewer is permitted to see (§9, §28).
     *
     * Administrators see the whole firm's trail. Everyone else sees only the
     * activity they performed — the privacy-first default; a stray uid must
     * never expose another person's actions. Broader team visibility can be
     * layered on here without touching every call site.
     */
    public function scopeVisibleTo(Builder $query, User $viewer): Builder
    {
        if ($viewer->account_type === 'Administrator') {
            return $query;
        }

        return $query->where('actor_id', $viewer->id);
    }
}
