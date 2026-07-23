<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One invitee on one event: a portal user, a whole group, or a bare email
 * address for someone with no login.
 *
 * `response` uses the iCalendar PARTSTAT vocabulary so it maps onto Google and
 * Microsoft unchanged when sync lands.
 */
#[Fillable([
    'event_id', 'attendee_type', 'user_id', 'group_id', 'email', 'name',
    'response', 'responded_at', 'is_optional', 'notified_at',
])]
class CalendarEventAttendee extends Model
{
    public const TYPE_USER = 'user';

    public const TYPE_GROUP = 'group';

    public const TYPE_EMAIL = 'email';

    public const NEEDS_ACTION = 'needs_action';

    public const ACCEPTED = 'accepted';

    public const TENTATIVE = 'tentative';

    public const DECLINED = 'declined';

    public const RESPONSES = [self::NEEDS_ACTION, self::ACCEPTED, self::TENTATIVE, self::DECLINED];

    protected function casts(): array
    {
        return [
            'responded_at' => 'datetime',
            'notified_at' => 'datetime',
            'is_optional' => 'boolean',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(CalendarEvent::class, 'event_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    /** The name to show, whichever kind of attendee this is. */
    public function displayName(): string
    {
        return match ($this->attendee_type) {
            self::TYPE_GROUP => $this->group?->name ?? 'Group',
            self::TYPE_USER => $this->user?->name ?? 'Someone',
            default => $this->name ?: (string) $this->email,
        };
    }

    /** Where an invitation for this attendee is delivered, if anywhere. */
    public function deliveryEmail(): ?string
    {
        return $this->attendee_type === self::TYPE_USER
            ? $this->user?->email
            : $this->email;
    }

    /**
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->attendee_type,
            'userId' => $this->user_id,
            'groupId' => $this->group?->uuid,
            'email' => $this->attendee_type === self::TYPE_USER ? $this->user?->email : $this->email,
            'name' => $this->displayName(),
            'avatarUrl' => $this->user?->avatar_url,
            'response' => $this->response,
            'optional' => (bool) $this->is_optional,
            'respondedAt' => $this->responded_at?->toIso8601String(),
        ];
    }
}
