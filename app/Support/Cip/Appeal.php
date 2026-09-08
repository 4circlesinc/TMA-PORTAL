<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Appealing a decision.
 *
 * A decision is not always the end of a file. The applicant, the provider
 * side or the firm may disagree with what the Unit decided, and the appeal
 * that follows is its own small lifecycle running after GRANTED or DENIED:
 *
 *   New appeal  →  Appeal ready  →  Appeal submitted  →  Approved / Denied
 *
 * It mirrors the shape of the main flow deliberately, because it is the same
 * work done twice: something is lodged, the provider side confirms it is
 * ready, staff send it, the Unit answers. The outcome reuses the existing
 * Approved and Denied rather than a won/lost pair of its own — what a reader
 * asks of a file is what the outcome IS, and a second vocabulary for it would
 * mean every filter, chip and report had to learn two ways of being approved.
 *
 * Two of the three steps carry a date, for the reason every other CIP date is
 * asked for rather than assumed: they are external events with paper behind
 * them, and staff record them after the fact as often as on the day. Appeal
 * ready is the exception — it is an internal readiness flag, and the event
 * log already carries when it was set.
 *
 * While the file is in this lane the ONLY drawer open to uploads is Appeal
 * Documents ({@see Tree::APPEAL}). The original package was frozen long ago
 * and the Additional Documents drawers answer the Unit's queries on the first
 * decision; an appeal answers the decision itself, so its paper is kept
 * apart, and {@see Confirmation::guardAppeal()} is what holds that line.
 */
class Appeal
{
    /**
     * May this account ask the firm to appeal, and is there anything to ask?
     *
     * The submitting party's own decided file, and only while no request is
     * already open — a second press is the same request, not a queue. Staff
     * are excluded on purpose: they do not ask, they lodge.
     */
    public static function canRequest(?User $user, ?CipApplication $application): bool
    {
        if ($user === null || $application === null || ! CipAccess::enabled()) {
            return false;
        }

        if (! Confirmation::isSubmittingParty($user, $application)) {
            return false;
        }

        return $application->appeal_requested_at === null
            && in_array($application->status, Status::TERMINAL, true);
    }

    /**
     * The provider side asking the firm to appeal a decision.
     *
     * This does NOT move the file, and that is the whole point of it. §22
     * keeps the lifecycle with the firm — a service provider may create, edit
     * and upload, but an application's status is not theirs to change — so the
     * button on their side records the ask and tells the firm, and an officer
     * lodges it. The same split Confirm submission already makes: the provider
     * freezes their package, the firm records the submission.
     *
     * Idempotent: pressing it twice is the one request they already made.
     *
     * @throws \InvalidArgumentException the file has no decision to appeal
     * @throws AuthorizationException
     */
    public static function request(
        CipApplication $application,
        User $actor,
        ?string $reason = null,
    ): CipApplication {
        if (! Confirmation::isSubmittingParty($actor, $application)) {
            throw new AuthorizationException('You cannot ask for an appeal on this application.');
        }

        if (! in_array($application->status, Status::TERMINAL, true)) {
            throw new \InvalidArgumentException(
                'An appeal can only be asked for once the Unit has decided.',
            );
        }

        if ($application->appeal_requested_at !== null) {
            return $application;
        }

        $reason = trim((string) $reason) ?: null;

        return DB::transaction(function () use ($application, $actor, $reason) {
            $application->forceFill([
                'appeal_requested_at' => Carbon::now(),
                'appeal_requested_by' => $actor->id,
                'appeal_request_reason' => $reason,
            ])->save();

            Engine::record($application, CipEvent::ACTION_APPEAL_REQUESTED, $actor, array_filter([
                'reason' => $reason,
            ]));

            // Their words go in the thread the same way a covering note does,
            // so the firm reads the ask where they read everything else about
            // this file. Notices::appealRequested carries the letter.
            Threads::record($application, $actor, $reason);
            Notices::appealRequested($application, $actor, $reason);

            return $application->refresh();
        });
    }

