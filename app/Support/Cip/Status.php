<?php

namespace App\Support\Cip;

/**
 * The application status vocabulary, the full lifecycle, defined once even
 * though the transitions arrive over several build phases, so dashboards and
 * scope queries never need rework as statuses light up.
 *
 * The labels are the same words section 9's buckets use, so a row's chip and the
 * queue it sits in cannot disagree.
 *
 * DRAFT is where the intake wizard's autosave puts an application it is still
 * being typed into. It is a real row, in the table, with its own number — but
 * it is not part of the lifecycle proper: {@see listed()} leaves it out, so no
 * picker offers it and no picker offers anything else to a file standing in
 * it. The one edge out is the submit verb, which checks the main applicant's
 * documents before letting the file join the New Applications queue.
 */
class Status
{
    public const DRAFT = 'draft';

    public const NEW = 'new';

    public const REVIEW_APPLICATION = 'review_application';

    public const ASSESSMENT_FEEDBACK = 'assessment_feedback';

    public const UPDATE_REQUIRED = 'update_required';

    public const READY_TO_SUBMIT = 'ready_to_submit';

    public const PENDING_REVIEW = 'pending_review';

    public const NON_COMPLIANT = 'non_compliant';

    public const BACKGROUND_CHECK = 'background_check';

    public const DD_QUERY = 'dd_query';

    public const DELAYED = 'delayed';

    public const GRANTED = 'granted';

    public const POST_APPROVAL = 'post_approval';

    public const APPLY_FOR_COR = 'apply_for_cor';

    public const PENDING_COR = 'pending_cor';

    public const APPLY_FOR_NIC = 'apply_for_nic';

    public const PENDING_NIC = 'pending_nic';

    public const APPLY_FOR_PASSPORT = 'apply_for_passport';

    public const PENDING_PASSPORT = 'pending_passport';

    public const READY_FOR_DELIVERY = 'ready_for_delivery';

    public const CLOSED = 'closed';

    /*
     * The post-approval lane's own outcomes.
     *
     * Separate constants rather than reusing GRANTED / DENIED, because the
     * two lanes are two processes. The pre-approval pair records the Unit's
     * decision on the application and is only reachable from Background
     * check or Delayed; these record the outcome of the post-approval work
     * and are reachable from where that work actually ends. They carry their
     * own letters (see {@see Letters::defaults()}), so a file approved after
     * COR, NIC and the passport office is not written to as though it had
     * just been granted.
     */
    public const POST_APPROVED = 'post_approved';

    public const POST_DENIED = 'post_denied';

    public const DENIED = 'denied';

    /*
     * The appeal lane. A decision is not always the end of a file: the
     * applicant, the provider side or the firm may disagree with it, and the
     * appeal that follows is its own small lifecycle, lodged, made ready,
     * submitted. It runs after GRANTED or DENIED and from either phase, so it
     * is not part of LANE, which is the post-approval lane after a grant.
     *
     * An appeal ends in the SAME Approved / Denied the first decision uses.
     * There is no won/lost pair: the question a reader asks of a file is what
     * the outcome IS, and a second vocabulary for it would mean every filter,
     * chip and report had to know about two ways of being approved.
     */
    public const NEW_APPEAL = 'new_appeal';

    public const APPEAL_READY = 'appeal_ready';

    public const APPEAL_SUBMITTED = 'appeal_submitted';

    public const ALL = [
        self::DRAFT,
        self::NEW,
        self::REVIEW_APPLICATION,
        self::ASSESSMENT_FEEDBACK,
        self::UPDATE_REQUIRED,
        self::READY_TO_SUBMIT,
        self::PENDING_REVIEW,
        self::NON_COMPLIANT,
        self::BACKGROUND_CHECK,
        self::DD_QUERY,
        self::DELAYED,
        self::GRANTED,
        self::POST_APPROVAL,
        self::APPLY_FOR_COR,
        self::PENDING_COR,
        self::APPLY_FOR_NIC,
        self::PENDING_NIC,
        self::APPLY_FOR_PASSPORT,
        self::PENDING_PASSPORT,
        self::READY_FOR_DELIVERY,
        self::CLOSED,
        self::POST_APPROVED,
        self::POST_DENIED,
        self::DENIED,
        self::NEW_APPEAL,
        self::APPEAL_READY,
        self::APPEAL_SUBMITTED,
    ];

