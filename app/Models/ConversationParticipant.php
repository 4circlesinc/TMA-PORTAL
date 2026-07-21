<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'conversation_id', 'user_id', 'role', 'last_read_message_id', 'last_read_at',
    'marked_unread_at', 'pinned_at', 'archived_at', 'muted_until',
    'draft', 'draft_updated_at', 'joined_at', 'left_at',
])]
class ConversationParticipant extends Model
{
    public const ROLE_MEMBER = 'member';

    public const ROLE_ADMIN = 'admin';

    protected function casts(): array
    {
        return [
            'last_read_at' => 'datetime',
            'marked_unread_at' => 'datetime',
            'pinned_at' => 'datetime',
            'archived_at' => 'datetime',
            'muted_until' => 'datetime',
            'draft_updated_at' => 'datetime',
            'joined_at' => 'datetime',
            'left_at' => 'datetime',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_ADMIN;
    }

    public function isMuted(): bool
    {
        return $this->muted_until !== null && $this->muted_until->isFuture();
    }

    /**
     * Unread messages for this participant: anything newer than their read
     * high-water mark, not counting their own sends and deleted messages.
     */
    public function unreadCount(): int
    {
        return Message::query()
            ->where('conversation_id', $this->conversation_id)
            ->where('id', '>', $this->last_read_message_id ?? 0)
            ->where(function ($query) {
                $query->whereNull('user_id')->orWhere('user_id', '!=', $this->user_id);
            })
            ->count();
    }
}
