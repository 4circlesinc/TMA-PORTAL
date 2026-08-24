<?php

namespace App\Support\Files;

use App\Models\FileItem;
use Throwable;

/**
 * Moves a document's review on when something happens to it.
 *
 * The point is that staff should not have to keep a status in step by hand.
 * An approval goes out, a reviewer sends it back, each of those already
 * says where the document stands, and asking a person to also go and set a
 * dropdown is asking them to repeat themselves, which they will eventually
 * stop doing. A status nobody maintains is worse than none, because it is
 * believed.
 *
 * Two rules keep it from being annoying:
 *
 *  - it never overrules a person. A document somebody has accepted stays
 *    that way; a comment on finished work is a remark, not a reopening.
 *  - it never moves a document that is not in a review at all, so ordinary
 *    library files are untouched by comment and workflow activity.
 */
final class ReviewAuto
{
    /**
     * Set $to, unless a person has already settled this document.
     *
     * Best-effort: this runs from observers hanging off comments and
     * workflows, and a failure to update a badge must not take down the write
     * that triggered it.
     */
    public static function move(?FileItem $file, string $to): void
    {
        if (! $file) {
            return;
        }

        $to = ReviewStatus::normalize($to) ?? $to;

        // Not in a review, an ordinary library file, which comments and
        // approvals happen to just as often.
        if (! ReviewStatus::isValid($file->review_status)) {
            return;
        }

        if (ReviewStatus::normalize($file->review_status) === $to) {
            return;
        }

        // A human decision stands. reviewed_by is what distinguishes one from
        // a state this class set: automatic moves leave it alone.
        if (in_array(ReviewStatus::normalize($file->review_status), ReviewStatus::FINAL, true)
            && $file->reviewed_by !== null) {
            return;
        }

        try {
            $file->forceFill(['review_status' => $to])->saveQuietly();
        } catch (Throwable) {
            // The comment, or the approval, still happened.
        }
    }

    /**
     * Somebody is discussing the document.
     *
     * Application review already means a reviewer has the file. There is no
     * finer "someone opened it" state in this vocabulary, so a comment does
     * not move the badge, it would only rename the same fact.
     */
    public static function commented(?FileItem $file): void
    {
        // Intentionally empty. See the note above.
    }
}
