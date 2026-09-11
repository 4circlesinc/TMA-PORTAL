<?php

namespace App\Support\Files;

use App\Models\CipDocument;
use App\Models\CipDocumentComment;
use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Review;
use App\Support\Realtime\Live;
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
 *  - a staff comment *is* the send-back: the document goes to Update required
 *    and the reason is the comment, the same words, so nobody types them twice.
 *    A client or provider writing in the thread is answering, not judging.
 *    A reply is conversation, not a new verdict.
 *  - workflow auto-moves never overrule a person. A document somebody has
 *    accepted stays that way when an approval request later changes state;
 *    a reviewer may still send it back by commenting or by the chip.
 *  - it never moves a document that is not in a review at all, so ordinary
 *    library files are untouched by comment and workflow activity.
 */
final class ReviewAuto
{
    /**
     * True while a comment is being turned into a send-back, so the mirrored
     * comment on the other thread cannot run this a second time.
     */
    private static bool $handling = false;

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
     * A staff comment on a document in review is the update request: status
     * becomes Update required, and the reason is the comment body.
     */
    public static function commented(FileComment $comment): void
    {
        if (self::$handling || $comment->isReply()) {
            return;
        }

        $file = $comment->file;
        $author = $comment->author;
        $reason = trim((string) $comment->body);

        if (! $file || ! $author || $reason === '' || ! Role::isStaff($author)) {
            return;
        }

        if (! ReviewStatus::isValid($file->review_status) && ! $file->cipDocument) {
            return;
        }

        self::sendBack($author, $reason, $file, $file->cipDocument, source: 'file');
    }

    /**
     * The same send-back, from the checklist thread rather than the file.
     */
    public static function documentCommented(CipDocument $document, User $author, CipDocumentComment $comment): void
    {
        if (self::$handling || $comment->isReply()) {
            return;
        }

        $reason = trim((string) $comment->body);

        if ($reason === '' || ! Role::isStaff($author)) {
            return;
        }

        $document->loadMissing('file');

        self::sendBack($author, $reason, $document->file, $document, source: 'slot');
    }

    /**
     * @param  'file'|'slot'  $source  the thread the person actually wrote in
     */
    private static function sendBack(
        User $actor,
        string $reason,
        ?FileItem $file,
        ?CipDocument $slot,
        string $source,
    ): void {
        self::$handling = true;

        try {
            $slot ??= $file?->cipDocument;

            if ($slot) {
                self::sendCipBack($slot, $actor, $reason, $file, $source);

                return;
            }

            if (! $file || ! ReviewStatus::isValid($file->review_status)) {
                return;
            }

            $already = ReviewStatus::normalize($file->review_status) === ReviewStatus::UPDATE_REQUIRED
                && trim((string) $file->review_note) === $reason;

            if ($already) {
                return;
            }

            $file->forceFill([
                'review_status' => ReviewStatus::UPDATE_REQUIRED,
                'review_note' => $reason,
                'reviewed_by' => $actor->id,
                'reviewed_at' => now(),
            ])->save();

            Live::staff(Live::FILES);
            Live::user(Live::FILES, $file->owner_id);
        } catch (Throwable $e) {
            // The comment still happened.
            report($e);
        } finally {
            self::$handling = false;
        }
    }

    /**
     * @param  'file'|'slot'  $source
     */
    private static function sendCipBack(
        CipDocument $slot,
        User $actor,
        string $reason,
        ?FileItem $file,
        string $source,
    ): void {
        $from = $slot->status ?? DocumentStatus::PENDING_UPLOAD;

        if ($from === DocumentStatus::PENDING_UPLOAD) {
            return;
        }

        $file ??= $slot->file;
        $already = $from === DocumentStatus::UPDATE_REQUIRED;
        $noteAlready = $file !== null && trim((string) $file->review_note) === $reason;

        // The chip and request-changes already wrote this comment's verdict.
        // Stamping it again would send a second notice for the same words.
        if ($already && $noteAlready) {
            return;
        }

        $before = (string) $slot->loadMissing('application')->application->status;

        if (! $already) {
            try {
                DocumentEngine::set($slot, DocumentStatus::UPDATE_REQUIRED, $actor, [
                    'reason' => 'changes_requested',
                    'note' => $reason,
                ]);
            } catch (Throwable $e) {
                report($e);

                return;
            }
        }

        if ($file) {
            $file->forceFill([
                'review_status' => DocumentStatus::UPDATE_REQUIRED,
                'review_note' => $reason,
                'reviewed_by' => $actor->id,
                'reviewed_at' => now(),
            ])->save();
        }

        if (! $already) {
            try {
                Review::announceSentBack($slot->fresh(['application']), $actor, $reason, $before);
            } catch (Throwable $e) {
                report($e);
            }
        }

        try {
            if ($source === 'file') {
                DocumentComments::create($slot, $actor, $reason);
            } elseif ($file) {
                Comments::create($file, $actor, $reason);
            }
        } catch (Throwable $e) {
            report($e);
        }

        Live::staff(Live::CIP);
        Live::staff(Live::FILES);
        if ($file) {
            Live::user(Live::FILES, $file->owner_id);
        }
    }
}
