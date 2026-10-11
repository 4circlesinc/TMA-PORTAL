<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Recording the Unit's decision (section 21), the Decision date, Granted or Denied,
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
 * row moves. A pre-approval decision lands from Background check, DD Query
 * or Delayed; an Add-On decision lands from Pending review or Non-compliant;
 * post-approval uses its own pair at the start of that lane.
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
        ?UploadedFile $letter = null,
        bool $override = false,
    ): CipApplication {
        if (! Status::isOutcome($decision)) {
            throw ValidationException::withMessages([
                'decision' => 'A decision is Approved or Denied.',
            ]);
        }

        /*
         * Each lane decides with its own pair.
         *
         * A post-approval file records POST_APPROVED / POST_DENIED, which are
         * reachable from where its work ends; a pre-approval one records
         * GRANTED / DENIED from Background check, DD Query or Delayed. Sending the
         * other lane's outcome here is what produced "a decision can only be
         * recorded on an application in Background check, DD Query or Delayed" on a
         * file that had never been near Background check.
         */
        $phase = $application->phase ?? Phase::PRE_APPROVAL;
        [$approved, $denied] = Status::outcomesFor($phase);

        if (! in_array($decision, [$approved, $denied], true)) {
            $decision = $decision === Status::GRANTED || $decision === Status::POST_APPROVED
                ? $approved
                : $denied;
        }

        $decidedAt ??= Carbon::now();
        $note = trim($note);
        $already = $application->status === $decision;

        /*
         * The lane's approval is already on the row, and the file has only
         * been walked on from Approved by its own checklist.
         *
         * Recording Approved on a file whose papers are all in takes it
         * straight to Apply for COR (see the end of this method), so the
         * status no longer says Approved a moment later. A second press, a
         * lost response and the button pressed again, would otherwise find
         * the edge back to Approved open and record the whole decision
         * twice: a second letter, a second notice to everybody. It is the
         * same outcome again, and is treated as one.
         */
        if (! $already
            && $decision === Status::POST_APPROVED
            && $application->decision === Status::POST_APPROVED
            && in_array($application->status, [Status::APPLY_FOR_COR, Status::UPDATE_REQUIRED], true)
            && Pack::current($application) === Pack::COR) {
            $already = true;
        }

        if ($already) {
            // Same outcome again: the date can move. The other outcome cannot
            // overwrite this one through this door.
        } elseif (Status::isOutcomeOf($application->status, $phase)) {
            throw new \InvalidArgumentException(
                'This application has already been decided.',
            );
        } elseif (! Engine::canTransition($application, $decision) && ! $override) {
            throw new \InvalidArgumentException(
                match ($phase) {
                    Phase::POST_APPROVAL => 'A post-approval decision is recorded when the file enters the lane, before the COR stage begins.',
                    Phase::ADD_ON => 'A decision can only be recorded on an Add-On in Pending review or Non-compliant.',
                    default => 'A decision can only be recorded on an application in Background check, DD Query or Delayed.',
                },
            );
        }

        $application = DB::transaction(function () use ($application, $actor, $decision, $decidedAt, $note, $already, $letter, $override) {
            if ($letter !== null) {
                DecisionLetter::store($application, $letter, $actor, $decision);
                $application->refresh();
            } elseif (! $already && $application->decision_letter_file_id === null) {
                throw ValidationException::withMessages([
                    'decisionLetter' => 'Upload the decision letter as a PDF.',
                ]);
            }

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
                /*
                 * A mapped next step goes through apply(). An administrator
                 * or CRO / Reviewing officer overriding from elsewhere (for
                 * example recording a grant off the usual Background Check /
                 * DD Query / Delayed statuses) goes through set() with a
                 * reason.
                 */
                $ordinary = in_array($decision, Engine::availableTransitions($application, $actor), true);
                if ($ordinary || ! $override) {
                    Engine::apply($application, $decision, $actor, $meta);
                } else {
                    Engine::set($application, $decision, $actor, $meta);
                }
            }

            Engine::record($application, CipEvent::ACTION_DECISION_RECORDED, $actor, $meta);

            return $application->refresh();
        });

        /*
         * Approved in the lane, the file is collecting its COR documents,
         * and may already have them.
         *
         * A file whose papers were all accepted before the decision was
         * recorded has nothing left to judge, so no document verdict would
         * ever walk it on: it would sit at Approved over a family that all
         * reads Apply for COR. The checklist is read here instead, once,
         * as the decision lands.
         */
        if (! $already && $application->status === Status::POST_APPROVED) {
            $application = Review::settle($application, $actor);
        }

        return $application;
    }
}
