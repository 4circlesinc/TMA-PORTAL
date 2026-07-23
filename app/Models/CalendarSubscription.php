<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One user's personal view of one calendar: whether it appears in their
 * sidebar, whether its events are drawn, and the colour they see it in.
 *
 * Distinct from CalendarMember on purpose — this is preference, not
 * permission. Unsubscribing removes a calendar from your list without
 * touching the calendar or your access to it.
 */
#[Fillable(['user_id', 'calendar_id', 'is_visible', 'colour_override', 'sort_order'])]
class CalendarSubscription extends Model
{
    protected function casts(): array
    {
        return [
            'is_visible' => 'boolean',
        ];
    }

    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
