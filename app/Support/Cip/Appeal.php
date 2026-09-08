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
     * May this external account lodge an appeal on this file itself?
     *
     * The carve-out {@see Engine::allows} reads. Deliberately the narrowest
     * question that answers the need: the party that filed this application,
     * on a file the Unit has decided. Not staff (they hold the verb through
     * the ordinary capability), not another firm's contact, and not a file
     * still in flight.
     */
    public static function mayLodge(?User $user, ?CipApplication $application): bool
    {
        if ($user === null || $application === null || ! CipAccess::enabled()) {
            return false;
        }

        return Confirmation::isSubmittingParty($user, $application)
            && in_array($application->status, Status::TERMINAL, true);
    }

    /**
     * May this account start an appeal from the button on their own file?
     *
     * The provider side's version of the verb. Staff are excluded because
     * their route in is the status picker, which already offers New Appeal.
     */
    public static function canRequest(?User $user, ?CipApplication $application): bool
    {
        return self::mayLodge($user, $application);
    }

    /**
     * The provider side starting an appeal on their own file.
     *
     * It lodges: the status moves to New Appeal, Appeal Documents opens, and
     * the section 22 list is told, exactly as if an officer had done it. The firm
     * used to have to lodge it for them, which put a queue in front of the
     * one action that is entirely the provider's — they are the party that
     * disagrees with the decision.
     *
     * The lifecycle is otherwise unchanged: every later step of the appeal
     * (Ready, Submitted, and the outcome) is still the firm's, and this is
     * the only edge {@see Engine::allows} opens to an external account.
     *
     * The columns are still written, because "who asked, and why" is a fact
     * about the appeal that the lodging alone does not carry. Idempotent: a
     * second press on a file already in the lane is the appeal they started.
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
            throw new AuthorizationException('You cannot appeal this application.');
        }

        if (in_array($application->status, Status::APPEAL_LANE, true)) {
            return $application;
        }

        if (! in_array($application->status, Status::TERMINAL, true)) {
            throw new \InvalidArgumentException(
                'An appeal can only be started once the Unit has decided.',
            );
        }

        $reason = trim((string) $reason) ?: null;

        $application->forceFill([
            'appeal_requested_at' => Carbon::now(),
            'appeal_requested_by' => $actor->id,
            'appeal_request_reason' => $reason,
        ])->save();

        Engine::record($application, CipEvent::ACTION_APPEAL_REQUESTED, $actor, array_filter([
            'reason' => $reason,
        ]));

        /*
         * Then the ordinary lodging, so the provider's appeal and an
         * officer's are the same appeal: same date, same drawer, same notice.
         * Their reason rides along as the covering message, which puts it in
         * the letter and the thread the way every other one goes.
         */
        return self::lodge($application->refresh(), $actor, null, false, null, $reason);
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

            /*
             * The request columns are NOT cleared. They stopped meaning "a
             * pending ask" the moment the provider's press began lodging the
             * appeal itself, and now mean who started it and why — which is
             * worth keeping for the life of the appeal. Screens read the
             * status for the lane and these for the attribution.
             */

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
     * `canRequestAppeal` offers the button to the party that may press it.
     * `appealStartedBy` says who started the appeal this file is in, which is
     * the firm's answer to "why is this here" and is worth carrying for the
     * life of the lane.
     *
     * @return array{canRequestAppeal:bool, appealStartedBy:?array{at:string, by:?string, reason:?string}}
     */
    public static function payload(CipApplication $application, ?User $viewer): array
    {
        $requested = $application->appeal_requested_at;

        return [
            'canRequestAppeal' => self::canRequest($viewer, $application),
            'appealStartedBy' => $requested === null ? null : [
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
