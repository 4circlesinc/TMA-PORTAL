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
 * Recording the Unit's decision (§21) — Approved or Denied, and the day it
 * arrived.
 *
 * The generic status endpoint refuses GRANTED and DENIED on purpose: both are
 * terminal, and a bare transition would leave `decision` and `decided_at`
 * null with no way back to fill them. This is the door that writes those
 * columns and then asks {@see Engine} to move the row, so a report measured
 * from the decision date is looking at a date that actually happened.
 *
 * The status change goes through the engine, not around it: the edge is
 * BACKGROUND CHECK / DELAYED → GRANTED or DENIED, it needs `cip.decide`, and
 * it writes the append-only event. Recording an outcome is not a way to skip
 * the lifecycle.
 */
class Decision
{
    /**
     * Record it: the outcome, the date, and the move to Approved or Denied.
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

        return DB::transaction(function () use ($application, $actor, $decision, $decidedAt, $note) {
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

            Engine::apply($application, $decision, $actor, $meta);

            Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $actor, $meta);

            return $application->refresh();
        });
    }
}
