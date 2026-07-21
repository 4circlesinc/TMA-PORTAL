<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

#[Fillable(['uuid', 'type', 'name', 'photo_disk', 'photo_path', 'created_by', 'last_message_at'])]
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
