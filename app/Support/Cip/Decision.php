<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Recording the Unit's decision (§21), the Decision date, Granted or Denied,
 * and the automatic move to that terminal status.
 *
 * The generic status endpoint refuses GRANTED and DENIED on purpose: both are
 * terminal, and a bare transition would leave `decision` and `decided_at`
 * null with no way back to fill them. This is the door that writes those
 * columns and then asks {@see Engine} to move the row, so a report measured
 * from the decision date is looking at a date that actually happened.
 *
 * The status change goes through the engine, not around it: permission is
 * still `cip.decide`, and the outcome and its date are written before the
 * row moves. A decision lands from Background check or Delayed, the two
 * edges the map allows, not from earlier in the lifecycle.
 */
class Decision
{
    /**
     * Record it: the outcome, the date, and the move to Approved or Denied.
     *
     * Idempotent when the file already stands at this outcome: a second press
     * updates the date rather than sending a second notice for the same
     * decision. Flipping Approved to Denied (or the other way) is refused —
     * the UI says this cannot be undone from here.
     *
     * @throws ValidationException the outcome is not a decision this module recognises
     * @throws \InvalidArgumentException the application is not ready to be decided
     * @throws AuthorizationException
     */
    public static function record(
        CipApplication $application,
        User $actor,
        string $decision,
        ?Carbon $decidedAt = null,
        string $note = '',
    ): CipApplication {
        if (! Status::isTerminal($decision)) {
            throw ValidationException::withMessages([
                'decision' => 'A decision is Approved or Denied.',
            ]);
        }

        $decidedAt ??= Carbon::now();
        $note = trim($note);
        $already = $application->status === $decision;

        if ($already) {
            // Same outcome again: the date can move. The other outcome cannot
            // overwrite this one through this door.
        } elseif (Status::isTerminal($application->status)) {
            throw new \InvalidArgumentException(
                'This application has already been decided.',
            );
        } elseif (! Engine::canTransition($application, $decision)) {
            throw new \InvalidArgumentException(
                'A decision can only be recorded on an application in Background check or Delayed.',
            );
        }

        $application = DB::transaction(function () use ($application, $actor, $decision, $decidedAt, $note, $already) {
            /*
             * Written before the transition, so the trail and the milestone
             * both name what was decided on the day it was. A status change
             * that landed first would leave the Overview card still asking
             * "Decision" for a file whose chip already said Approved.
             */
            $application->forceFill([
                'decision' => $decision,
                'decided_at' => $decidedAt,
            ])->save();

            $meta = [
                'decision' => $decision,
                'decidedAt' => $decidedAt->toDateString(),
            ];
            if ($note !== '') {
                $meta['note'] = $note;
            }

            if (! $already) {
                Engine::apply($application, $decision, $actor, $meta);
            }

            Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $actor, $meta);

            return $application->refresh();
        });

        return $application;
    }
}
