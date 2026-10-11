<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One person a group message addresses, or everyone when `user_id` is null. */
#[Fillable(['message_id', 'conversation_id', 'user_id', 'label'])]
class MessageMention extends Model
{
    protected function casts(): array
    {
        return [
            'message_id' => 'integer',
            'conversation_id' => 'integer',
            'user_id' => 'integer',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isEveryone(): bool
    {
        return $this->user_id === null;
    }
}
