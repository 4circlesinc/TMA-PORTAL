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

            return $application->refresh();
        });
    }

    /** Is this file in the appeal lane right now? */
    public static function inLane(?CipApplication $application): bool
    {
        return $application !== null
            && in_array($application->status, Status::APPEAL_LANE, true);
    }
}
