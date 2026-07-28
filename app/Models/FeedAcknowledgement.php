<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person confirming they have read an announcement (§12). The row is the
 * record — acknowledgements are never withdrawn, only made.
 */
#[Fillable(['post_id', 'user_id', 'acknowledged_at'])]
class FeedAcknowledgement extends Model
{
    protected function casts(): array
    {
        return ['acknowledged_at' => 'datetime'];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(FeedPost::class, 'post_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
