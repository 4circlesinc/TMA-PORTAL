<?php

namespace App\Support\Cip;

/**
 * The status vocabulary of one document slot (§12).
 *
 * This is not a smaller copy of {@see Status}. An application's status says
 * where the whole file has reached; a slot's says whether this one piece of
 * paper has been accepted, which a reviewer decides a document at a time.
 * The two vocabularies never overlap and never move each other — an
 * application is not in review because a birth certificate is.
 *
 * Nothing here is terminal, which is why there is no TERMINAL list to mirror.
 * Ready for submission ends the review round, not the document: a reviewer who
 * notices something later may send it back for an update right up until the
 * submission package freezes, so every status keeps an outgoing edge.
 */
class DocumentStatus
{
    /** The slot exists and nothing has been uploaded against it yet. */
    public const PENDING_UPLOAD = 'pending_upload';

    public const APPLICATION_REVIEW = 'application_review';

    public const UPDATE_REQUIRED = 'update_required';

    public const READY_FOR_SUBMISSION = 'ready_for_submission';

    public const ALL = [
        self::PENDING_UPLOAD,
        self::APPLICATION_REVIEW,
        self::UPDATE_REQUIRED,
        self::READY_FOR_SUBMISSION,
    ];

    private const LABELS = [
        self::PENDING_UPLOAD => 'Pending upload',
        self::APPLICATION_REVIEW => 'Application review',
        self::UPDATE_REQUIRED => 'Update required',
        self::READY_FOR_SUBMISSION => 'Ready for submission',
    ];

    /**
     * The same 5-tone chip vocabulary the design system already has.
     *
     * Pending upload is neutral rather than a warning: a checklist opens with
     * every slot empty, and a screen of red on the day an application is
     * created would tell a reviewer nothing about what is actually late.
     */
    private const TONES = [
        self::PENDING_UPLOAD => 'neutral',
        self::APPLICATION_REVIEW => 'pending',
        self::UPDATE_REQUIRED => 'danger',
        self::READY_FOR_SUBMISSION => 'success',
    ];

    public static function isValid(string $status): bool
    {
        return in_array($status, self::ALL, true);
    }

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? $status;
    }

    public static function tone(string $status): string
    {
        return self::TONES[$status] ?? 'neutral';
    }
}
