<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An emoji reaction on a post or a comment.
 *
 * One row per person per target — the unique key is (target, user), so
 * reacting again changes the reaction rather than adding a second one.
 */
#[Fillable(['reactable_type', 'reactable_id', 'user_id', 'emoji'])]
class FeedReaction extends Model
{
    public const TARGET_POST = 'post';

    public const TARGET_COMMENT = 'comment';

    public const TARGETS = [self::TARGET_POST, self::TARGET_COMMENT];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeForPost(Builder $query, int $postId): Builder
    {
        return $query->where('reactable_type', self::TARGET_POST)
            ->where('reactable_id', $postId);
    }

    public function scopeForComment(Builder $query, int $commentId): Builder
    {
        return $query->where('reactable_type', self::TARGET_COMMENT)
            ->where('reactable_id', $commentId);
    }
}
