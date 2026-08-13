<?php

namespace App\Support\Cip;

/**
 * The application status vocabulary — the full lifecycle, defined once even
 * though the transitions arrive over several build phases, so dashboards and
 * scope queries never need rework as statuses light up.
 *
 * DRAFT is deliberately part of the enum: an application exists and is
 * editable before it enters the workflow, and a state that is not in the
 * vocabulary cannot have visibility rules. Drafts are visible only to the
 * side that is writing them (the provider firm or the private client) and
 * appear in no officer bucket.
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
        self::DRAFT => 'Draft',
        self::NEW => 'New',
        self::REVIEW_APPLICATION => 'Review application',
        self::ASSESSMENT_FEEDBACK => 'Assessment feedback',
        self::UPDATE_REQUIRED => 'Update required',
        self::READY_TO_SUBMIT => 'Ready to submit',
        self::PENDING_REVIEW => 'Pending review',
        self::NON_COMPLIANT => 'Non-compliant',
        self::BACKGROUND_CHECK => 'Background check',
        self::DELAYED => 'Delayed',
        self::GRANTED => 'Granted',
        self::DENIED => 'Denied',
    ];

    /**
     * The 5-tone chip vocabulary the design system already has — there is no
     * sixth tone to invent.
     */
    private const TONES = [
        self::DRAFT => 'neutral',
        self::NEW => 'action',
        self::REVIEW_APPLICATION => 'action',
        self::ASSESSMENT_FEEDBACK => 'action',
        self::UPDATE_REQUIRED => 'action',
        self::READY_TO_SUBMIT => 'action',
        self::PENDING_REVIEW => 'pending',
        self::NON_COMPLIANT => 'danger',
        self::BACKGROUND_CHECK => 'pending',
        self::DELAYED => 'pending',
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
        return strtoupper(self::label($status));
    }

    public static function tone(string $status): string
    {
        return self::TONES[$status] ?? 'neutral';
    }
}
