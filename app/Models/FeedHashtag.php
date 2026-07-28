<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * A hashtag. Stored folded to lower case so #Q3 and #q3 are one topic;
 * `display_tag` keeps the casing it was first written with.
 */
#[Fillable(['tag', 'display_tag', 'posts_count', 'last_used_at'])]
class FeedHashtag extends Model
{
    protected function casts(): array
    {
        return ['last_used_at' => 'datetime'];
    }

    public function posts(): BelongsToMany
    {
        return $this->belongsToMany(FeedPost::class, 'feed_post_hashtag', 'hashtag_id', 'post_id')
            ->withTimestamps();
    }

    /** Fold a written tag to its stored form. */
    public static function normalise(string $tag): string
    {
        return mb_strtolower(ltrim(trim($tag), '#'));
    }
}
