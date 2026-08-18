<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per thing that happened to an application — append-only, written
 * in the same transaction as the change it records. This is the durable
 * compliance audit: unlike activity_logs it is never pruned, never updated,
 * never deleted. actor_id null means the system acted (a scheduled job).
 */
#[Fillable([
    'application_id', 'actor_id', 'action', 'from_status', 'to_status',
    'detail', 'meta', 'ip_address',
])]
class CipEvent extends Model
{
    public const UPDATED_AT = null;

    public const ACTION_CREATED = 'created';

    public const ACTION_STATUS_CHANGED = 'status_changed';

    public const ACTION_ASSIGNED = 'assigned';

    public const ACTION_UNASSIGNED = 'unassigned';

    /**
     * The government's number arrived, or was corrected.
     *
     * Its own action rather than a detail of the status change: §7 keeps two
     * numbers for the life of the application, and which one a surface showed
     * on a given day is an audit question. The internal number rides in the
     * event's meta so an invoice can still be reconciled against a row that
     * now displays something else.
     */
    public const ACTION_NUMBER_ASSIGNED = 'number_assigned';

    /**
     * The Unit decided — Approved or Denied.
     *
     * Its own action rather than a detail of the status change: the outcome
     * and the date live on the application, and which day a report measures
     * from is an audit question the status event alone does not answer.
     */
    public const ACTION_DECISION_RECORDED = 'decision_recorded';

    /**
     * The service provider confirmed the original package (§15).
     *
     * Its own action rather than a detail of Ready to submit: the status
     * arrives when every document is accepted, and the lock arrives when the
     * firm presses Confirm submission. Those are different moments, and which
     * day the package froze is an audit question the status event alone does
     * not answer.
     */
    public const ACTION_PACKAGE_CONFIRMED = 'package_confirmed';

    protected function casts(): array
    {
        return [
            'meta' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(CipApplication::class, 'application_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
