<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One person's viewing of one post. Repeat views bump the counter rather than
 * adding a row, so the row count is the post's *reach* while `view_count`
 * sums to its views (§19).
 */
#[Fillable(['post_id', 'user_id', 'last_viewed_at', 'view_count'])]
class FeedPostView extends Model
{
    protected function casts(): array
    {
        return ['last_viewed_at' => 'datetime'];
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
