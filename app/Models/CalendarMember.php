<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An explicit permission grant on a calendar. Always wins over the calendar's
 * broad `visibility` default. See App\Support\Calendar\CalendarAccess for the
 * role ladder.
 */
#[Fillable(['calendar_id', 'member_type', 'user_id', 'group_id', 'role', 'added_by'])]
class CalendarMember extends Model
{
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Set instead of `user` when this grant is to a whole group. */
    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function adder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by');
    }
}