    /**
     * Lodge an appeal: the day it was made, and the move to New appeal.
     *
     * Idempotent when the file already stands in the lane: a second press
     * updates the date rather than announcing a second appeal.
     *
     * @throws \InvalidArgumentException the file has no decision to appeal
     * @throws AuthorizationException
     */
    public static function lodge(
        CipApplication $application,
        User $actor,
        ?Carbon $lodgedAt = null,
        bool $override = false,
        ?string $note = null,
        ?string $message = null,
    ): CipApplication {
        $lodgedAt ??= Carbon::now();
        $already = in_array($application->status, Status::APPEAL_LANE, true);
        $edge = $already || Engine::canTransition($application, Status::NEW_APPEAL);

        /*
         * The same door NonCompliance::record opens: off the map, an
         * administrator who typed the confirmation may drive it through
         * Engine::set; everyone else keeps the explanation.
         */
        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'An appeal can only be lodged against an application the Unit has decided.',
            );
        }

        $message = trim((string) $message) ?: null;

        return DB::transaction(function () use ($application, $actor, $lodgedAt, $already, $edge, $note, $message) {
            // The drawer exists before anybody is told to upload into it.
            Tree::provisionAppeal($application, $actor);
            $application->refresh();

            $application->forceFill(['appeal_lodged_at' => $lodgedAt])->save();

            $meta = ['appealLodgedAt' => $lodgedAt->toDateString()];
            $notice = $message !== null ? ['message' => $message] : [];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::NEW_APPEAL, $actor, $meta + $notice);
                } else {
                    Engine::set($application, Status::NEW_APPEAL, $actor, $meta + $notice + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_APPEAL_LODGED, $actor, $meta);

            // An open request has been answered by the thing it asked for.
            // Cleared here rather than left standing, or the provider's file
            // would go on saying "appeal requested" through the whole appeal.
            if ($application->appeal_requested_at !== null) {
                $application->forceFill([
                    'appeal_requested_at' => null,
                    'appeal_requested_by' => null,
                    'appeal_request_reason' => null,
                ])->save();
            }

            // The covering note is also the firm talking to the provider side
            // about this file, so it belongs in the thread. Recorded, not
            // announced: the status notice above already carries it.
            Threads::record($application, $actor, $message);

            return $application->refresh();
        });
    }

    /**
     * Declare the appeal ready, which asks the provider side to confirm.
     *
     * No date. This is the firm saying the papers are together, and the
     * notice that goes out is a question, not a record — the answer is the
     * provider side confirming, and that arrives as the next step.
     *
     * @throws \InvalidArgumentException
     * @throws AuthorizationException
     */
    public static function ready(
        CipApplication $application,
        User $actor,
        bool $override = false,
        ?string $note = null,
        ?string $message = null,
    ): CipApplication {
        $already = $application->status === Status::APPEAL_READY;
        $edge = $already || Engine::canTransition($application, Status::APPEAL_READY);

        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'An appeal can only be made ready once it has been lodged.',
            );
        }

        $message = trim((string) $message) ?: null;

        return DB::transaction(function () use ($application, $actor, $already, $edge, $note, $message) {
            $notice = $message !== null ? ['message' => $message] : [];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::APPEAL_READY, $actor, $notice);
                } else {
                    Engine::set($application, Status::APPEAL_READY, $actor, $notice + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_APPEAL_READY, $actor, []);

            // The covering note is also the firm talking to the provider side
            // about this file, so it belongs in the thread. Recorded, not
            // announced: the status notice above already carries it.
            Threads::record($application, $actor, $message);

            return $application->refresh();
        });
    }

    /**
     * Record the appeal as submitted: the day it went, and the move.
     *
     * @throws \InvalidArgumentException
     * @throws AuthorizationException
     */
    public static function submit(
        CipApplication $application,
        User $actor,
        ?Carbon $submittedAt = null,
        bool $override = false,
        ?string $note = null,
        ?string $message = null,
    ): CipApplication {
        $submittedAt ??= Carbon::now();
        $already = $application->status === Status::APPEAL_SUBMITTED;
        $edge = $already || Engine::canTransition($application, Status::APPEAL_SUBMITTED);

        if (! $edge && ! $override) {
            throw new \InvalidArgumentException(
                'An appeal can only be submitted once the provider side has confirmed it is ready.',
            );
        }

        $message = trim((string) $message) ?: null;

        return DB::transaction(function () use ($application, $actor, $submittedAt, $already, $edge, $note, $message) {
            $application->forceFill(['appeal_submitted_at' => $submittedAt])->save();

            $meta = ['appealSubmittedAt' => $submittedAt->toDateString()];
            $notice = $message !== null ? ['message' => $message] : [];

            if (! $already) {
                if ($edge) {
                    Engine::apply($application, Status::APPEAL_SUBMITTED, $actor, $meta + $notice);
                } else {
                    Engine::set($application, Status::APPEAL_SUBMITTED, $actor, $meta + $notice + ['note' => (string) $note]);
                }
            }

            Engine::record($application, CipEvent::ACTION_APPEAL_SUBMITTED, $actor, $meta);

            // The covering note is also the firm talking to the provider side
            // about this file, so it belongs in the thread. Recorded, not
            // announced: the status notice above already carries it.
            Threads::record($application, $actor, $message);

            return $application->refresh();
        });
    }

    /**
     * What a screen needs to draw the appeal verbs.
     *
     * Two audiences, one shape: the provider side gets `canRequestAppeal` and
     * presses it; the firm gets the standing request and acts on it. Both
     * read the same row, so neither can be told something the other's screen
     * would contradict.
     *
     * @return array{canRequestAppeal:bool, appealRequested:?array{at:string, by:?string, reason:?string}}
     */
    public static function payload(CipApplication $application, ?User $viewer): array
    {
        $requested = $application->appeal_requested_at;

        return [
            'canRequestAppeal' => self::canRequest($viewer, $application),
            'appealRequested' => $requested === null ? null : [
                'at' => $requested->toIso8601String(),
                'by' => $application->appealRequestedBy?->name,
                'reason' => $application->appeal_request_reason,
            ],
        ];
    }

    /** Is this file in the appeal lane right now? */
    public static function inLane(?CipApplication $application): bool
    {
        return $application !== null
            && in_array($application->status, Status::APPEAL_LANE, true);
    }
}
