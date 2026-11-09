<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Companies\ContactIdentity;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

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
        Status::DD_QUERY,
        Status::DELAYED,
        Status::GRANTED,
        Status::DENIED,
    ];

    /**
     * Where each status stands along the lifecycle, for telling a step ahead
     * from a step back.
     *
     * The transition map answers "is this the next step"; it cannot answer
     * "is this further on", and that is the question an administrator's
     * move needs. Skipping Review Applications to land on Assessment
     * Feedback is the file moving forward through its own work — asking for
     * a typed OVERRIDE and a reason there read as though something
     * irregular were happening. Pulling an Approved file back to Assessment
     * Feedback is the irregular act, and stays an override.
     *
     * Updates Required is not listed: it is a hold, not a place in the
     * lane, and {@see rank()} places it where the file was held.
     *
     * @var array<string, int>
     */
    private const ORDER = [
        Status::NEW => 10,
        Status::REVIEW_APPLICATION => 20,
        Status::ASSESSMENT_FEEDBACK => 30,
        Status::READY_TO_SUBMIT => 40,
        Status::PENDING_REVIEW => 50,
        Status::NON_COMPLIANT => 60,
        Status::BACKGROUND_CHECK => 70,
        Status::DD_QUERY => 80,
        Status::DELAYED => 80,
        Status::GRANTED => 90,
        Status::DENIED => 90,
        Status::POST_APPROVAL => 100,
        Status::POST_APPROVED => 110,
        Status::POST_DENIED => 110,
        Status::APPLY_FOR_COR => 120,
        Status::PENDING_COR => 130,
        Status::COR_RECEIVED => 140,
        Status::APPLY_FOR_NIC => 150,
        Status::PENDING_NIC => 160,
        Status::NIC_RECEIVED => 170,
        Status::APPLY_FOR_PASSPORT => 180,
        Status::PENDING_PASSPORT => 190,
        Status::PASSPORT_RECEIVED => 200,
        Status::PASSPORT_DELIVERED => 210,
        Status::READY_FOR_DELIVERY => 200,
        Status::CLOSED => 220,
        Status::NEW_APPEAL => 300,
        Status::APPEAL_READY => 310,
        Status::APPEAL_SUBMITTED => 320,
    ];

    /** from => the statuses it may move to. */
    private const TRANSITIONS = [
        Status::DRAFT => [Status::NEW],
        Status::NEW => [Status::REVIEW_APPLICATION],
        Status::REVIEW_APPLICATION => [Status::ASSESSMENT_FEEDBACK, Status::READY_TO_SUBMIT],
        Status::ASSESSMENT_FEEDBACK => [Status::UPDATE_REQUIRED, Status::READY_TO_SUBMIT],
        Status::UPDATE_REQUIRED => [Status::ASSESSMENT_FEEDBACK, Status::POST_APPROVAL, Status::APPLY_FOR_COR, Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT],
        Status::READY_TO_SUBMIT => [Status::PENDING_REVIEW, Status::UPDATE_REQUIRED],
        Status::PENDING_REVIEW => [Status::NON_COMPLIANT, Status::BACKGROUND_CHECK],
        Status::NON_COMPLIANT => [Status::PENDING_REVIEW, Status::BACKGROUND_CHECK],
        Status::BACKGROUND_CHECK => [Status::DD_QUERY, Status::DELAYED, Status::GRANTED, Status::DENIED],
        Status::DD_QUERY => [Status::BACKGROUND_CHECK, Status::GRANTED, Status::DENIED],
        Status::DELAYED => [Status::DD_QUERY, Status::GRANTED, Status::DENIED],
        Status::GRANTED => [Status::POST_APPROVAL, Status::NEW_APPEAL],
        /*
         * The lane's decision comes FIRST, not last.
         *
         * Approved or Denied is what decides whether this file works the
         * post-approval process at all: approved, it goes on to collect COR,
         * NIC and passport paper; denied, it stops. Putting the decision at
         * the end had it arrive after all that work was already done, which
         * is the wrong way round — and refused the reader at the only point
         * they actually wanted it.
         */
        Status::POST_APPROVAL => [Status::UPDATE_REQUIRED, Status::POST_APPROVED, Status::POST_DENIED],
        Status::POST_APPROVED => [Status::UPDATE_REQUIRED, Status::APPLY_FOR_COR],
        Status::POST_DENIED => [Status::CLOSED, Status::NEW_APPEAL],
        Status::APPLY_FOR_COR => [Status::UPDATE_REQUIRED, Status::POST_APPROVED, Status::PENDING_COR],
        Status::PENDING_COR => [Status::COR_RECEIVED],
        Status::COR_RECEIVED => [Status::APPLY_FOR_NIC],
        Status::APPLY_FOR_NIC => [Status::PENDING_NIC, Status::UPDATE_REQUIRED],
        Status::PENDING_NIC => [Status::NIC_RECEIVED],
        Status::NIC_RECEIVED => [Status::APPLY_FOR_PASSPORT],
        Status::APPLY_FOR_PASSPORT => [Status::PENDING_PASSPORT, Status::UPDATE_REQUIRED],
        Status::PENDING_PASSPORT => [Status::PASSPORT_RECEIVED],
        Status::PASSPORT_RECEIVED => [Status::PASSPORT_DELIVERED],
        Status::DENIED => [Status::NEW_APPEAL],

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
        // Starting the review is a status change, which officers hold.
        // Handing the file to an officer stays cip.assign, administrators only.
        Status::REVIEW_APPLICATION => 'cip.review',
        Status::ASSESSMENT_FEEDBACK => 'cip.review',
        Status::UPDATE_REQUIRED => 'cip.review',
        Status::READY_TO_SUBMIT => 'cip.review',
        Status::APPLY_FOR_COR => 'cip.review',
        Status::PENDING_COR => 'cip.compliance',
        Status::COR_RECEIVED => 'cip.compliance',
        Status::APPLY_FOR_NIC => 'cip.compliance',
        Status::PENDING_NIC => 'cip.compliance',
        Status::NIC_RECEIVED => 'cip.compliance',
        Status::APPLY_FOR_PASSPORT => 'cip.compliance',
        Status::PENDING_PASSPORT => 'cip.compliance',
        Status::PASSPORT_RECEIVED => 'cip.compliance',
        Status::PASSPORT_DELIVERED => 'cip.compliance',
        Status::CLOSED => 'cip.compliance',
        Status::PENDING_REVIEW => 'cip.compliance',
        Status::NON_COMPLIANT => 'cip.compliance',
        Status::BACKGROUND_CHECK => 'cip.compliance',
        Status::DD_QUERY => 'cip.compliance',
        Status::DELAYED => 'cip.compliance',
        Status::GRANTED => 'cip.decide',
        Status::POST_APPROVED => 'cip.decide',
        Status::POST_DENIED => 'cip.decide',
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
            && in_array($to, self::transitionsFrom($application), true)
            && self::phaseAllows($application, $to);
    }

    /**
     * Edges out of the file's current status for its phase.
     *
     * Add-On reuses the pre-approval path through Pending Review, then skips
     * Background Check / DD Query / Delayed: from Pending Review or
     * Non-compliant the Unit either asks for more paper or decides. Approved
     * Add-Ons do not enter the post-approval COR lane.
     *
     * @return list<string>
     */
    private static function transitionsFrom(CipApplication $application): array
    {
        $from = $application->status;
        $base = self::TRANSITIONS[$from] ?? [];

        /*
         * Decided before the lane: the Unit's grant is the decision.
         *
         * A file granted in pre-approval and moved on to post-approval was
         * asked to be Approved or Denied a second time before it could
         * collect its COR papers. The grant already answered that, so its
         * next step from Post-Approval is Apply for COR, once the papers are
         * in. The lane's outcomes stay in the map — a decision recorded late
         * through the decision verb still lands — but no menu offers them on
         * a file the grant already decided; see {@see grantedBeforeLane()}.
         */
        if ($from === Status::POST_APPROVAL && self::grantedBeforeLane($application)) {
            return [Status::UPDATE_REQUIRED, Status::POST_APPROVED, Status::POST_DENIED, Status::APPLY_FOR_COR];
        }

        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::ADD_ON) {
            return $base;
        }

        return match ($from) {
            Status::PENDING_REVIEW => [Status::NON_COMPLIANT, Status::GRANTED, Status::DENIED],
            Status::NON_COMPLIANT => [Status::PENDING_REVIEW, Status::GRANTED, Status::DENIED],
            Status::GRANTED => [Status::NEW_APPEAL],
            default => $base,
        };
    }

    /**
     * Is this post-approval file carrying the Unit's pre-approval grant as
     * its decision?
     *
     * Then the lane asks for no decision of its own: Approved and Denied are
     * not offered, and Apply for COR follows Post-Approval directly. A file
     * that entered post-approval with no decision (filed by a provider
     * without one) still records the lane's Approved or Denied first.
     */
    public static function grantedBeforeLane(CipApplication $application): bool
    {
        return ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            && $application->decision === Status::GRANTED;
    }

    /** A lane outcome a file decided before the lane is not asked for again. */
    private static function outcomeAlreadyDecided(CipApplication $application, string $to): bool
    {
        return in_array($to, [Status::POST_APPROVED, Status::POST_DENIED], true)
            && $application->status !== $to
            && self::grantedBeforeLane($application);
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
     * These are the mapped next steps. Administrators also receive
     * {@see availableOverrides()} for a jump off the map. Everyone else who
     * may change status — CRO / Reviewing officers included — sees that list
     * locked, from {@see lockedStatuses()}.
     *
     * @return list<string>
     */
    public static function availableTransitions(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        return array_values(array_filter(
            Status::ALL,
            fn (string $to) => self::canTransition($application, $to)
                && ! self::outcomeAlreadyDecided($application, $to)
                && self::allows($actor, $application, $to)
                && self::checklistAllows($application, $to, $forListing)
                && (! Stages::owns($to) || self::returnIsOpen($application, $to))
                && ! (self::returnsFromUpdates($application, $to) && Review::hasSentBack($application))
                && ! Delay::owns($to),
        ));
    }

    /**
     * Is this the way back from Updates Required to the step it interrupted?
     *
     * Apply for NIC and Apply for Passport are each reached by a date, the
     * COR or the NIC arriving, so they are a date verb's and not the
     * picker's. Coming BACK to one from Updates Required is not that: the
     * date was recorded long ago and nothing arrives twice. The checklist
     * makes this return by itself once nothing is sent back; a file put on
     * Updates Required by hand, with nothing sent back, has no document
     * verb coming to walk it, and without this row had no way back at all.
     */
    public static function returnsFromUpdates(CipApplication $application, string $to): bool
    {
        return $application->status === Status::UPDATE_REQUIRED
            && in_array($to, [Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT], true)
            && self::canTransition($application, $to);
    }

    /** That return, while no document is still standing at Update required. */
    private static function returnIsOpen(CipApplication $application, string $to): bool
    {
        return self::returnsFromUpdates($application, $to) && ! Review::hasSentBack($application);
    }

    /**
     * Statuses this reader may set that are not the next mapped step.
     *
     * Administrators only, in both lanes. Pulling Approved back to
     * Assessment Feedback is an override and is logged as one. Everyone else
     * gets an empty list; officers used to see the same rows locked, and
     * that read as though they could not change a status at all.
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
     * {@see availableOverrides()} as the rows a picker draws, each saying
     * whether it is a step ahead (confirmed like any move) or a pull back
     * (an override, with its reason).
     *
     * @return list<array{value:string,label:string,tone:string,forward:bool}>
     */
    public static function overrideChoices(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        return array_map(fn (string $status) => [
            'value' => $status,
            'label' => Status::label($status),
            'tone' => Status::tone($status),
            'forward' => self::isForward($application, $status),
        ], self::availableOverrides($application, $actor, $forListing));
    }

    /**
     * Is this off-map move a step further along the file's own lane?
     *
     * A forward jump is ordinary work — the reader is moving the file on,
     * not undoing anything — so it is confirmed like any other move and
     * does not ask for a typed OVERRIDE or a reason. Anything that goes
     * back, crosses lanes backwards, or would clear a recorded decision is
     * still an override. Updates Required is never "forward": it is the
     * send-back.
     */
    public static function isForward(CipApplication $application, string $to): bool
    {
        $from = $application->status;

        if ($to === $from || $to === Status::UPDATE_REQUIRED || $to === Status::DRAFT) {
            return false;
        }

        if (Status::isDecided($from) && ! Status::isDecided($to) && ! self::staysInPostApproval($application, $to)) {
            return false;
        }

        // A refusal goes on only to being closed or appealed. Anywhere on
        // the approval path is the outcome being reversed.
        if (in_array($from, [Status::DENIED, Status::POST_DENIED], true)) {
            return $to === Status::CLOSED || in_array($to, Status::APPEAL_LANE, true);
        }

        $here = self::rank($application, $from);
        $there = self::rank($application, $to);

        return $here !== null && $there !== null && $there > $here;
    }

    /** Where a status stands for {@see isForward()}; Updates Required where the file was held. */
    private static function rank(CipApplication $application, string $status): ?int
    {
        if ($status !== Status::UPDATE_REQUIRED) {
            return self::ORDER[$status] ?? null;
        }

        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            // Sent back from Assessment Feedback, before Ready to Submit.
            return self::ORDER[Status::ASSESSMENT_FEEDBACK] + 5;
        }

        return match (Pack::current($application)) {
            Pack::PASSPORT => self::ORDER[Status::APPLY_FOR_PASSPORT] + 5,
            Pack::NIC => self::ORDER[Status::APPLY_FOR_NIC] + 5,
            default => self::ORDER[Status::APPLY_FOR_COR] + 5,
        };
    }

    /**
     * The same off-map statuses, shown locked, for a reader who may see the
     * lifecycle but may not set those statuses.
     *
     * Empty for an administrator, whose
     * copy of this list is actionable and arrives through
     * {@see availableOverrides()}, and for anyone who may not change status
     * at all.
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
    /**
     * The lane's own steps that a date verb drives, not the picker.
     *
     * Pending COR, Apply for NIC and the rest each record a day as they move
     * (sections 6-12: the day and the status travel together), so they are not
     * options somebody types. They are still part of the lifecycle the
     * reader is looking at, though, and a menu that simply omitted them read
     * as if the lane stopped after two entries — so they are listed, shown
     * as locked, with the date buttons remaining the way to reach them.
     *
     * @return list<string>
     */
    public static function stageStatuses(CipApplication $application, ?User $actor): array
    {
        if ($actor === null || ! CipAccess::canChangeApplicationStatus($actor)) {
            return [];
        }

        $lane = ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL
            ? Phase::POST_APPROVAL
            : Phase::PRE_APPROVAL;

        return array_values(array_filter(
            Status::listed(),
            fn (string $to) => $to !== $application->status
                && Stages::owns($to)
                && Status::laneOf($to) === $lane,
        ));
    }

    private static function offMapStatuses(CipApplication $application, ?User $actor, bool $forListing = false): array
    {
        /*
         * A draft has no status vocabulary but its own.
         *
         * It is an application nobody has finished typing, so there is
         * nothing to override it TO: marking it Ready to submit or Approved
         * would be a claim about a file that has never been completed. The
         * one edge out of DRAFT is the submit verb, which checks the main
         * applicant's documents first — see CipTransitionController::submit.
         */
        if ($application->status === Status::DRAFT) {
            return [];
        }

        $next = self::availableTransitions($application, $actor, $forListing);

        /*
         * A dated step is normally the date verb's to drive, so it is kept
         * out of the picker. The one exception is a denied file: it closes,
         * but not by recording the delivery of a passport nobody was issued,
         * so Stages offers it no verb at all. Closed has to come from the
         * picker there or the file has nowhere left to go.
         *
         * Deliberately narrow. Testing "no verb is available" instead would
         * have opened every dated step wherever a verb happened to be
         * waiting on something else — Pending COR while the package is
         * unconfirmed, for one.
         */
        $denied = in_array($application->status, [Status::POST_DENIED, Status::DENIED], true);
        $strandedStage = fn (string $to) => $denied
            && $to === Status::CLOSED
            && self::canTransition($application, $to);

        return array_values(array_filter(
            Status::listed(),
            fn (string $to) => $to !== $application->status
                && ! in_array($to, $next, true)
                && ! self::outcomeAlreadyDecided($application, $to)
                && self::overrideFits($application, $to)
                && (self::packageAllowsOverride($application, $to, $forListing)
                    || CipAccess::canAcknowledgeBlockers($actor, $to))
                && (! Stages::owns($to) || $strandedStage($to))
                && ! Delay::owns($to),
        ));
    }

    /**
     * Apply for COR is the one status an override may not jump to.
     *
     * Every other post-approval step forward already records a date, and
     * the date verbs refuse an unfinished pack for administrators too. An
     * override straight to Apply for COR was the last way to put a file on
     * "every document is Ready for submission" while some were not, where
     * it then sat: the provider could not confirm it and the submission
     * could not be recorded. So it is offered, and accepted, only when the
     * claim is true. Pulling a file BACK is untouched, which is what an
     * override is for.
     */
    private static function packageAllowsOverride(CipApplication $application, string $to, bool $forListing = false): bool
    {
        return $to !== Status::APPLY_FOR_COR || self::checklistAllows($application, $to, $forListing);
    }

    /**
     * Submitting is a claim about the checklist. Approving is not.
     *
     * Ready to Submit, the Unit submission (Pending Review), and Apply for
     * COR all require every required document, and every document that has
     * been uploaded, to be Ready for submission. A file still in Application
     * review has not been accepted.
     *
     * Approved and Denied are the Unit's decision at Background Check, DD
     * Query or Delayed: both stay on offer once the file is there, whether
     * or not every portal slot is Ready for submission. The decision letter
     * is what that verb asks for, not a finished checklist.
     *
     * An override does not ask this. {@see set()} is how an administrator
     * still moves the file, with a reason, when the checklist has not been
     * finished. The next-step list is what stays shut for Ready to Submit
     * and the other submit claims.
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
        if (! in_array($to, [
            Status::READY_TO_SUBMIT,
            Status::PENDING_REVIEW,
            Status::APPLY_FOR_COR,
        ], true)) {
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

        return Review::packageReady($application);
    }

    /**
     * Apply for COR is a post-approval working label. Post-Approval is the
     * next lane after a grant, or a return from Apply for COR / Updates
     * Required once the file is already in that lane — never a hop off
     * pre-approval Updates Required.
     */
    private static function phaseAllows(CipApplication $application, string $to): bool
    {
        $phase = $application->phase ?? Phase::PRE_APPROVAL;
        $post = $phase === Phase::POST_APPROVAL;

        /*
         * Add-On never works Background Check, the DD path, or post-approval
         * COR collection. Those labels belong to the first filing; an Add-On
         * that has been submitted is either asked for more paper, approved,
         * or denied.
         */
        if ($phase === Phase::ADD_ON) {
            if (in_array($to, [
                Status::BACKGROUND_CHECK,
                Status::DD_QUERY,
                Status::DELAYED,
                Status::POST_APPROVAL,
                Status::POST_APPROVED,
                Status::POST_DENIED,
            ], true) || Status::inLane($to)) {
                return false;
            }
        }

        /*
         * A file the lane has already decided collects under Approved. From
         * Updates Required it returns there by itself once nothing is
         * refused; the mapped step back to Post-Approval would stand a
         * decided file on the label of one that has not been, with its
         * people still reading Approved. Undoing the decision is a
         * different act and stays an override, see {@see write()}.
         */
        if ($to === Status::POST_APPROVAL && $post
            && $application->status === Status::UPDATE_REQUIRED
            && $application->decision === Status::POST_APPROVED) {
            return false;
        }

        /*
         * Nor is it a step back for a file whose COR has been received.
         * Updates Required at the NIC or passport stage returns to Apply
         * for NIC or Apply for Passport, and does so by itself; offered
         * Post-Approval there, as the one row that could be pressed, a
         * file was put on a label whose checklist it had already finished
         * and then had no way forward. Asked before the general answer
         * below, which used to return first and leave this unreachable.
         */
        if ($to === Status::POST_APPROVAL && $post && Pack::hasReachedNic($application)
            && $application->status === Status::UPDATE_REQUIRED) {
            return false;
        }

        if ($to === Status::POST_APPROVAL) {
            return $application->status === Status::GRANTED || $post;
        }

        if ($to === Status::APPLY_FOR_COR && $post && Pack::hasReachedNic($application)) {
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
     * Pending Review, Non-compliant, Background Check or DD Query, and a pre-approval
     * file is not offered the lane's own labels.
     *
     * The exception is a file that has not started the lane's work. Granted
     * is the decision itself; Post-Approval is the file having just crossed
     * over, before a single COR document has been assessed. From either, a
     * grant issued in error is still ordinary to undo, and the pull-back
     * carries the file's phase back to pre-approval with it (see
     * {@see set()}), so the statuses it lands on are the ones it will then be
     * wearing.
     *
     * Once the file is actually working the lane — Apply for COR onward —
     * that door shuts: it has a COR application in progress, and sending it
     * back to Background Check would put it in a queue for a decision it
     * already holds.
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

        /*
         * The other lane, offered as an override rather than hidden.
         *
         * The picker keeps the two lifecycles apart by putting this lane
         * behind its own row — "Pre-approval override" — rather than by
         * pretending it does not exist. An administrator moving a file
         * between lanes is a real act; what the split fixed was one flat
         * list that made the reader work out which label belonged to which
         * process.
         */
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
            throw (new NotReady(self::checklistRefusal($to), Review::blockerRows($application)))
                ->acknowledgeableBy($actor, $to);
        }

        /*
         * Taken by hand while a paper is still sent back, the return would
         * only be undone: the checklist is read as the file arrives and
         * would stand it on Updates Required again, two notices for a file
         * that went nowhere. The checklist's own walk is never caught here,
         * it only sets out once nothing is refused.
         */
        if (self::returnsFromUpdates($application, $to)) {
            Review::forgetTally($application);

            if (Review::hasSentBack($application)) {
                throw new NotReady(
                    'A document that was sent back has to be replaced and accepted first.',
                    Review::blockerRows($application),
                );
            }
        }

        return self::write($application, $to, $actor, $meta);
    }

    /**
     * Put the application on this status, whether or not the lifecycle has
     * an edge there from here.
     *
     * Administrators only. Mapped next steps go
     * through {@see apply()}; jumping from Approved back to Assessment
     * Feedback is an override and is logged as one. DRAFT is not a
     * destination.
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
                'You cannot pull this application back to an earlier status.'
            );
        }

        if ($actor !== null && ! self::allows($actor, $application, $to)) {
            throw new AuthorizationException('You cannot move this application to '.Status::label($to).'.');
        }

        /*
         * The picker draws what an override may reach; the write agrees with
         * it, so an option the menu never shows is not one the endpoint
         * quietly accepts.
         *
         * The document checklist is not one of those gates in pre-approval:
         * there an override is the way past an unfinished checklist, and the
         * reason above is what the audit keeps. Apply for COR is the
         * exception, checked just below; see {@see packageAllowsOverride()}.
         */
        if ($actor !== null && ! self::overrideFits($application, $to)) {
            throw new \InvalidArgumentException(sprintf(
                '%s cannot be set on this application.',
                Status::label($to),
            ));
        }

        $forward = self::isForward($application, $to);
        $acknowledged = ! empty($meta['acknowledged']);
        unset($meta['acknowledged']);

        /*
         * Documents that are not Ready for submission are a warning, not a
         * wall, for the reader who may carry on past them: the refusal lists
         * them and says so, and the same move sent back acknowledged goes
         * through, with what was missing kept on the audit row.
         *
         * Apply for COR was refused outright; an administrator now gets the
         * list and the choice. A forward jump to Ready to Submit or the Unit
         * submission used to pass silently under its override reason; it is
         * no longer an override, so it shows the list instead. A pull BACK
         * with a reason stays as it was.
         */
        $packageShort = $actor !== null && (
            ! self::packageAllowsOverride($application, $to)
            || ($forward && ! self::checklistAllows($application, $to))
        );

        if ($packageShort) {
            $refusal = new NotReady(self::checklistRefusal($to), Review::blockerRows($application));

            if (! $acknowledged || ! CipAccess::canAcknowledgeBlockers($actor, $to)) {
                throw $refusal->acknowledgeableBy($actor, $to);
            }

            $meta['acknowledgedBlockers'] = array_values(array_map(
                fn (array $row) => trim(($row['person'] ?? '').' — '.($row['label'] ?? '').' ('.($row['statusLabel'] ?? '').')', ' —'),
                $refusal->blockers,
            ));
        }

        // Section 26: an administrator may type any listed status, but the audit
        // row has to say why. System writes (a null actor) skip this — the
        // checklist inferring Ready to submit is not a person changing a
        // label by hand. A step further along the lane is not an override
        // and needs no reason; see {@see isForward()}.
        if ($actor !== null && ! $forward && trim((string) ($meta['note'] ?? '')) === '') {
            throw new \InvalidArgumentException('Give a reason for changing the status.');
        }

        $from = $application->status;
        $extra = [];
        $meta = array_merge($meta, $forward ? ['skippedAhead' => true] : ['override' => true]);

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

    /** Statuses where the original package is still being put together. */
    private const PACKAGE_OPEN = [
        Status::NEW,
        Status::REVIEW_APPLICATION,
        Status::ASSESSMENT_FEEDBACK,
        Status::UPDATE_REQUIRED,
    ];

    /** Statuses where the original package has gone to the Unit. */
    private const PACKAGE_SUBMITTED = [
        Status::PENDING_REVIEW,
        Status::NON_COMPLIANT,
        Status::BACKGROUND_CHECK,
        Status::DD_QUERY,
        Status::DELAYED,
        Status::GRANTED,
        Status::DENIED,
    ];

    /**
     * The package lock follows the stage the file is on, not the day it was
     * first confirmed.
     *
     * "The original submission is locked" is true of a file the provider has
     * confirmed and the Unit holds. It used to be stamped once and never
     * lifted, so a file an administrator pulled back to Assessment Feedback
     * or Updates Required still refused every replacement scan, with only
     * Additional Documents open — the very papers the file had been sent
     * back to fix. Now:
     *
     *  - back to New, Review, Assessment Feedback or Updates Required, or
     *    back from the Unit to Ready to Submit: the package opens again, and
     *    the provider confirms it again when it is ready;
     *  - onto Pending Review or anything after it without a confirmation (an
     *    override past that step): the package is frozen as it stands;
     *  - in post-approval the COR package does the same — it opens again
     *    when the file goes back to Post-Approval, Approved, or Updates
     *    Required while the COR papers are what is being collected — and a
     *    file leaving the lane leaves no COR lock behind.
     *
     * The audit row says which way it went.
     *
     * @param  array<string, mixed>  $extra
     * @param  array<string, mixed>  $meta
     * @return array<string, mixed>
     */
    private static function lockFollowsStage(CipApplication $application, string $to, array $extra, array &$meta): array
    {
        $from = $application->status;
        $phase = $extra['phase'] ?? ($application->phase ?? Phase::PRE_APPROVAL);

        if ($phase !== Phase::POST_APPROVAL) {
            if ($application->cor_locked_at !== null && ! array_key_exists('cor_locked_at', $extra)) {
                $extra['cor_locked_at'] = null;
            }

            $reopens = in_array($to, self::PACKAGE_OPEN, true)
                || ($to === Status::READY_TO_SUBMIT && in_array($from, self::PACKAGE_SUBMITTED, true));

            if ($application->locked_at !== null && $reopens) {
                $extra['locked_at'] = null;
                $meta['packageReopened'] = true;
            } elseif ($application->locked_at === null && in_array($to, self::PACKAGE_SUBMITTED, true)) {
                $extra['locked_at'] = now();
                $meta['packageLocked'] = true;
            }

            return $extra;
        }

        if ($application->cor_locked_at === null) {
            return $extra;
        }

        $corOpens = in_array($to, [Status::POST_APPROVAL, Status::POST_APPROVED], true)
            || ($to === Status::UPDATE_REQUIRED && Pack::current($application) === Pack::COR)
            || ($to === Status::APPLY_FOR_COR && in_array($from, [
                Status::PENDING_COR, Status::COR_RECEIVED, Status::APPLY_FOR_NIC, Status::PENDING_NIC,
                Status::NIC_RECEIVED, Status::APPLY_FOR_PASSPORT, Status::PENDING_PASSPORT,
                Status::PASSPORT_RECEIVED, Status::PASSPORT_DELIVERED, Status::CLOSED,
            ], true));

        if ($corOpens) {
            $extra['cor_locked_at'] = null;
            $meta['corPackageReopened'] = true;
        }

        return $extra;
    }

    /** The row and the audit, once the move has already been allowed. */
    private static function write(CipApplication $application, string $to, ?User $actor, array $meta, array $extra = []): CipApplication
    {
        // The COR certificate rides on the notice only. The status event
        // keeps the date, not the file.
        $certificateId = (int) ($meta['corCertificateFileId'] ?? 0);
        unset($meta['corCertificateFileId']);

        // Named on the status dialog, and refused before the row moves, so a
        // typo does not leave the file on a status whose copy never went out.
        // Only the dialog's own route, and only its first write: a checklist
        // that then moves the file does not mail the same addresses again.
        $copies = StatusCopies::take();

        $enteringPost = $to === Status::POST_APPROVAL
            && ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL;

        if ($enteringPost) {
            $extra = array_merge([
                'phase' => Phase::POST_APPROVAL,
                'post_approval_at' => $application->post_approval_at ?? now(),
            ], $extra);
        }

        /*
         * Back to Post-Approval is the lane's decision being undone.
         *
         * Post-Approval is the file before it was approved or denied, so a
         * decided file put back there no longer holds that decision. Left
         * on the row it contradicted the chip, and the next time a paper
         * was sent back and replaced the checklist read it and walked the
         * file to Approved again with nobody having decided anything. What
         * the file held before the lane decided, the Unit's grant, is put
         * back in its place.
         */
        if ($to === Status::POST_APPROVAL
            && ! $enteringPost
            && $application->decision === Status::POST_APPROVED
            && ! array_key_exists('decision', $extra)) {
            [$earlier, $earlierAt] = self::decisionBeforeLane($application);

            $meta['clearedDecision'] = $application->decision;
            $meta['clearedDecidedAt'] = $application->decided_at?->toDateString();
            $extra['decision'] = $earlier;
            $extra['decided_at'] = $earlierAt;
        }

        $from = $application->status;
        $extra = self::lockFollowsStage($application, $to, $extra, $meta);
        $lockMoved = array_key_exists('locked_at', $extra) || array_key_exists('cor_locked_at', $extra);
        $application = DB::transaction(function () use ($application, $to, $actor, $meta, $from, $extra, $enteringPost, $lockMoved) {
            $application->forceFill(array_merge(['status' => $to], $extra))->save();

            self::record($application, CipEvent::ACTION_STATUS_CHANGED, $actor, $meta, $from, $to);

            if ($enteringPost) {
                self::record($application, CipEvent::ACTION_POST_APPROVAL_ENTERED, $actor, []);
                PostApproval::prepare($application, $actor);
            }

            // A receipt opens the next pack's slots while the file rests on
            // that receipt. Apply for NIC / Apply for Passport open them
            // again, which is a no-op once they exist.
            if (in_array($to, [Status::COR_RECEIVED, Status::APPLY_FOR_NIC, Status::NIC_RECEIVED, Status::APPLY_FOR_PASSPORT], true)) {
                Requirements::materialiseApplication($application);
            }

            // A pack has just gone to the Unit: anybody standing apart whose
            // papers were not in it has missed it. The COR package is noted
            // as it is confirmed, see {@see Confirmation}.
            if ($to === Status::PENDING_NIC) {
                PersonStatus::markMissed($application, Pack::NIC);
            } elseif ($to === Status::PENDING_PASSPORT) {
                PersonStatus::markMissed($application, Pack::PASSPORT);
            }

            /*
             * Everyone on the file moves with it, in the same write.
             *
             * After the next pack's slots exist, because a person's step is
             * read through their own documents. A file that has left the
             * lane is left alone by this, so nothing is undone on the way
             * back to pre-approval.
             */
            PersonStatus::settle($application);

            if ($to === Status::CLOSED || $to === Status::PASSPORT_DELIVERED || $lockMoved) {
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
         * request for Stage 1 documents. The same return for a file already
         * decided lands on Approved, and is not a second decision: the
         * letter went out once, when it was made.
         */
        $backToCollecting = $to === Status::POST_APPROVED
            && ($meta['reason'] ?? null) === 'checklist';

        if (($enteringPost || $to !== Status::POST_APPROVAL) && ! $backToCollecting) {
            try {
                /*
                 * Its own savepoint. Acceptance, a query, and an appeal
                 * hold an outer transaction that still has the covering
                 * note to write. A notice that fails a query and swallows
                 * it aborts that transaction on Postgres, and the next
                 * statement comes back as a server error for a status that
                 * did land. Rolling the savepoint back leaves the status
                 * write usable. A notice that throws outright is the same
                 * answer: the status happened, the letter can be missed.
                 */
                // A certificate the dialog asked to send is already filed.
                // Anything else attached to this status — pre-approval,
                // post-approval, or a person step that lifted the file —
                // rides on the same notice. A claim made before this write,
                // so the file could be kept under the right person, is reused.
                $noticeFile = $certificateId > 0 ? FileItem::query()->find($certificateId) : null;
                if ($noticeFile === null) {
                    $noticeFile = StatusAttachment::alreadyClaimed();
                }
                if ($noticeFile === null && $actor !== null) {
                    $noticeFile = StatusAttachment::claimForNotice($application, $actor);
                }

                DB::transaction(function () use ($application, $to, $actor, $meta, $noticeFile, $copies) {
                    Notices::announce(
                        $application,
                        $to,
                        $actor,
                        is_string($meta['message'] ?? null) ? $meta['message'] : null,
                        // COR RECEIVED, not APPLY FOR NIC: section 22 names a
                        // receipt for what arrived. Only when a date verb made the
                        // move; the checklist's own return to Apply for NIC is not
                        // the COR arriving a second time.
                        Stages::subject(is_string($meta['stage'] ?? null) ? $meta['stage'] : null),
                        $noticeFile,
                        $copies,
                    );
                });

                if (request() !== null) {
                    request()->attributes->set('cip.status_notice_sent', true);
                }

                if ($noticeFile !== null) {
                    StatusAttachment::consumeClaim();
                }
            } catch (Throwable $e) {
                Log::error('CIP status notice failed after the status was saved.', [
                    'application' => $application->getKey(),
                    'status' => $to,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        /*
         * Arriving at Apply for NIC or Apply for Passport opens a pack, and
         * the pack may not be empty. Somebody whose NIC was recorded on
         * their own has had their passport slots since, and a paper of
         * theirs may already have been sent back: the file was not judged
         * on it then, and is now. So the checklist is read once as the file
         * arrives, the way it is when a decision lands. Not when the
         * checklist itself brought the file here, which is that reading.
         */
        if (in_array($to, [Status::APPLY_FOR_NIC, Status::APPLY_FOR_PASSPORT], true)
            && ($meta['reason'] ?? null) !== 'checklist') {
            $application = Review::settle($application, $actor);
        }

        return $application;
    }

    /**
     * The decision a file held before the post-approval lane decided it:
     * the Unit's grant and its day, read off the trail, or nothing for a
     * file that was filed straight into the lane.
     *
     * @return array{0: ?string, 1: ?Carbon}
     */
    public static function decisionBeforeLane(CipApplication $application): array
    {
        $grant = CipEvent::query()
            ->where('application_id', $application->getKey())
            ->where('action', CipEvent::ACTION_DECISION_RECORDED)
            ->orderByDesc('id')
            ->get()
            ->first(fn (CipEvent $event) => ($event->meta['decision'] ?? null) === Status::GRANTED);

        if ($grant === null) {
            return [null, null];
        }

        $day = $grant->meta['decidedAt'] ?? null;

        return [Status::GRANTED, $day ? Carbon::parse($day) : $grant->created_at];
    }

    private static function checklistRefusal(string $to): string
    {
        return 'Every required document, and every document that has been uploaded, must be Ready for submission before this application can be '.Status::label($to).'.';
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
