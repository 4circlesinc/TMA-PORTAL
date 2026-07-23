<?php

namespace App\Models;

use App\Support\Calendar\CalendarAudit;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line of the calendar audit trail.
 *
 * Names are denormalised alongside the ids on purpose: the row has to stay
 * readable after the calendar, event or user it refers to is deleted, which is
 * precisely when an audit matters most.
 */
#[Fillable([
    'action', 'actor_id', 'actor_name', 'calendar_id', 'calendar_name',
    'event_id', 'event_title', 'context', 'created_at',
])]
class CalendarAuditEvent extends Model
{
    /** Only ever written once, so an updated_at would be dead weight. */
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'context' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class);
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(CalendarEvent::class, 'event_id');
    }

    /**
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'label' => CalendarAudit::describe($this),
            'actor' => $this->actor_name ?: 'System',
            'calendar' => $this->calendar_name,
            'event' => $this->event_title,
            'context' => $this->context,
            'at' => $this->created_at?->toIso8601String(),
        ];
    }
}
