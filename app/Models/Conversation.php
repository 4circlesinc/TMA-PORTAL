<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

#[Fillable([
    'uuid', 'type', 'name', 'description', 'photo_disk', 'photo_path',
    'created_by', 'last_message_at', 'is_default', 'auto_join', 'disabled_at',
])]
class Conversation extends Model
{
    use SoftDeletes;

    public const TYPE_DIRECT = 'direct';

    public const TYPE_GROUP = 'group';

    protected function casts(): array
    {
        return [
            'last_message_at' => 'datetime',
            'deleted_at' => 'datetime',
            'disabled_at' => 'datetime',
            'is_default' => 'boolean',
            'auto_join' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (Conversation $conversation) {
            $conversation->uuid ??= (string) Str::uuid();
        });
    }

    public function participants(): HasMany
    {
        return $this->hasMany(ConversationParticipant::class);
    }

    /** Members who have not left. The people a new message actually reaches. */
    public function activeParticipants(): HasMany
    {
        return $this->participants()->whereNull('left_at');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isGroup(): bool
    {
        return $this->type === self::TYPE_GROUP;
    }

    public function isDisabled(): bool
    {
        return $this->disabled_at !== null;
    }

    /**
     * Who may rename, re-photograph, or change the membership of this group.
     *
     * The organization-wide chat belongs to the firm, not to whoever happens
     * to be in it, so it is administrator-only however its participant roles
     * are set. Any other group is run by its own admins.
     */
    public function isManageableBy(User $user): bool
    {
        if (! $this->isGroup()) {
            return false;
        }

        if ($this->is_default) {
            return $user->account_type === 'Administrator';
        }

        return (bool) $this->participantFor($user)?->isAdmin();
    }

    /**
     * Whether a participant may walk away.
     *
     * Nobody leaves the organization chat by choice — it is the firm's shared
     * record, and an accidental tap should not remove someone from it.
     */
    public function isLeavableBy(User $user): bool
    {
        if ($this->is_default) {
            return false;
        }

        return $this->participantFor($user) !== null;
    }

    /**
     * The authorization boundary for the whole feature: conversations the given
     * user is currently a member of. Every read path starts from this scope, so
     * a conversation the user does not belong to is never even a candidate.
     */
    public function scopeForUser(Builder $query, User $user): Builder
    {
        return $query->whereHas('participants', function (Builder $participants) use ($user) {
            $participants->where('user_id', $user->id)->whereNull('left_at');
        });
    }

    /** This user's own membership row, or null if they are not a member. */
    public function participantFor(User $user): ?ConversationParticipant
    {
        return $this->participants()
            ->where('user_id', $user->id)
            ->whereNull('left_at')
            ->first();
    }

    /** The other side of a direct thread, from the viewer's perspective. */
    public function counterpartFor(User $user): ?User
    {
        if ($this->isGroup()) {
            return null;
        }

        return $this->activeParticipants()
            ->where('user_id', '!=', $user->id)
            ->with('user')
            ->first()?->user;
    }
}
