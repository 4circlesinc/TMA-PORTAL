<?php

namespace App\Support\Signatures;

/**
 * The signature-request status vocabulary and the rules about which states
 * still accept action. Statuses are stored lower-case; the UI label is derived
 * here so the wire format and the badge can never drift apart.
 */
class Status
{
    public const DRAFT = 'draft';

    public const SENT = 'sent';

    public const VIEWED = 'viewed';

    public const IN_PROGRESS = 'in_progress';

    public const COMPLETED = 'completed';

    public const DECLINED = 'declined';

    public const CANCELLED = 'cancelled';

    public const EXPIRED = 'expired';

    public const ALL = [
        self::DRAFT, self::SENT, self::VIEWED, self::IN_PROGRESS,
        self::COMPLETED, self::DECLINED, self::CANCELLED, self::EXPIRED,
    ];

    /** Out with recipients and still awaiting action. */
    public const PENDING = [self::SENT, self::VIEWED, self::IN_PROGRESS];

    /** Terminal - the document must never change again. */
    public const FINAL = [self::COMPLETED, self::DECLINED, self::CANCELLED, self::EXPIRED];

    private const LABELS = [
        self::DRAFT => 'Draft',
        self::SENT => 'Sent',
        self::VIEWED => 'Viewed',
        self::IN_PROGRESS => 'In Progress',
        self::COMPLETED => 'Completed',
        self::DECLINED => 'Declined',
        self::CANCELLED => 'Cancelled',
        self::EXPIRED => 'Expired',
    ];

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? ucfirst($status);
    }

    public static function isValid(string $status): bool
    {
        return in_array($status, self::ALL, true);
    }

    /** A draft is the only thing a user may hard-delete. */
    public static function isDeletable(string $status): bool
    {
        return $status === self::DRAFT;
    }

    /** Only an in-flight request can be called back. */
    public static function isCancellable(string $status): bool
    {
        return in_array($status, self::PENDING, true);
    }
}