    /**
     * The appeal lane, in its own order.
     *
     * @return list<string>
     */
    public const APPEAL_LANE = [
        self::NEW_APPEAL,
        self::APPEAL_READY,
        self::APPEAL_SUBMITTED,
    ];

    /**
     * Statuses that belong to the post-approval lane after a grant.
     *
     * @return list<string>
     */
    public const LANE = [
        self::POST_APPROVAL,
        self::APPLY_FOR_COR,
        self::PENDING_COR,
        self::APPLY_FOR_NIC,
        self::PENDING_NIC,
        self::APPLY_FOR_PASSPORT,
        self::PENDING_PASSPORT,
        self::READY_FOR_DELIVERY,
        self::POST_APPROVED,
        self::POST_DENIED,
        self::CLOSED,
    ];

    /**
     * A decision that cannot be recorded again through the decision verb.
     *
     * GRANTED is still a decision, even though the file may then move into
     * post-approval. DENIED is the other outcome. Post-approval is the next
     * lane after a grant, not a second decision.
     */
    public const TERMINAL = [self::GRANTED, self::DENIED];

    /**
     * Statuses that mean the Unit has already decided.
     *
     * Pulling one of these back into the pre-decision lifecycle clears the
     * stored outcome. Moving GRANTED → POST APPROVAL does not: that is the
     * next lane, not an undo.
     */
    public const DECIDED = [
        self::GRANTED,
        self::POST_APPROVAL,
        self::APPLY_FOR_COR,
        self::PENDING_COR,
        self::APPLY_FOR_NIC,
        self::PENDING_NIC,
        self::APPLY_FOR_PASSPORT,
        self::PENDING_PASSPORT,
        self::READY_FOR_DELIVERY,
        self::CLOSED,
        self::DENIED,
    ];

    private const LABELS = [
        // An application being typed into the intake wizard, saved as it goes.
        // It is a real row in the table with its own number, so it says what
        // it is; it is not a queue, and {@see listed()} keeps it out of every
        // picker, because the only way out of Draft is to file it.
        self::DRAFT => 'Draft',
        self::NEW => 'New Applications',
        self::REVIEW_APPLICATION => 'Review Applications',
        self::ASSESSMENT_FEEDBACK => 'Assessment Feedback',
        self::UPDATE_REQUIRED => 'Updates Required',
        self::READY_TO_SUBMIT => 'Ready to Submit',
        self::PENDING_REVIEW => 'Pending Review',
        self::NON_COMPLIANT => 'Non-compliant',
        self::BACKGROUND_CHECK => 'Background Check',
        self::DD_QUERY => 'DD Query',
        self::DELAYED => 'Delayed',
        self::GRANTED => 'Approved',
        self::POST_APPROVAL => 'Post-Approval',
        self::APPLY_FOR_COR => 'Apply for COR',
        self::PENDING_COR => 'Pending COR',
        self::APPLY_FOR_NIC => 'Apply for NIC',
        self::PENDING_NIC => 'Pending NIC',
        self::APPLY_FOR_PASSPORT => 'Apply for Passport',
        self::PENDING_PASSPORT => 'Pending Passport',
        self::READY_FOR_DELIVERY => 'Ready for Delivery',
        self::POST_APPROVED => 'Approved',
        self::POST_DENIED => 'Denied',
        self::CLOSED => 'Closed',
        self::DENIED => 'Denied',
        self::NEW_APPEAL => 'New Appeal',
        self::APPEAL_READY => 'Appeal Ready',
        self::APPEAL_SUBMITTED => 'Appeal Submitted',
    ];

