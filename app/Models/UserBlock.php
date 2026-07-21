<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'blocked_user_id'])]
class UserBlock extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function blocked(): BelongsTo
    {
        return $this->belongsTo(User::class, 'blocked_user_id');
    }

    /** True when either side has blocked the other - blocking cuts both ways. */
    public static function blockedBetween(int $userId, int $otherId): bool
    {
        return static::query()
            ->where(fn ($q) => $q->where('user_id', $userId)->where('blocked_user_id', $otherId))
            ->orWhere(fn ($q) => $q->where('user_id', $otherId)->where('blocked_user_id', $userId))
            ->exists();
    }
}
