<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Someone (or some group) named in a post or a comment.
 *
 * A group mention keeps its group id rather than being expanded into one row
 * per member: the membership at *read* time is what matters, and expanding at
 * write time would leave a person who joined afterwards out of the thread.
 */
#[Fillable(['post_id', 'comment_id', 'user_id', 'group_id'])]
class FeedMention extends Model
{
    public function post(): BelongsTo
    {
        return $this->belongsTo(FeedPost::class, 'post_id');
    }

    public function comment(): BelongsTo
    {
        return $this->belongsTo(FeedComment::class, 'comment_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }
}
