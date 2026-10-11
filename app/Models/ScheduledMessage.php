<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A message waiting for its time: written now, posted by its author at
 * `send_at`. See {@see \App\Support\Messaging\ScheduledMessages}.
 */
#[Fillable([
    'uuid', 'conversation_id', 'user_id', 'body', 'is_announcement',
    'send_at', 'sent_at', 'message_id', 'failed_at', 'failed_reason',
])]
class ScheduledMessage extends Model
{
    protected function casts(): array
    {
        return [
            'is_announcement' => 'boolean',
            'send_at' => 'datetime',
            'sent_at' => 'datetime',
            'failed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (ScheduledMessage $scheduled) {
            $scheduled->uuid ??= (string) Str::uuid();
        });
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** Neither posted nor given up on. */
    public function scopeWaiting(Builder $query): Builder
    {
        return $query->whereNull('sent_at')->whereNull('failed_at');
    }

    /** Waiting, and its time has come. */
    public function scopeDue(Builder $query): Builder
    {
        return $query->waiting()->where('send_at', '<=', now());
    }
}
