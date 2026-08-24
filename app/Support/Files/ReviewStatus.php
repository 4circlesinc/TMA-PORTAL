<?php

namespace App\Support\Files;

use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;

/**
 * The review state of a client document.
 *
 * The same four-status vocabulary as {@see DocumentStatus}: a client file
 * and a CIP checklist slot are the same kind of document, and a reviewer
 * looking at one in the File Library, the Documents tab, or a person tab
 * must read the same words. Pending upload stays off this list, it is a
 * slot with no file, and a row in the library is a file.
 *
 * Stored on the file rather than derived. There is nothing to derive it from
 * for an ordinary client upload that is not a CIP slot, "nobody has looked
 * at this yet" is the absence of activity, and absence cannot be told apart
 * from "this file has no review process at all" without recording the
 * difference. CIP slots keep their own copy on `cip_documents.status`; the
 * engine writes both so a listing that has not joined the slot still reads
 * the same answer.
 *
 * Deliberately separate from {@see Workflow\Status}, which describes an
 * *approval request* sent to named people. This describes the document itself.
 */
final class ReviewStatus
{
    public const APPLICATION_REVIEW = DocumentStatus::APPLICATION_REVIEW;

    public const UPDATE_REQUIRED = DocumentStatus::UPDATE_REQUIRED;

    public const READY_FOR_SUBMISSION = DocumentStatus::READY_FOR_SUBMISSION;

    /**
     * What a client document starts as, an upload waiting to be judged.
     *
     * Alias of {@see self::APPLICATION_REVIEW}. Kept so callers that mean
     * "the opening state" do not have to say the longer name.
     */
    public const PENDING = self::APPLICATION_REVIEW;

    /** Every file-level state, in the order the process runs. */
    public const ALL = [
        self::APPLICATION_REVIEW,
        self::UPDATE_REQUIRED,
        self::READY_FOR_SUBMISSION,
    ];

    /**
     * Settled by a person, the review round is over, whichever way it went.
     *
     * Automatic moves stop at these. A comment arriving on a document somebody
     * has already accepted is a remark about finished work, not a reason to
     * quietly reopen it and lose their decision. A reviewer may still send it
     * back by hand; that is a verdict, not an automatic move.
     */
    public const FINAL = [self::READY_FOR_SUBMISSION];

    /**
     * Values this column used to store, before client documents shared §12's
     * vocabulary. A listing that has not been migrated yet still has to draw
     * a badge, so these are read as the status they became.
     *
     * @var array<string, string>
     */
    private const LEGACY = [
        'pending_review' => self::APPLICATION_REVIEW,
        'under_review' => self::APPLICATION_REVIEW,
        'awaiting_approval' => self::APPLICATION_REVIEW,
        'changes_requested' => self::UPDATE_REQUIRED,
        'rejected' => self::UPDATE_REQUIRED,
        'approved' => self::READY_FOR_SUBMISSION,
    ];

    /**
     * Any file-level state may be set from any other, for documents that are
     * not CIP slots. CIP slots travel {@see DocumentEngine}'s
     * edges instead, this table is the library's, and a reviewer who wants a
     * settled extra file to start over is doing ordinary work.
     *
     * Only "move it to where it already is" is refused.
     */
    public static function next(?string $from): array
    {
        $from = self::normalize($from);

        return array_values(array_filter(self::ALL, fn (string $s) => $s !== $from));
    }

    public static function label(?string $status): ?string
    {
        $status = self::normalize($status);

        return $status ? DocumentStatus::label($status) : null;
    }

    /**
     * Maps onto the four .tma-portal-status--* tones the portal already has,
     * so a review badge and an approval badge look like the same kind of thing.
     */
    public static function tone(?string $status): string
    {
        $status = self::normalize($status);

        return $status ? DocumentStatus::tone($status) : 'neutral';
    }

    public static function isValid(?string $status): bool
    {
        return self::normalize($status) !== null;
    }

    public static function canMove(?string $from, string $to): bool
    {
        $to = self::normalize($to);
        $from = self::normalize($from);

        if ($to === null) {
            return false;
        }

        return $to !== $from;
    }

    /**
     * The vocabulary value a stored string means.
     *
     * Unknown values stay unknown, a workflow status that leaked onto this
     * column is not a client-document state, and pretending it is would draw
     * the wrong badge.
     */
    public static function normalize(?string $status): ?string
    {
        if ($status === null) {
            return null;
        }

        if (in_array($status, self::ALL, true)) {
            return $status;
        }

        return self::LEGACY[$status] ?? null;
    }

    /** @return array{status:string,label:string,tone:string}|null */
    public static function badge(?string $status): ?array
    {
        $status = self::normalize($status);

        return $status ? DocumentStatus::badge($status) : null;
    }
}
