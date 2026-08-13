<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An officer assigned to a CIP application — the authority on assignment.
 * The `assigned_officer_id` column on cip_applications is only a cache of
 * the live row here, written by the engine when assignment changes.
 *
 * Assignments end rather than delete (the client-assignment shape), so the
 * file's history keeps every officer who ever held it and AccessSync can
 * settle live rows when an officer is suspended.
 */
#[Fillable([
    'application_id', 'user_id', 'role', 'status', 'assigned_by',
    'starts_at', 'ended_at', 'ended_by',
])]
class CipApplicationAssignment extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_ENDED = 'ended';

    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    /** Assignments that still count. */
    public function scopeLive(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_ACTIVE)->whereNull('ended_at');
    }

    public function end(?User $by = null): void
    {
        $this->forceFill([
            'status' => self::STATUS_ENDED,
            'ended_at' => now(),
            'ended_by' => $by?->id,
        ])->save();
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
