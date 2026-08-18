<?php

namespace App\Support\Cip;

/**
 * The application status vocabulary — the full lifecycle, defined once even
 * though the transitions arrive over several build phases, so dashboards and
 * scope queries never need rework as statuses light up.
 *
 * The labels are the same words §9's buckets use, so a row's chip and the
 * queue it sits in cannot disagree. DRAFT remains a leftover code for
 * historical events and any row that has not yet been moved to NEW; nothing
 * is filed into it any more.
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

    public const DELAYED = 'delayed';

    public const GRANTED = 'granted';

    public const DENIED = 'denied';

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
        self::DELAYED,
        self::GRANTED,
        self::DENIED,
    ];

    /** Nothing moves out of a decision. */
    public const TERMINAL = [self::GRANTED, self::DENIED];

    private const LABELS = [
        // Leftover rows and old events wear the same words as NEW, so a chip
        // never still says Draft after the vocabulary moved on.
        self::DRAFT => 'New Applications',
        self::NEW => 'New Applications',
        self::REVIEW_APPLICATION => 'Review Applications',
        self::ASSESSMENT_FEEDBACK => 'Assessment Feedback',
        self::UPDATE_REQUIRED => 'Updates Required',
        self::READY_TO_SUBMIT => 'Ready to Submit',
        self::PENDING_REVIEW => 'Pending Review',
        self::NON_COMPLIANT => 'Non-compliant',
        self::BACKGROUND_CHECK => 'Background Check',
        self::DELAYED => 'Delayed',
        self::GRANTED => 'Approved',
        self::DENIED => 'Denied',
    ];

    /**
     * The status token §22 puts in email subjects — not the chip/bucket label.
     *
     * Chips say Review Applications and Approved; the filing format says
     * REVIEW APPLICATION and GRANTED, matching the brief's worked examples.
     */
    private const SUBJECT_LABELS = [
        self::DRAFT => 'NEW APPLICATION',
        self::NEW => 'NEW APPLICATION',
        self::REVIEW_APPLICATION => 'REVIEW APPLICATION',
        self::ASSESSMENT_FEEDBACK => 'ASSESSMENT FEEDBACK',
        self::UPDATE_REQUIRED => 'UPDATE REQUIRED',
        self::READY_TO_SUBMIT => 'READY TO SUBMIT',
        self::PENDING_REVIEW => 'PENDING REVIEW',
        self::NON_COMPLIANT => 'NON-COMPLIANT',
        self::BACKGROUND_CHECK => 'BACKGROUND CHECK',
        self::DELAYED => 'DELAYED',
        self::GRANTED => 'GRANTED',
        self::DENIED => 'DENIED',
    ];

    /**
     * One colour per listed status, so a filter row, a table chip and a
     * dashboard dot can tell the queues apart without reading the label.
     *
     * The portal's five generic chip tones (action, pending, success, danger,
     * neutral) still colour files and everything else. CIP does not borrow
     * them across eleven different queues — that is how five blues sat next
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
        self::DELAYED => 'copper',
        self::GRANTED => 'success',
        self::DENIED => 'danger',
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
