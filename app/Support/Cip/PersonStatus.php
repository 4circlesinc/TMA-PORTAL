<?php

namespace App\Support\Cip;

use App\Models\CipPerson;

/**
 * Post-approval workflow status for one person on an application.
 *
 * Separate from {@see Status}, which describes the whole file through
 * pre-approval and ends at Granted/Denied. After approval each family
 * member has their own lane here.
 *
 * The vocabulary is intentionally small for now; administrators may set
 * any listed value directly (see spec §7). A transition map can tighten
 * employee choices once the final status list is confirmed.
 */
class PersonStatus
{
    public const NOT_STARTED = 'not_started';

    public const DOCUMENTS_PENDING = 'documents_pending';

    public const DOCUMENTS_IN_REVIEW = 'documents_in_review';

    public const UPDATE_REQUIRED = 'update_required';

    public const READY_FOR_SUBMISSION = 'ready_for_submission';

    public const PROCESSING = 'processing';

    public const COMPLETED = 'completed';

    public const ALL = [
        self::NOT_STARTED,
        self::DOCUMENTS_PENDING,
        self::DOCUMENTS_IN_REVIEW,
        self::UPDATE_REQUIRED,
        self::READY_FOR_SUBMISSION,
        self::PROCESSING,
        self::COMPLETED,
    ];

    private const LABELS = [
        self::NOT_STARTED => 'Not started',
        self::DOCUMENTS_PENDING => 'Documents pending',
        self::DOCUMENTS_IN_REVIEW => 'Documents in review',
        self::UPDATE_REQUIRED => 'Update required',
        self::READY_FOR_SUBMISSION => 'Ready for submission',
        self::PROCESSING => 'Processing',
        self::COMPLETED => 'Completed',
    ];

    private const TONES = [
        self::NOT_STARTED => 'neutral',
        self::DOCUMENTS_PENDING => 'neutral',
        self::DOCUMENTS_IN_REVIEW => 'pending',
        self::UPDATE_REQUIRED => 'danger',
        self::READY_FOR_SUBMISSION => 'teal',
        self::PROCESSING => 'indigo',
        self::COMPLETED => 'success',
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

    /** @return array{status:string,label:string,tone:string} */
    public static function badge(string $status): array
    {
        return [
            'status' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ];
    }

    /**
     * The chip one person wears in post-approval.
     *
     * @return array{status:string,statusLabel:string,statusTone:string}
     */
    public static function forPerson(CipPerson $person): array
    {
        $stored = $person->post_approval_status;
        $status = ($stored !== null && self::isValid($stored))
            ? $stored
            : self::NOT_STARTED;

        $badge = self::badge($status);

        return [
            'status' => $badge['status'],
            'statusLabel' => $badge['label'],
            'statusTone' => $badge['tone'],
        ];
    }

    /**
     * Every status the picker may offer.
     *
     * @return list<array{value:string,label:string,tone:string}>
     */
    public static function listed(): array
    {
        return array_map(fn (string $status) => [
            'value' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ], self::ALL);
    }
}
