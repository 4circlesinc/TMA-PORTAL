<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The first time this person saw this chat message.
 *
 * Written once, when their read cursor moves past the message, and left
 * alone after that so a later visit cannot change the time they saw it.
 */
class MessageReceipt extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'conversation_id', 'message_id', 'user_id', 'seen_at',
    ];

    protected function casts(): array
    {
        return [
            'seen_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }
}
