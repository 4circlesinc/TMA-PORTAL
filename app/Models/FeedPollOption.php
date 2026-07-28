<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['uuid', 'poll_id', 'label', 'position', 'votes_count'])]
class FeedPollOption extends Model
{
    public function poll(): BelongsTo
    {
        return $this->belongsTo(FeedPoll::class, 'poll_id');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(FeedPollVote::class, 'option_id');
    }
}
