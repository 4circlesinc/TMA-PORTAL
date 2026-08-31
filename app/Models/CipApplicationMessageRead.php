<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How far this reader has got in an application's thread (§24).
 *
 * A high-water mark, the same idea as conversation_participants.last_read_message_id:
 * everything at or below last_read_id has been on their screen.
 */
#[Fillable(['user_id', 'application_id', 'last_read_id'])]
class CipApplicationMessageRead extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }
}
