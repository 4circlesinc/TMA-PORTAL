<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[\Illuminate\Database\Eloquent\Attributes\Fillable([
    'user_id', 'status', 'status_message', 'starts_at', 'ends_at', 'recurrence', 'enabled',
])]
class UserStatusSchedule extends Model
{
    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'enabled' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isActiveNow(): bool
    {
        if (! $this->enabled) {
            return false;
        }
        $now = now();

        return $this->starts_at->lte($now) && $this->ends_at->gt($now);
    }
}
