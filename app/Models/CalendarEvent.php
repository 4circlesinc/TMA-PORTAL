<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One event on one calendar.
 *
 * Times are absolute instants; `timezone` records the zone the event was
 * authored in, which recurrence and ICS export both need. All-day events run
 * midnight-to-midnight *in that zone*, so they must never be formatted in UTC.
 */
#[Fillable([
    'uuid', 'calendar_id', 'title', 'description', 'location',
    'starts_at', 'ends_at', 'all_day', 'timezone', 'status', 'visibility',
    'colour', 'organizer_id', 'client_id', 'meeting_url',
    'recurrence_rule', 'recurrence_exdates', 'series_id', 'recurrence_starts_at',
    'external_provider', 'external_calendar_id', 'external_event_id',
    'external_recurrence_id', 'external_etag', 'external_synced_at',
    'external_synced_local_at', 'external_local_fingerprint',
    'conflict_snapshot', 'conflict_at',
    'completed_at', 'created_by', 'updated_by',
])]
class CalendarEvent extends Model
{
    use SoftDeletes;

    public const STATUS_CONFIRMED = 'confirmed';

    public const STATUS_TENTATIVE = 'tentative';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = [self::STATUS_CONFIRMED, self::STATUS_TENTATIVE, self::STATUS_CANCELLED];

    public const VISIBILITIES = ['default', 'public', 'private'];

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'recurrence_starts_at' => 'datetime',
            'external_synced_at' => 'datetime',
            'external_synced_local_at' => 'datetime',
            'conflict_at' => 'datetime',
            'conflict_snapshot' => 'array',
            'completed_at' => 'datetime',
            'all_day' => 'boolean',
            'recurrence_exdates' => 'array',
            'deleted_at' => 'datetime',
        ];
    }

    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class);
    }

    public function organizer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'organizer_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    /** The recurrence master, when this row is a detached occurrence. */
    public function series(): BelongsTo
    {
        return $this->belongsTo(CalendarEvent::class, 'series_id');
    }

    public function occurrences(): HasMany
    {
        return $this->hasMany(CalendarEvent::class, 'series_id');
    }

    public function attendees(): HasMany
    {
        return $this->hasMany(CalendarEventAttendee::class, 'event_id');
    }

    public function isRecurring(): bool
    {
        return $this->recurrence_rule !== null || $this->series_id !== null;
    }

    /**
     * The shape the calendar views consume.
     *
     * `$role` is the viewer's permission on the owning calendar. At
     * availability level — and for a private event seen by anyone but its
     * organizer — the response carries the time block and nothing more, so
     * details never reach a caller who may only see busy/free.
     *
     * @return array<string, mixed>
     */
    public function toRecord(string $role, ?int $viewerId = null, ?string $calendarColour = null): array
    {
        $base = [
            'id' => $this->uuid,
            'calendarId' => $this->calendar?->uuid,
            'startsAt' => $this->starts_at?->toIso8601String(),
            'endsAt' => $this->ends_at?->toIso8601String(),
            'allDay' => (bool) $this->all_day,
            'timezone' => $this->timezone,
            'status' => $this->status,
            'colour' => $this->colour ?: $calendarColour,
        ];

        if (! $this->isReadableBy($role, $viewerId)) {
            // Availability-only: a busy block with no identifying detail.
            return $base + ['title' => 'Busy', 'private' => true, 'canEdit' => false];
        }

        return $base + [
            'title' => $this->title,
            'description' => $this->description,
            'location' => $this->location,
            'visibility' => $this->visibility,
            'meetingUrl' => $this->meeting_url,
            'organizerId' => $this->organizer_id,
            'organizerName' => $this->organizer?->name,
            'clientId' => $this->client?->uid,
            'completed' => $this->completed_at !== null,
            'recurring' => $this->isRecurring(),
            'recurrenceRule' => $this->recurrence_rule,
            'seriesId' => $this->series?->uuid,
            // Only present when the caller eager-loaded them, so a week's
            // worth of events doesn't fan out into a query per event.
            'attendees' => $this->relationLoaded('attendees')
                ? $this->attendees->map->toRecord()->values()
                : null,
            'external' => $this->external_provider,
            'private' => false,
            'canEdit' => in_array($role, ['editor', 'manager', 'owner'], true)
                || ($role === 'contributor' && $this->created_by === $viewerId),
        ];
    }

    /** Whether a viewer at `$role` may see more than this event's time block. */
    private function isReadableBy(string $role, ?int $viewerId): bool
    {
        if ($role === 'availability') {
            return false;
        }

        // A private event is a busy block to everyone except the people who
        // own it, however much permission they hold on the calendar itself.
        if ($this->visibility === 'private') {
            return $viewerId !== null
                && ($this->organizer_id === $viewerId || $this->created_by === $viewerId);
        }

        return true;
    }
}
