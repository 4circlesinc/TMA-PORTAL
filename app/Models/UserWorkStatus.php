<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one person is currently working on, shown in the Updates tab.
 *
 * One row per user and no history — see the migration for why. Expiry is
 * applied at read time through {@see scopeCurrent} rather than by a sweep, so
 * an expired status is invisible the moment it lapses whether or not anything
 * has cleaned up after it.
 */
#[Fillable(['user_id', 'emoji', 'text', 'expires_at'])]
class UserWorkStatus extends Model
{
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Statuses that are still showing: never expired, never blank. */
    public function scopeCurrent(Builder $query): Builder
    {
        return $query->where(function (Builder $q) {
            $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
        });
    }

    public function hasExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    public function toRecord(): array
    {
        return [
            'emoji' => $this->emoji,
            'text' => $this->text,
            'expiresAt' => $this->expires_at?->toIso8601String(),
            'updatedAt' => $this->updated_at?->toIso8601String(),
        ];
    }
}
