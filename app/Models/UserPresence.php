<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id', 'last_seen_at', 'online_until',
    'primary_status', 'status_source', 'status_message', 'status_started_at', 'status_expires_at',
])]
class UserPresence extends Model
{
    protected $table = 'user_presence';

    /** A heartbeat marks the user online for this long before it must renew. */
    public const ONLINE_TTL_SECONDS = 45;

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'online_until' => 'datetime',
            'status_started_at' => 'datetime',
            'status_expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Online is derived, not stored as a flag: a tab that closes without
     * telling us simply stops renewing and expires on its own.
     */
    public function isOnline(): bool
    {
        return $this->online_until !== null && $this->online_until->isFuture();
    }
}
