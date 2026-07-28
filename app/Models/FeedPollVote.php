<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['poll_id', 'option_id', 'user_id'])]
class FeedPollVote extends Model
{
    public function poll(): BelongsTo
    {
        return $this->belongsTo(FeedPoll::class, 'poll_id');
    }

    public function option(): BelongsTo
    {
        return $this->belongsTo(FeedPollOption::class, 'option_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
