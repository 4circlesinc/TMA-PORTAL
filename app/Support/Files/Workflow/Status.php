<?php

namespace App\Support\Files\Workflow;

/**
 * Every state a file workflow can be in, and how each one reads to a person.
 *
 * The set is a superset of the one in the spec: feedback, review and
 * acknowledgement need a success state that is not "Approved", because saying a
 * document was *approved* when people were only asked to read it would be a
 * false record.
 */
final class Status
{
    public const DRAFT = 'draft';
    public const FEEDBACK_REQUESTED = 'feedback_requested';
    public const UNDER_REVIEW = 'under_review';
    public const AWAITING_APPROVAL = 'awaiting_approval';
    public const AWAITING_ACKNOWLEDGEMENT = 'awaiting_acknowledgement';
    public const AWAITING_SIGNATURE = 'awaiting_signature';
    public const PARTIALLY_SIGNED = 'partially_signed';

    public const CHANGES_REQUESTED = 'changes_requested';
    public const APPROVED = 'approved';
    public const DECLINED = 'declined';
    public const SIGNED = 'signed';
    public const ACKNOWLEDGED = 'acknowledged';
    public const COMPLETED = 'completed';
    public const CANCELLED = 'cancelled';
    public const EXPIRED = 'expired';

    public const TYPE_FEEDBACK = 'feedback';
    public const TYPE_REVIEW = 'review';
    public const TYPE_APPROVAL = 'approval';
    public const TYPE_ACKNOWLEDGEMENT = 'acknowledgement';
    public const TYPE_SIGNATURE = 'signature';

    public const TYPES = [
        self::TYPE_FEEDBACK,
        self::TYPE_REVIEW,
        self::TYPE_APPROVAL,
        self::TYPE_ACKNOWLEDGEMENT,
        self::TYPE_SIGNATURE,
    ];

    /** Nothing further can happen to a workflow in one of these. */
    public const TERMINAL = [
        self::CHANGES_REQUESTED,
        self::APPROVED,
        self::DECLINED,
        self::SIGNED,
        self::ACKNOWLEDGED,
        self::COMPLETED,
        self::CANCELLED,
        self::EXPIRED,
    ];

    /** The state a workflow of this type enters when it is sent. */
    public static function openStatusFor(string $type): string
    {
        return match ($type) {
            self::TYPE_FEEDBACK => self::FEEDBACK_REQUESTED,
            self::TYPE_REVIEW => self::UNDER_REVIEW,
            self::TYPE_APPROVAL => self::AWAITING_APPROVAL,
            self::TYPE_ACKNOWLEDGEMENT => self::AWAITING_ACKNOWLEDGEMENT,
            self::TYPE_SIGNATURE => self::AWAITING_SIGNATURE,
            default => self::UNDER_REVIEW,
        };
    }

    /** The state reached when everyone has responded favourably. */
    public static function successStatusFor(string $type): string
    {
        return match ($type) {
            self::TYPE_APPROVAL => self::APPROVED,
            self::TYPE_ACKNOWLEDGEMENT => self::ACKNOWLEDGED,
            self::TYPE_SIGNATURE => self::SIGNED,
            default => self::COMPLETED,
        };
    }

    /** The participant role a type asks of its recipients. */
    public static function roleFor(string $type): string
    {
        return match ($type) {
            self::TYPE_APPROVAL => 'approver',
            self::TYPE_SIGNATURE => 'signer',
            self::TYPE_ACKNOWLEDGEMENT => 'acknowledger',
            default => 'reviewer',
        };
    }

    public static function isTerminal(string $status): bool
    {
        return in_array($status, self::TERMINAL, true);
    }

    /** Human label — also what the badges show. */
    public static function label(string $status): string
    {
        return match ($status) {
            self::DRAFT => 'Draft',
            self::FEEDBACK_REQUESTED => 'Feedback requested',
            self::UNDER_REVIEW => 'Under review',
            self::AWAITING_APPROVAL => 'Awaiting approval',
            self::AWAITING_ACKNOWLEDGEMENT => 'Awaiting acknowledgement',
            self::AWAITING_SIGNATURE => 'Awaiting signature',
            self::PARTIALLY_SIGNED => 'Partially signed',
            self::CHANGES_REQUESTED => 'Changes requested',
            self::APPROVED => 'Approved',
            self::DECLINED => 'Declined',
            self::SIGNED => 'Signed',
            self::ACKNOWLEDGED => 'Acknowledged',
            self::COMPLETED => 'Completed',
            self::CANCELLED => 'Cancelled',
            self::EXPIRED => 'Expired',
            default => ucfirst(str_replace('_', ' ', $status)),
        };
    }

    /**
     * Badge tone. Reuses the portal's existing semantic vocabulary rather than
     * introducing bespoke colours for this feature.
     */
    public static function tone(string $status): string
    {
        return match ($status) {
            self::APPROVED, self::SIGNED, self::ACKNOWLEDGED, self::COMPLETED => 'success',
            self::DECLINED, self::CHANGES_REQUESTED, self::EXPIRED => 'danger',
            self::AWAITING_APPROVAL, self::AWAITING_SIGNATURE, self::AWAITING_ACKNOWLEDGEMENT,
            self::PARTIALLY_SIGNED, self::FEEDBACK_REQUESTED, self::UNDER_REVIEW => 'pending',
            default => 'neutral',
        };
    }

    /** What a participant may do, given the workflow type. */
    public static function actionsFor(string $type): array
    {
        return match ($type) {
            self::TYPE_APPROVAL => ['approve', 'decline', 'request_changes'],
            self::TYPE_ACKNOWLEDGEMENT => ['acknowledge'],
            self::TYPE_SIGNATURE => ['sign', 'decline'],
            default => ['submit_feedback', 'request_changes'],
        };
    }
}
