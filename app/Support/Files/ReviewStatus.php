<?php

namespace App\Support\Files;

/**
 * The review state of a client document.
 *
 * Deliberately separate from {@see Workflow\Status}, which describes an
 * *approval request* sent to named people. This describes the document itself:
 * a client file starts life needing review whether or not anybody has asked
 * for one, which is a thing no workflow can express because no workflow
 * exists yet at that point.
 *
 * Stored on the file rather than derived. There is nothing to derive it from —
 * "nobody has looked at this yet" is the absence of activity, and absence
 * cannot be told apart from "this file has no review process at all" without
 * recording the difference.
 */
final class ReviewStatus
{
    public const PENDING = 'pending_review';

    public const UNDER_REVIEW = 'under_review';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    /**
     * Set when an approval request goes out, and when one comes back asking
     * for changes. Both are states the document genuinely occupies and neither
     * fitted the four it had: a file out for approval is not "under review" by
     * the person who sent it, and one that came back with changes wanted is
     * not "rejected" — it is expected to return.
     */
    public const AWAITING_APPROVAL = 'awaiting_approval';

    public const CHANGES_REQUESTED = 'changes_requested';

    /** Every state, in the order the process runs. */
    public const ALL = [
        self::PENDING,
        self::UNDER_REVIEW,
        self::AWAITING_APPROVAL,
        self::CHANGES_REQUESTED,
        self::APPROVED,
        self::REJECTED,
    ];

    /**
     * Settled by a person — the review is over, whichever way it went.
     *
     * Automatic moves stop at these. A comment arriving on a document somebody
     * has already approved is a remark about finished work, not a reason to
     * quietly reopen it and lose their decision.
     */
    public const FINAL = [self::APPROVED, self::REJECTED];

    /**
     * Any state may be set from any other.
     *
     * This was a transition table that forbade a few moves — approved and
     * rejected could not go back to pending. The picker lists all four
     * statuses, and an option that is visible but refused is worse than one
     * that is simply absent: the reader has no way to know which of the four
     * are real until one errors.
     *
     * The moves it blocked were legitimate anyway. A reviewer who approves the
     * wrong document, or one who wants a settled file to start over because
     * the client sent a corrected copy, is doing ordinary work — and the
     * history of who changed it to what is recorded either way.
     */
    public static function next(?string $from): array
    {
        return array_values(array_filter(self::ALL, fn (string $s) => $s !== $from));
    }

    public static function label(?string $status): ?string
    {
        return match ($status) {
            self::PENDING => 'Pending review',
            self::UNDER_REVIEW => 'Under review',
            self::AWAITING_APPROVAL => 'Awaiting approval',
            self::CHANGES_REQUESTED => 'Changes requested',
            self::APPROVED => 'Approved',
            self::REJECTED => 'Rejected',
            default => null,
        };
    }

    /**
     * Maps onto the four .tma-portal-status--* tones the portal already has,
     * so a review badge and an approval badge look like the same kind of thing.
     */
    public static function tone(?string $status): string
    {
        return match ($status) {
            self::APPROVED => 'success',
            self::REJECTED, self::CHANGES_REQUESTED => 'danger',
            self::UNDER_REVIEW, self::PENDING, self::AWAITING_APPROVAL => 'pending',
            default => 'neutral',
        };
    }

    public static function isValid(?string $status): bool
    {
        return $status !== null && in_array($status, self::ALL, true);
    }

    public static function canMove(?string $from, string $to): bool
    {
        if (! self::isValid($to)) {
            return false;
        }

        // Only "move it to where it already is" is refused — everything else
        // is a decision somebody is entitled to change.
        return $to !== $from;
    }

    /** @return array{status:string,label:string,tone:string}|null */
    public static function badge(?string $status): ?array
    {
        if (! self::isValid($status)) {
            return null;
        }

        return [
            'status' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ];
    }
}
