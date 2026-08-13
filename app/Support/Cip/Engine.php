<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The one path an application's status travels — a FROM→TO map plus a
 * per-transition permission, applied in a transaction that also writes the
 * append-only cip_events row. Nothing else writes cip_applications.status.
 *
 * The map is the whole lifecycle from day one; later build phases add the
 * *callers* (reviewer verbs, date-entry actions, the DELAYED daily job), not
 * new machinery. Notification fan-out attaches at the transition points once
 * the notification engine exists — the engine is the hook, deliberately.
 */
class Engine
{
    /** from => the statuses it may move to. */
    private const TRANSITIONS = [
        Status::DRAFT => [Status::NEW],
        Status::NEW => [Status::REVIEW_APPLICATION],
        Status::REVIEW_APPLICATION => [Status::ASSESSMENT_FEEDBACK],
        Status::ASSESSMENT_FEEDBACK => [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
        Status::UPDATE_REQUIRED => [Status::ASSESSMENT_FEEDBACK],
        Status::READY_TO_SUBMIT => [Status::PENDING_REVIEW],
        Status::PENDING_REVIEW => [Status::NON_COMPLIANT, Status::BACKGROUND_CHECK],
        Status::NON_COMPLIANT => [Status::PENDING_REVIEW, Status::BACKGROUND_CHECK],
        Status::BACKGROUND_CHECK => [Status::NON_COMPLIANT, Status::DELAYED, Status::GRANTED, Status::DENIED],
        Status::DELAYED => [Status::NON_COMPLIANT, Status::GRANTED, Status::DENIED],
    ];

    /**
     * Entering this status needs this capability (through CipAccess, so
     * officer grants count). Submission (→ NEW) is additionally open to the
     * application's creator — the provider side submits its own draft.
     */
    private const TRANSITION_CAPABILITIES = [
        Status::NEW => 'cip.create',
        Status::REVIEW_APPLICATION => 'cip.assign',
        Status::ASSESSMENT_FEEDBACK => 'cip.review',
        Status::UPDATE_REQUIRED => 'cip.review',
        Status::READY_TO_SUBMIT => 'cip.review',
        Status::PENDING_REVIEW => 'cip.compliance',
        Status::NON_COMPLIANT => 'cip.compliance',
        Status::BACKGROUND_CHECK => 'cip.compliance',
        Status::DELAYED => 'cip.compliance',
        Status::GRANTED => 'cip.decide',
        Status::DENIED => 'cip.decide',
    ];

    /** Is this edge in the lifecycle at all, whoever is asking? */
    public static function canTransition(CipApplication $application, string $to): bool
    {
        return Status::isValid($to)
            && in_array($to, self::TRANSITIONS[$application->status] ?? [], true);
    }

    /**
     * May this actor drive the application to this status? A null actor is
     * the system (a scheduled job) and may drive anything the map allows.
     */
    public static function allows(?User $actor, CipApplication $application, string $to): bool
    {
        if ($actor === null) {
            return true;
        }

        if (! CipAccess::enabled()) {
            return false;
        }

        // Submission is special: the provider side submits its own draft, and
        // external accounts hold no matrix capability — the creator check is
        // their whole grant.
        if ($to === Status::NEW) {
            return $application->created_by === $actor->id
                || CipAccess::can($actor, 'cip.create');
        }

        $capability = self::TRANSITION_CAPABILITIES[$to] ?? null;

        return $capability !== null && CipAccess::can($actor, $capability);
    }

    /**
     * Apply one transition: validate the edge and the actor, update the row,
     * write the event — atomically. Throws rather than silently refusing, so
     * a caller cannot mistake "nothing happened" for success.
     */
    public static function apply(CipApplication $application, string $to, ?User $actor, array $meta = []): CipApplication
    {
        if (! self::canTransition($application, $to)) {
            throw new \InvalidArgumentException(sprintf(
                'A CIP application cannot move from %s to %s.',
                Status::label($application->status),
                Status::label($to),
            ));
        }

        if (! self::allows($actor, $application, $to)) {
            throw new AuthorizationException('You cannot move this application to '.Status::label($to).'.');
        }

        return DB::transaction(function () use ($application, $to, $actor, $meta) {
            $from = $application->status;
            $application->forceFill(['status' => $to])->save();

            self::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, $to);

            // Mirror into the portal-wide trail too — that copy is pruned per
            // retention preference; cip_events above is the durable one.
            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.status_changed',
                'module' => 'cip',
                'description' => $application->displayNumber().' moved to '.Status::label($to),
                'subject' => $application,
                'old' => ['status' => $from],
                'new' => ['status' => $to],
            ]);

            return $application;
        });
    }

    /** Append one audit row. The only writer of cip_events. */
    public static function record(
        CipApplication $application,
        string $action,
        ?User $actor,
        array $meta = [],
        ?string $from = null,
        ?string $to = null,
    ): CipEvent {
        return CipEvent::create([
            'application_id' => $application->id,
            'actor_id' => $actor?->id,
            'action' => $action,
            'from_status' => $from,
            'to_status' => $to,
            'meta' => $meta === [] ? null : $meta,
            'ip_address' => request()?->ip(),
        ]);
    }
}
