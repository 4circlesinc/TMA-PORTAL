<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Companies\ContactIdentity;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The one path an application's status travels, a FROM→TO map plus a
 * per-transition permission, applied in a transaction that also writes the
 * append-only cip_events row. Live moves write cip_applications.status
 * only here. {@see Cutover} is the one other writer: it restores a
 * historical status the lifecycle cannot walk, without notices.
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
        Status::UPDATE_REQUIRED => [Status::ASSESSMENT_FEEDBACK, Status::POST_APPROVAL, Status::APPLY_FOR_COR, Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT],
        Status::READY_TO_SUBMIT => [Status::PENDING_REVIEW, Status::UPDATE_REQUIRED],
        Status::PENDING_REVIEW => [Status::NON_COMPLIANT, Status::BACKGROUND_CHECK],
        Status::NON_COMPLIANT => [Status::PENDING_REVIEW, Status::BACKGROUND_CHECK],
        Status::BACKGROUND_CHECK => [Status::NON_COMPLIANT, Status::DELAYED, Status::GRANTED, Status::DENIED],
        Status::DELAYED => [Status::NON_COMPLIANT, Status::GRANTED, Status::DENIED],
        Status::GRANTED => [Status::POST_APPROVAL],
        Status::POST_APPROVAL => [Status::UPDATE_REQUIRED, Status::APPLY_FOR_COR],
        Status::APPLY_FOR_COR => [Status::UPDATE_REQUIRED, Status::POST_APPROVAL, Status::PENDING_COR],
        Status::PENDING_COR => [Status::APPLY_FOR_NIC],
        Status::APPLY_FOR_NIC => [Status::PENDING_NIC, Status::UPDATE_REQUIRED],
        Status::PENDING_NIC => [Status::APPLY_FOR_PASSPORT],
        Status::APPLY_FOR_PASSPORT => [Status::PENDING_PASSPORT, Status::UPDATE_REQUIRED],
        Status::PENDING_PASSPORT => [Status::READY_FOR_DELIVERY],
        Status::READY_FOR_DELIVERY => [Status::CLOSED],
    ];

    /**
     * Entering this status needs this capability (through CipAccess, so
     * officer grants count). Only administrators and CRO / Reviewing officers
     * may drive any edge; see {@see CipAccess::canChangeApplicationStatus()}.
     */
    private const TRANSITION_CAPABILITIES = [
        Status::NEW => 'cip.create',
        Status::REVIEW_APPLICATION => 'cip.assign',
        Status::ASSESSMENT_FEEDBACK => 'cip.review',
        Status::UPDATE_REQUIRED => 'cip.review',
        Status::READY_TO_SUBMIT => 'cip.review',
        Status::APPLY_FOR_COR => 'cip.review',
        Status::PENDING_COR => 'cip.compliance',
        Status::APPLY_FOR_NIC => 'cip.compliance',
        Status::PENDING_NIC => 'cip.compliance',
        Status::APPLY_FOR_PASSPORT => 'cip.compliance',
        Status::PENDING_PASSPORT => 'cip.compliance',
        Status::READY_FOR_DELIVERY => 'cip.compliance',
        Status::CLOSED => 'cip.compliance',
        Status::PENDING_REVIEW => 'cip.compliance',
        Status::NON_COMPLIANT => 'cip.compliance',
        Status::BACKGROUND_CHECK => 'cip.compliance',
        Status::DELAYED => 'cip.compliance',
        Status::GRANTED => 'cip.decide',
        Status::POST_APPROVAL => 'cip.review',
        Status::DENIED => 'cip.decide',
    ];

    /** Is this edge in the lifecycle at all, whoever is asking? */
    public static function canTransition(CipApplication $application, string $to): bool
    {
        return Status::isValid($to)
            && in_array($to, self::TRANSITIONS[$application->status] ?? [], true)
            && self::phaseAllows($application, $to);
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

        if (! CipAccess::canChangeApplicationStatus($actor)) {
            return false;
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
     * Officers only see these mapped next steps. Administrators also receive
     * {@see availableOverrides()} for pulling a file backwards.
     *
     * @return list<string>
     */
    public static function availableTransitions(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        return array_values(array_filter(
            Status::ALL,
            fn (string $to) => self::canTransition($application, $to)
                && self::allows($actor, $application, $to)
                && self::checklistAllows($application, $to, $forListing)
                && ! Stages::owns($to)
                && ! Delay::owns($to),
        ));
    }

    /**
     * Statuses an administrator may set that are not the next mapped step.
     *
     * Empty for everyone else: pulling Approved back to Assessment Feedback
     * is an override, not ordinary workflow.
     *
     * @return list<string>
     */
    public static function availableOverrides(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        if (! CipAccess::canOverrideStatus($actor)) {
            return [];
        }

        $next = self::availableTransitions($application, $actor, $forListing);

        return array_values(array_filter(
            Status::listed(),
            fn (string $to) => $to !== $application->status
                && ! in_array($to, $next, true)
                && self::checklistAllows($application, $to, $forListing)
                && self::overrideFits($application, $to)
                && ! Stages::owns($to)
                && ! Delay::owns($to),
        ));
    }

    /**
     * Ready to Submit is a claim about the documents, not a label somebody
     * may type while files are still in Application review or Update required.
     *
     * Listings that have not loaded checklists skip the document count — the
     * write still enforces it. Asking here would be one COUNT per row of the
     * applications table.
     *
     * An empty `people` relation still counts as "loaded" to Eloquent, and
     * Collection::every() is true of an empty set, so a worklist row with no
     * family yet must not be treated as a checklist we can judge in memory.
     */
    private static function checklistAllows(CipApplication $application, string $to, bool $forListing = false): bool
    {
        if (! in_array($to, [Status::READY_TO_SUBMIT, Status::APPLY_FOR_COR], true)) {
            return true;
        }

        if ($forListing) {
            $checklistsLoaded = $application->relationLoaded('people')
                && $application->people->isNotEmpty()
                && $application->people->every(fn ($person) => $person->relationLoaded('documents'));

            if (! $checklistsLoaded) {
                return true;
            }
        }

        return Review::documentsAllowReadyToSubmit($application);
    }

    /**
     * Apply for COR is a post-approval working label. Post-Approval is the
     * next lane after a grant, or a return from Apply for COR / Updates
     * Required once the file is already in that lane — never a hop off
     * pre-approval Updates Required.
     */
    private static function phaseAllows(CipApplication $application, string $to): bool
    {
        $post = ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL;

        if ($to === Status::POST_APPROVAL) {
            return $application->status === Status::GRANTED || $post;
        }

        if ($to === Status::APPLY_FOR_COR && $post && Pack::hasReachedNic($application)) {
            return false;
        }

        if ($to === Status::POST_APPROVAL && $post && Pack::hasReachedNic($application)
            && $application->status === Status::UPDATE_REQUIRED) {
            return false;
        }

        if ($to === Status::APPLY_FOR_NIC && $application->status === Status::UPDATE_REQUIRED) {
            return $post && Pack::hasReachedNic($application) && ! Pack::hasReachedPassport($application);
        }

        if ($to === Status::APPLY_FOR_PASSPORT && $application->status === Status::UPDATE_REQUIRED) {
            return $post && Pack::hasReachedPassport($application);
        }

        if ($to === Status::APPLY_FOR_NIC && $post && Pack::hasReachedPassport($application)) {
            return false;
        }

        if (Status::inLane($to)) {
            return $post;
        }

        $preApprovalLane = [
            Status::NEW,
            Status::REVIEW_APPLICATION,
            Status::ASSESSMENT_FEEDBACK,
            Status::READY_TO_SUBMIT,
            Status::PENDING_REVIEW,
            Status::NON_COMPLIANT,
            Status::BACKGROUND_CHECK,
            Status::DELAYED,
            Status::GRANTED,
            Status::DENIED,
        ];

        if ($post && in_array($to, $preApprovalLane, true)) {
            return false;
        }

        return true;
    }

    /**
     * Administrators may still pull a post-approval file back into the
     * pre-decision lifecycle. Apply for COR and Ready to Submit are working
     * labels for one lane each, so the override picker does not offer the
     * other lane's destination.
     */
    private static function overrideFits(CipApplication $application, string $to): bool
    {
        $post = ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL;

        if ($to === Status::READY_TO_SUBMIT) {
            return ! $post;
        }

        if ($to === Status::POST_APPROVAL) {
            return true;
        }

        if (Status::inLane($to)) {
            return $post;
        }

        return true;
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

        if (! self::checklistAllows($application, $to)) {
            throw new \InvalidArgumentException(self::checklistRefusal($to));
        }

        return self::write($application, $to, $actor, $meta);
    }

    /**
     * Put the application on this status, whether or not the lifecycle has
     * an edge there from here.
     *
     * Administrators only. Officers drive {@see apply()} along the mapped
     * next steps; jumping from Approved back to Assessment Feedback is an
     * override and is logged as one. DRAFT is not a destination.
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

        if ($actor !== null && ! CipAccess::canOverrideStatus($actor)) {
            throw new AuthorizationException(
                'Only an administrator can pull an application back to an earlier status.'
            );
        }

        if ($actor !== null && ! self::allows($actor, $application, $to)) {
            throw new AuthorizationException('You cannot move this application to '.Status::label($to).'.');
        }

        if (! self::checklistAllows($application, $to)) {
            throw new \InvalidArgumentException(self::checklistRefusal($to));
        }

        // §26: an administrator may type any listed status, but the audit
        // row has to say why. System writes (a null actor) skip this — the
        // checklist inferring Ready to submit is not a person changing a
        // label by hand.
        if ($actor !== null && trim((string) ($meta['note'] ?? '')) === '') {
            throw new \InvalidArgumentException('Give a reason for changing the status.');
        }

        $from = $application->status;
        $extra = [];
        $meta = array_merge($meta, ['override' => true]);

        if (Status::isDecided($from) && ! Status::isDecided($to) && ! self::staysInPostApproval($application, $to)) {
            $meta['clearedDecision'] = $application->decision;
            $meta['clearedDecidedAt'] = $application->decided_at?->toDateString();
            $extra['decision'] = null;
            $extra['decided_at'] = null;

            if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
                $meta['revertedPhase'] = Phase::POST_APPROVAL;
                $extra['phase'] = Phase::PRE_APPROVAL;
            }
        }

        $application = self::write($application, $to, $actor, $meta, $extra);

        if (($meta['revertedPhase'] ?? null) === Phase::POST_APPROVAL) {
            Requirements::materialiseApplication($application->fresh());
        }

        return $application;
    }

    /** The row and the audit, once the move has already been allowed. */
    private static function write(CipApplication $application, string $to, ?User $actor, array $meta, array $extra = []): CipApplication
    {
        $enteringPost = $to === Status::POST_APPROVAL
            && ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL;

        if ($enteringPost) {
            $extra = array_merge([
                'phase' => Phase::POST_APPROVAL,
                'post_approval_at' => $application->post_approval_at ?? now(),
            ], $extra);
        }

        $from = $application->status;
        $application = DB::transaction(function () use ($application, $to, $actor, $meta, $from, $extra, $enteringPost) {
            $application->forceFill(array_merge(['status' => $to], $extra))->save();

            self::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, $to);

            if ($enteringPost) {
                self::record($application, CipEvent::ACTION_POST_APPROVAL_ENTERED, $actor, []);
                PostApproval::prepare($application, $actor);
            }

            if (in_array($to, [Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT], true)) {
                Requirements::materialiseApplication($application);
            }

            if ($to === Status::CLOSED) {
                Package::forget();
            }

            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.status_changed',
                'module' => 'cip',
                'description' => ! empty($meta['override'])
                    ? $application->displayNumber().' status overridden to '.Status::label($to)
                    : $application->displayNumber().' moved to '.Status::label($to),
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
         *
         * Returning to Post-Approval from Apply for COR or Updates Required
         * is the reviewer still working the same COR checklist, not a second
         * request for Stage 1 documents.
         */
        if ($enteringPost || $to !== Status::POST_APPROVAL) {
            Notices::announce($application, $to, $actor);
        }

        return $application;
    }

    private static function checklistRefusal(string $to): string
    {
        $label = $to === Status::APPLY_FOR_COR ? 'Apply for COR' : 'Ready to Submit';

        return 'This application cannot be '.$label.' while documents are still in Application review or Update required.';
    }

    /**
     * Updates Required in post-approval is still a granted file. Clearing the
     * decision would drop the grant the COR checklist is being collected for.
     */
    private static function staysInPostApproval(CipApplication $application, string $to): bool
    {
        return ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            && ($to === Status::UPDATE_REQUIRED || Status::inLane($to));
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
        $stamp = ContactIdentity::stamp($actor, ContactIdentity::companyIdForApplication($application));

        return CipEvent::create([
            'application_id' => $application->id,
            'actor_id' => $actor?->id,
            'company_member_id' => $stamp['company_member_id'],
            'actor_name' => $stamp['actor_name'],
            'action' => $action,
            'from_status' => $from,
            'to_status' => $to,
            'meta' => $meta === [] ? null : $meta,
            'ip_address' => request()?->ip(),
        ]);
    }
}
