<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

#[Fillable(['uuid', 'user_id', 'title', 'last_message_at'])]
class BespokeConversation extends Model
{
    protected static function booted(): void
    {
        static::creating(function (self $conversation) {
            $conversation->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'last_message_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(BespokeMessage::class, 'conversation_id');
    }

    public function latestMessage(): HasOne
    {
        return $this->hasOne(BespokeMessage::class, 'conversation_id')->latestOfMany();
    }
}