    /**
     * The status token section 22 puts in email subjects, not the chip/bucket label.
     *
     * Chips say Review Applications and Approved; the filing format says
     * REVIEW APPLICATION and GRANTED, matching the brief's worked examples.
     */
    private const SUBJECT_LABELS = [
        self::DRAFT => 'DRAFT',
        self::NEW => 'NEW APPLICATION',
        self::REVIEW_APPLICATION => 'REVIEW APPLICATION',
        self::ASSESSMENT_FEEDBACK => 'ASSESSMENT FEEDBACK',
        self::UPDATE_REQUIRED => 'UPDATE REQUIRED',
        self::READY_TO_SUBMIT => 'READY TO SUBMIT',
        self::PENDING_REVIEW => 'PENDING REVIEW',
        self::NON_COMPLIANT => 'NON-COMPLIANT',
        self::BACKGROUND_CHECK => 'BACKGROUND CHECK',
        self::DD_QUERY => 'DD QUERY',
        self::DELAYED => 'DELAYED',
        self::GRANTED => 'GRANTED',
        self::POST_APPROVAL => 'POST APPROVAL',
        self::APPLY_FOR_COR => 'APPLY FOR COR',
        self::PENDING_COR => 'PENDING COR',
        self::APPLY_FOR_NIC => 'APPLY FOR NIC',
        self::PENDING_NIC => 'PENDING NIC',
        self::APPLY_FOR_PASSPORT => 'APPLY FOR PASSPORT',
        self::PENDING_PASSPORT => 'PENDING PASSPORT',
        self::READY_FOR_DELIVERY => 'READY FOR DELIVERY',
        self::POST_APPROVED => 'APPROVED',
        self::POST_DENIED => 'DENIED',
        self::CLOSED => 'FILE CLOSED',
        self::DENIED => 'DENIED',
        self::NEW_APPEAL => 'NEW APPEAL',
        self::APPEAL_READY => 'APPEAL READY',
        self::APPEAL_SUBMITTED => 'APPEAL SUBMITTED',
    ];

    /**
     * One colour per listed status, so a filter row, a table chip and a
     * dashboard dot can tell the queues apart without reading the label.
     *
     * The portal's five generic chip tones (action, pending, success, danger,
     * neutral) still colour files and everything else. CIP does not borrow
     * them across eleven different queues, that is how five blues sat next
     * to each other. Approved and Denied keep success and danger so a
     * decision still reads as a decision. Draft is leftover and stays grey.
     */
    private const TONES = [
        self::DRAFT => 'neutral',
        self::NEW => 'sky',
        self::REVIEW_APPLICATION => 'indigo',
        self::ASSESSMENT_FEEDBACK => 'violet',
        self::UPDATE_REQUIRED => 'amber',
        self::READY_TO_SUBMIT => 'teal',
        self::PENDING_REVIEW => 'orange',
        self::NON_COMPLIANT => 'rose',
        self::BACKGROUND_CHECK => 'cyan',
        self::DD_QUERY => 'azure',
        self::DELAYED => 'copper',
        self::GRANTED => 'success',
        self::POST_APPROVAL => 'action',
        self::APPLY_FOR_COR => 'emerald',
        self::PENDING_COR => 'slate',
        self::APPLY_FOR_NIC => 'lime',
        self::PENDING_NIC => 'navy',
        self::APPLY_FOR_PASSPORT => 'gold',
        self::PENDING_PASSPORT => 'plum',
        self::READY_FOR_DELIVERY => 'mint',
        // The lane's own colours: read as approved and denied, but not the
        // same dots the pre-approval pair wears — see CipBucketTest, which
        // holds every listed status to its own colour.
        self::POST_APPROVED => 'laurel',
        self::POST_DENIED => 'garnet',
        self::CLOSED => 'stone',
        self::DENIED => 'danger',
        // The lane reads as one family, warm and distinct from the queues it
        // sits after. There is no purple in the design system.
        self::NEW_APPEAL => 'clay',
        self::APPEAL_READY => 'sand',
        self::APPEAL_SUBMITTED => 'moss',
    ];

