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
 * append-only cip_events row. Nothing else writes cip_applications.status.
 *
 * The map is the whole lifecycle from day one. Notification fan-out attaches
 * at {@see write()}, every status change is one section 22 notice, in the filing
 * subject format, to the four named classes. Special-case mailers must not
 * send a second copy of the same move.
 */
class Engine
{
    /**
     * Statuses that belong to the pre-approval lifecycle and nowhere else.
     *
     * The counterpart of {@see Status::LANE}. Neither list mentions the
     * appeal statuses, which are reachable from both lanes, or Updates
     * Required, which both lanes use to mean the same thing: the provider
     * side has work to do.
     *
     * @var list<string>
     */
    private const PRE_APPROVAL_ONLY = [
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
        Status::GRANTED => [Status::POST_APPROVAL, Status::NEW_APPEAL],
        Status::POST_APPROVAL => [Status::UPDATE_REQUIRED, Status::APPLY_FOR_COR],
        Status::APPLY_FOR_COR => [Status::UPDATE_REQUIRED, Status::POST_APPROVAL, Status::PENDING_COR],
        Status::PENDING_COR => [Status::APPLY_FOR_NIC],
        Status::APPLY_FOR_NIC => [Status::PENDING_NIC, Status::UPDATE_REQUIRED],
        Status::PENDING_NIC => [Status::APPLY_FOR_PASSPORT],
        Status::APPLY_FOR_PASSPORT => [Status::PENDING_PASSPORT, Status::UPDATE_REQUIRED],
        Status::PENDING_PASSPORT => [Status::READY_FOR_DELIVERY],
        Status::DENIED => [Status::NEW_APPEAL],
        Status::READY_FOR_DELIVERY => [Status::CLOSED],

        /*
         * The appeal lane. It opens from either decision — a denial is the
         * obvious one, but an approval can be appealed too (a grant on the
         * wrong terms, a family member left off) — and from the post-approval
         * lane, because a file that has moved on is still a file whose
         * decision can be disputed.
         *
         * It ends where the first decision ended, GRANTED or DENIED, rather
         * than in a won/lost pair of its own. Appeal ready goes back to New
         * appeal so a file made ready too early can be walked back without an
         * administrator override.
         */
        Status::NEW_APPEAL => [Status::APPEAL_READY],
        Status::APPEAL_READY => [Status::APPEAL_SUBMITTED, Status::NEW_APPEAL],
        Status::APPEAL_SUBMITTED => [Status::GRANTED, Status::DENIED],
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
        // Lodging and preparing an appeal is compliance work, the same hands
        // that record a query. The outcome stays with cip.decide above.
        Status::NEW_APPEAL => 'cip.compliance',
        Status::APPEAL_READY => 'cip.compliance',
        Status::APPEAL_SUBMITTED => 'cip.compliance',
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

        /*
         * The one edge an external account may drive.
         *
         * Everything else in the lifecycle belongs to the firm, and that is
         * still true below. But an appeal is the provider side disagreeing
         * with a decision, and making them ask the firm for permission to
         * disagree put a queue in front of the one action that is entirely
         * theirs. Narrow on purpose: this status only, from a decided file,
         * and only for the party that filed it — every later step of the
         * appeal (Ready, Submitted, the outcome) is the firm's as before.
         */
        if ($to === Status::NEW_APPEAL && Appeal::mayLodge($actor, $application)) {
            return true;
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
     * Officers only DRIVE these mapped next steps. Administrators also
     * receive {@see availableOverrides()} for pulling a file backwards;
     * officers receive the same list, locked, from {@see lockedStatuses()}.
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
     * is an override, not ordinary workflow. Officers still SEE this list,
     * through {@see lockedStatuses()}, so the picker reads the same for
     * everyone; only an administrator may pick from it.
     *
     * @return list<string>
     */
    public static function availableOverrides(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        if (! CipAccess::canOverrideStatus($actor)) {
            return [];
        }

        return self::offMapStatuses($application, $actor, $forListing);
    }

    /**
     * The same off-map statuses, for staff who may not drive them.
     *
     * An officer used to see one or two next steps and nothing else, which
     * read as though the lifecycle stopped there: where the file could go
     * next was information only administrators had. So officers are shown
     * the whole list, with the off-map part shown as locked rather than
     * clickable. Seeing where a file can go is not the same as moving it,
     * and the override stays administrator-only, at the picker and at
     * {@see set()} both.
     *
     * Empty for an administrator, whose copy of this list is actionable and
     * arrives through {@see availableOverrides()}, and for anyone who may
     * not change status at all.
     *
     * @return list<string>
     */
    public static function lockedStatuses(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        if ($actor === null || CipAccess::canOverrideStatus($actor)) {
            return [];
        }

        if (! CipAccess::canChangeApplicationStatus($actor)) {
            return [];
        }

        return self::offMapStatuses($application, $actor, $forListing);
    }

    /**
     * Every listed status that is not where the file stands and not one of
     * this actor's mapped next steps — the override column's contents,
     * whether the reader may act on them or only read them.
     *
     * @return list<string>
     */
    private static function offMapStatuses(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
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

        if ($post && in_array($to, self::PRE_APPROVAL_ONLY, true)) {
            return false;
        }

        return true;
    }

    /**
     * The two lanes keep their own vocabularies.
     *
     * Pre-approval and post-approval are separate processes with separate
     * statuses, and a picker that mixes them asks a reader to tell one
     * lifecycle's labels from the other's at a glance. So a file working the
     * post-approval lane — collecting COR, NIC or passport paper — is not
     * offered New Applications, Review Applications, Assessment Feedback,
     * Pending Review, Non-compliant or Background Check, and a pre-approval
     * file is not offered the lane's own labels.
     *
     * The exception is a file still sitting AT the decision. Granted is where
     * a grant issued in error is undone, and that pull-back takes the file's
     * phase back to pre-approval with it (see {@see set()}), so the statuses
     * it lands on are the ones it will then be wearing. Once the file has
     * moved past Granted into the lane's own work, that door is closed: it
     * has a COR application in progress, and sending it back to Background
     * Check would put it in a queue for a decision it already holds.
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

        // The appeal lane belongs to neither: a decision can be disputed from
        // wherever the file has reached, so it stays on offer throughout.
        if (in_array($to, Status::APPEAL_LANE, true)) {
            return true;
        }

        if ($post && $application->status !== Status::GRANTED) {
            return ! in_array($to, self::PRE_APPROVAL_ONLY, true);
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

        /*
         * The lanes stay apart at the write too, not only in the picker.
         *
         * A hidden option that the endpoint still accepts is not a rule, it is
         * a rule the UI happens to be observing. The one door left open is the
         * same one {@see overrideFits} draws: a file still at Granted, where
         * undoing a grant issued in error carries the phase back with it.
         */
        if ($actor !== null && ! self::overrideFits($application, $to)) {
            throw new \InvalidArgumentException(sprintf(
                '%s belongs to the other lane; this application is in %s.',
                Status::label($to),
                Phase::label($application->phase ?? Phase::PRE_APPROVAL),
            ));
        }

        // Section 26: an administrator may type any listed status, but the audit
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
                    ? $application->displayNumber().' pulled from '.Status::label($from).' to '.Status::label($to)
                    : $application->displayNumber().' moved to '.Status::label($to),
                'subject' => $application,
                'old' => ['status' => $from],
                'new' => ['status' => $to],
            ]);

            return $application;
        });

        /*
         * Section 22: every status change is a notice, in the filing subject format,
         * to the four named classes. Sent after the row and the event have
         * both landed, so nothing is announced that did not occur.
         *
         * Returning to Post-Approval from Apply for COR or Updates Required
         * is the reviewer still working the same COR checklist, not a second
         * request for Stage 1 documents.
         */
        if ($enteringPost || $to !== Status::POST_APPROVAL) {
            Notices::announce($application, $to, $actor, is_string($meta['message'] ?? null) ? $meta['message'] : null);
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
