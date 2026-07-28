<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A comment on a post, or — through `parent_id` — a reply to one.
 *
 * Threading is one level deep by design: a reply to a reply keeps the same
 * `root_id`, so a thread stays a readable pair of columns and can be loaded
 * in one query instead of being walked.
 */
#[Fillable([
    'uuid', 'post_id', 'author_id', 'parent_id', 'root_id',
    'body', 'body_text', 'edited_at', 'reactions_count', 'replies_count',
])]
class FeedComment extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'edited_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(FeedPost::class, 'post_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'root_id')->whereNotNull('parent_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(FeedAttachment::class, 'comment_id');
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(FeedReaction::class, 'reactable_id')
            ->where('reactable_type', FeedReaction::TARGET_COMMENT);
    }

    public function mentions(): HasMany
    {
        return $this->hasMany(FeedMention::class, 'comment_id');
    }

    public function isReply(): bool
    {
        return $this->parent_id !== null;
    }
}