    public static function isValid(string $status): bool
    {
        return in_array($status, self::ALL, true);
    }

    public static function isTerminal(string $status): bool
    {
        return in_array($status, self::TERMINAL, true);
    }

    /**
     * The outcome pair belonging to one lane.
     *
     * Two pairs, because the lanes are two processes. Asking for the pair by
     * lane is what lets one decision verb serve both without either
     * borrowing the other's rules.
     *
     * @return array{0:string,1:string} approved, then denied
     */
    public static function outcomesFor(string $phase): array
    {
        return $phase === Phase::POST_APPROVAL
            ? [self::POST_APPROVED, self::POST_DENIED]
            : [self::GRANTED, self::DENIED];
    }

    /** Is this an outcome of either lane? */
    public static function isOutcome(string $status): bool
    {
        return in_array($status, [self::GRANTED, self::DENIED, self::POST_APPROVED, self::POST_DENIED], true);
    }

    /** Has this file already been decided in the lane it is standing in? */
    public static function isOutcomeOf(string $status, string $phase): bool
    {
        return in_array($status, self::outcomesFor($phase), true);
    }

    public static function isDecided(string $status): bool
    {
        return in_array($status, self::DECIDED, true);
    }

    public static function inLane(string $status): bool
    {
        return in_array($status, self::LANE, true);
    }

    /**
     * Which lane a status belongs to, for a picker that groups by it.
     *
     * Three answers, not two. The appeal statuses run after a decision from
     * either side, and Updates Required means the same thing in both lanes —
     * the provider side has work — so neither is owned by one of them.
     * `null` is that: a status the picker shows wherever the file is.
     */
    public static function laneOf(string $status): ?string
    {
        /*
         * Shared by both lanes, so the picker shows them wherever the file
         * stands rather than filing them under the other lifecycle: Updates
         * Required means the same thing on either side — the provider side
         * has work to do — and the appeal steps run after a decision from
         * either.
         *
         * The outcomes are NOT shared. Each lane has its own pair, because
         * each is a different act with different rules: GRANTED / DENIED are
         * the Unit's decision on the application, reachable only from
         * Background check, DD Query or Delayed; POST_APPROVED / POST_DENIED are the
         * outcome of the post-approval work, reachable from where that work
         * ends. Treating one pair as belonging to both lanes is what put a
         * post-approval file in front of the pre-approval rule.
         */
        if (in_array($status, self::APPEAL_LANE, true)
            || $status === self::UPDATE_REQUIRED) {
            return null;
        }

        return self::inLane($status) ? Phase::POST_APPROVAL : Phase::PRE_APPROVAL;
    }

    /**
     * Statuses the filter menu offers.
     *
     * DRAFT is still valid so old events resolve, but nothing files into it,
     * so offering it next to New Applications would be two ticks for one
     * queue.
     *
     * @return list<string>
     */
    public static function listed(): array
    {
        return array_values(array_filter(
            self::ALL,
            fn (string $status) => $status !== self::DRAFT,
        ));
    }

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? $status;
    }

    /**
     * The uppercase form the notification standard puts in email subjects:
     * "KM - REVIEW APPLICATION - GAL26-00001 - JOHN SMITH (F4) - 13.08.2026".
     */
    public static function subjectLabel(string $status): string
    {
        return self::SUBJECT_LABELS[$status] ?? strtoupper(self::label($status));
    }

    public static function tone(string $status): string
    {
        return self::TONES[$status] ?? 'neutral';
    }
}
