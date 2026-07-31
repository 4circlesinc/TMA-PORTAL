<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['file_id', 'user_id', 'session_id', 'action', 'device', 'opened_at', 'last_heartbeat_at'])]
class FilePresenceSession extends Model
{
    /** A session that has not renewed within this long is treated as gone. */
    public const STALE_SECONDS = 45;

    protected function casts(): array
    {
        return ['opened_at' => 'datetime', 'last_heartbeat_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Live is derived, never stored: a tab that closed without telling us stops
     * renewing and ages out by itself.
     */
    public function isLive(): bool
    {
        return $this->last_heartbeat_at !== null
            && $this->last_heartbeat_at->gt(now()->subSeconds(self::STALE_SECONDS));
    }
}
