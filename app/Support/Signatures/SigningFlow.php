<?php

namespace App\Support\Signatures;

use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;

/**
 * Whose turn it is, and what a request's status should be.
 *
 * Signing is sequential by `signing_order`: everyone sharing the lowest
 * unfinished order acts at the same time, and the next group only becomes
 * reachable once that whole group is done. Holding a link is not enough - the
 * turn is re-checked on every access, so an early recipient can't jump ahead
 * by keeping their email.
 *
 * CC recipients never sign; they are informed, not gating.
 */
class SigningFlow
{
    /** Recipients expected to act (CC are onlookers). */
    public static function actors(SignatureRequest $request): array
    {
        return $request->recipients()->get()
            ->filter(fn (SignatureRecipient $r) => $r->role !== 'cc')
            ->values()
            ->all();
    }

    /** The lowest order that still has someone yet to act, or null if done. */
    public static function currentOrder(SignatureRequest $request): ?int
    {
        $pending = array_filter(
            self::actors($request),
            fn (SignatureRecipient $r) => $r->status !== 'signed',
        );

        if (! $pending) {
            return null;
        }

        return min(array_map(fn (SignatureRecipient $r) => (int) $r->signing_order, $pending));
    }

    /** Everyone who may act right now. */
    public static function currentGroup(SignatureRequest $request): array
    {
        $order = self::currentOrder($request);
        if ($order === null) {
            return [];
        }

        return array_values(array_filter(
            self::actors($request),
            fn (SignatureRecipient $r) => (int) $r->signing_order === $order && $r->status !== 'signed',
        ));
    }

    /** Is it this recipient's turn? */
    public static function isTurn(SignatureRecipient $recipient): bool
    {
        if ($recipient->role === 'cc' || $recipient->status === 'signed') {
            return false;
        }

        $order = self::currentOrder($recipient->request);

        return $order !== null && (int) $recipient->signing_order === $order;
    }

    /** Have all the actors signed? */
    public static function isComplete(SignatureRequest $request): bool
    {
        $actors = self::actors($request);

        // A request with nobody to sign can never complete by signing.
        return $actors !== [] && ! array_filter(
            $actors,
            fn (SignatureRecipient $r) => $r->status !== 'signed',
        );
    }

    /**
     * The status a live request should now be in, derived from its recipients.
     * Terminal states are left alone - a completed or declined request is
     * never recomputed back into flight.
     */
    public static function deriveStatus(SignatureRequest $request): string
    {
        if (in_array($request->status, [Status::DRAFT, ...Status::FINAL], true)) {
            return $request->status;
        }

        if (self::isComplete($request)) {
            return Status::COMPLETED;
        }

        $recipients = $request->recipients()->get();

        if ($recipients->contains(fn (SignatureRecipient $r) => $r->status === 'declined')) {
            return Status::DECLINED;
        }
        if ($recipients->contains(fn (SignatureRecipient $r) => $r->status === 'signed')) {
            return Status::IN_PROGRESS;
        }
        if ($recipients->contains(fn (SignatureRecipient $r) => $r->viewed_at !== null)) {
            return Status::VIEWED;
        }

        return Status::SENT;
    }
}
