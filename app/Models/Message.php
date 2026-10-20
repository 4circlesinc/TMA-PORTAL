<?php

namespace App\Models;

use App\Support\Access\Role;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'conversation_id', 'user_id', 'type', 'body',
    'reply_to_id', 'edited_at', 'system_event', 'client_nonce',
    'cip_application_message_id', 'lane', 'is_announcement', 'is_forwarded',
])]
class Message extends Model
{
    use SoftDeletes;

    public const TYPE_TEXT = 'text';

    public const TYPE_VOICE = 'voice';

    public const TYPE_ATTACHMENT = 'attachment';

    public const TYPE_SYSTEM = 'system';

    /** Copied from, or written as, an internal note on the application. */
    public const LANE_INTERNAL = 'internal';

    /** Copied from, or written as, a service-provider message on the application. */
    public const LANE_PROVIDER = 'provider';

    /** How long after sending the author may still edit a text message. */
    public const EDIT_WINDOW_MINUTES = 15;

    protected function casts(): array
    {
        return [
            'edited_at' => 'datetime',
            'deleted_at' => 'datetime',
            'system_event' => 'array',
            'is_announcement' => 'boolean',
            'is_forwarded' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Message $message) {
            $message->uuid ??= (string) Str::uuid();
        });
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(Message::class, 'reply_to_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(MessageAttachment::class);
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(MessageReaction::class);
    }

    public function stars(): HasMany
    {
        return $this->hasMany(MessageStar::class);
    }

    /** Who this message addresses by name, or with @all. */
    public function mentions(): HasMany
    {
        return $this->hasMany(MessageMention::class);
    }

    public function isSystem(): bool
    {
        return $this->type === self::TYPE_SYSTEM;
    }

    public function isInternal(): bool
    {
        return $this->lane === self::LANE_INTERNAL;
    }

    /**
     * Internal notes share the case thread, and stay invisible to everyone
     * who is not staff. A null lane is an ordinary chat message.
     */
    public function scopeVisibleTo(Builder $query, User $viewer): Builder
    {
        if (Role::isStaff($viewer)) {
            return $query;
        }

        return $query->where(function (Builder $inner) {
            $inner->whereNull('lane')->orWhere('lane', '!=', self::LANE_INTERNAL);
        });
    }

    public function hiddenFrom(User $viewer): bool
    {
        return $this->isInternal() && ! Role::isStaff($viewer);
    }

    /**
     * Only the author may edit, only text, and only inside the edit window.
     * System messages are never editable regardless of who triggered them.
     */
    public function isEditableBy(User $user): bool
    {
        return $this->user_id === $user->id
            && $this->type === self::TYPE_TEXT
            && ! $this->isSystem()
            && $this->created_at->diffInMinutes(now()) < self::EDIT_WINDOW_MINUTES;
    }

    /**
     * The author may delete their own message. Group administrators may also
     * remove anyone's, which is the moderation path; system messages stay.
     */
    public function isDeletableBy(User $user, ?ConversationParticipant $participant = null): bool
    {
        if ($this->isSystem()) {
            return false;
        }

        if ($this->user_id === $user->id) {
            return true;
        }

        return $participant?->isAdmin() && $this->conversation->isGroup();
    }
}
