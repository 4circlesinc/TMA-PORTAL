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
    'application_id', 'actor_id', 'company_member_id', 'actor_name',
    'action', 'from_status', 'to_status', 'detail', 'meta', 'ip_address',
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

    /**
     * The Unit asked for more information (§18).
     *
     * Its own action rather than a detail of the status change: the query
     * date lives on the application, and which day a report measures from is
     * an audit question the status event alone does not answer.
     */
    public const ACTION_QUERY_RECEIVED = 'query_received';

    /**
     * The Unit accepted the file for processing (§19).
     *
     * Its own action rather than a detail of the status change: the accepted
     * date lives on the application, and the delay clock (§20) measures from
     * it — an audit question the status event alone does not answer.
     */
    public const ACTION_ACCEPTED_FOR_PROCESSING = 'accepted_for_processing';

    /**
     * Staff moved an approved file into the post-approval lane (brief §1).
     *
     * Its own action rather than a detail of the status change: entering
     * post-approval provisions the COR checklist and sends the COR notice,
     * and which day that happened is an audit question the status event
     * alone does not answer.
     */
    public const ACTION_POST_APPROVAL_ENTERED = 'post_approval_entered';

    /**
     * A milestone date was corrected — the day only, not the step.
     *
     * Its own action rather than a status change, because no status changed:
     * the file has already been where the date says it was, and what moved is
     * the record of when. Read on its own it answers the question an auditor
     * actually asks of a date that disagrees with a government letter — who
     * changed it, when, and what it said before, which rides in the meta.
     */
    public const ACTION_MILESTONE_CORRECTED = 'milestone_corrected';

    /**
     * The delay clock ran out (§20).
     *
     * Its own action rather than a detail of the status change: the accepted
     * date lives on the application, and how many days passed before the
     * file was flagged is an audit question the status event alone does
     * not answer. actor_id is null — a scheduled job, not a person.
     */
    public const ACTION_DELAYED = 'delayed';

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
        // Recycle Bin accounts still belong to the person who acted; without
        // this their name falls off the Activity tab the moment they are parked.
        return $this->belongsTo(User::class, 'actor_id')->withTrashed();
    }

    public function companyMember(): BelongsTo
    {
        return $this->belongsTo(CompanyMember::class, 'company_member_id');
    }
}
