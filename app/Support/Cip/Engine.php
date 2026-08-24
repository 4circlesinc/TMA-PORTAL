<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The one path an application's status travels, a FROM→TO map plus a
 * per-transition permission, applied in a transaction that also writes the
 * append-only cip_events row. Nothing else writes cip_applications.status.
 *
 * The map is the whole lifecycle from day one. Notification fan-out attaches
 * at {@see write()}, every status change is one §22 notice, in the filing
 * subject format, to the four named classes. Special-case mailers must not
 * send a second copy of the same move.
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
        Status::READY_TO_SUBMIT => [Status::PENDING_REVIEW, Status::UPDATE_REQUIRED],
        Status::PENDING_REVIEW => [Status::NON_COMPLIANT, Status::BACKGROUND_CHECK],
        Status::NON_COMPLIANT => [Status::PENDING_REVIEW, Status::BACKGROUND_CHECK],
        Status::BACKGROUND_CHECK => [Status::NON_COMPLIANT, Status::DELAYED, Status::GRANTED, Status::DENIED],
        Status::DELAYED => [Status::NON_COMPLIANT, Status::GRANTED, Status::DENIED],
    ];

    /**
     * Entering this status needs this capability (through CipAccess, so
     * officer grants count). Submission (→ NEW) is additionally open to the
     * application's creator, the provider side submits a leftover draft.
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

        // Submission is special: a leftover draft is filed by the side that
        // wrote it, and external accounts hold no matrix capability, the
        // creator check is their whole grant. New files start at NEW, so this
        // edge is only for rows that have not yet been moved.
        if ($to === Status::NEW) {
            return $application->created_by === $actor->id
                || CipAccess::can($actor, 'cip.create');
        }

        $capability = self::TRANSITION_CAPABILITIES[$to] ?? null;

        return $capability !== null && CipAccess::can($actor, $capability);
    }

    /**
     * The edges out of here that this actor may drive, what a screen needs to
     * know before it draws a button.
     *
     * A filter over the two questions above rather than a second reading of
     * the map, so the buttons and the refusal can never disagree: offering a
     * move the engine would then reject is worse than offering none. The
     * order is the lifecycle's own, which is the order a reader expects to
     * see the choices in.
     *
     * @return list<string>
     */
    public static function availableTransitions(CipApplication $application, ?User $actor): array
    {
        return array_values(array_filter(
            Status::ALL,
            fn (string $to) => self::canTransition($application, $to) && self::allows($actor, $application, $to),
        ));
    }

    /**
     * Apply one transition: validate the edge and the actor, update the row,
     * write the event, atomically. Throws rather than silently refusing, so
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

        return self::write($application, $to, $actor, $meta);
    }

    /**
     * Put the application on this status, whether or not the lifecycle has
     * an edge there from here.
     *
     * The status picker lists every status, not only the next one, and a
     * choice it offers has to land. Permission is still {@see allows()} —
     * a reviewing officer cannot write a compliance status just because
     * the menu named it. DRAFT is not a destination: nothing files into it.
     */
    public static function set(CipApplication $application, string $to, ?User $actor, array $meta = []): CipApplication
    {
        if (! Status::isValid($to) || $to === Status::DRAFT) {
            throw new \InvalidArgumentException(sprintf(
                '%s is not a status this application can be set to.',
                Status::label($to),
            ));
        }

        if ($application->status === $to) {
            return $application;
        }

        if (! self::allows($actor, $application, $to)) {
            throw new AuthorizationException('You cannot move this application to '.Status::label($to).'.');
        }

        return self::write($application, $to, $actor, $meta);
    }

    /** The row and the audit, once the move has already been allowed. */
    private static function write(CipApplication $application, string $to, ?User $actor, array $meta): CipApplication
    {
        $from = $application->status;
        $application = DB::transaction(function () use ($application, $to, $actor, $meta, $from) {
            $application->forceFill(['status' => $to])->save();

            self::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, $to);

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

        /*
         * §22: every status change is a notice, in the filing subject format,
         * to the four named classes. Sent after the row and the event have
         * both landed, so nothing is announced that did not occur.
         */
        Notices::announce($application, $to, $actor);

        return $application;
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
