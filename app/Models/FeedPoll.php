<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A poll attached to a post.
 *
 * `is_anonymous` hides who voted, never the tally — the voter id is still
 * stored, because without it one person could vote repeatedly and the result
 * would be worthless. FeedPresenter is what refuses to name them.
 */
#[Fillable([
    'uuid', 'post_id', 'question', 'multiple_choice', 'is_anonymous',
    'closes_at', 'closed_at', 'hide_results_until_closed', 'votes_count',
])]
class FeedPoll extends Model
{
    protected function casts(): array
    {
        return [
            'multiple_choice' => 'boolean',
            'is_anonymous' => 'boolean',
            'hide_results_until_closed' => 'boolean',
            'closes_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(FeedPost::class, 'post_id');
    }

    public function options(): HasMany
    {
        return $this->hasMany(FeedPollOption::class, 'poll_id')->orderBy('position');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(FeedPollVote::class, 'poll_id');
    }

    /** Closed by hand, or because its closing time passed. */
    public function isClosed(): bool
    {
        return $this->closed_at !== null
            || ($this->closes_at !== null && $this->closes_at->isPast());
    }

    /** May the reader see the tally yet? */
    public function resultsVisible(): bool
    {
        return ! $this->hide_results_until_closed || $this->isClosed();
    }
}
