<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The dates one application has reached, in the order it travels through them
 *, what §4d's Timeline card on Overview draws.
 *
 * Every step is answered, including the ones still ahead of the file: a
 * milestone that has not happened comes back with no date rather than being
 * left out, because the empty ones are how a reader tells what is still to
 * come. A list of only the dates that exist would make an application filed
 * this morning look finished.
 *
 * Plain days, never instants. These are DATE columns, the day the Unit
 * received something, not a moment in it, and every time in this portal is
 * printed in the reader's own zone ({@see App\Support\UserTime}). A milestone
 * that read a day earlier for a colleague in another country would be an audit
 * trail disagreeing with itself, so the day is settled here and the browser is
 * left to decide how to say it.
 *
 * Every answer comes off the application row itself, so a page of fifty of them
 * costs no queries at all.
 */
class Milestones
{
    public const FILED = 'filed';

    public const SUBMITTED = 'submitted';

    public const LOCKED = 'locked';

    public const QUERY_RECEIVED = 'query_received';

    public const ACCEPTED = 'accepted';

    public const DECISION = 'decision';

    /**
     * key => [the column it reads, what it is called, who may correct it].
     *
     * The order of this array is the order of the timeline, and the timeline is
     * the journey: filed with us, submitted to the Unit (§16), the Unit's query
     * back, accepted for processing, decided.
     *
     * The capability is the one held by the verb that writes the date in the
     * first place, read from here rather than restated in
     * {@see correct()}: whoever may record a milestone may correct the day it
     * was recorded on, and nobody else. Splitting the two would mean a reader
     * who cannot move a file to Approved could still change the day it was.
     */
    private const STEPS = [
        self::FILED => ['created_at', 'Filed', 'cip.compliance'],
        // §15's confirm-submission: the moment the original package froze and
        // stopped being editable by anybody, provider or staff. It sits before
        // the submission because it is what makes the submission possible, and
        // "when did this stop being changeable" is the first question asked of
        // a package the Unit later queries.
        self::LOCKED => ['locked_at', 'Package confirmed', 'cip.compliance'],
        self::SUBMITTED => ['submitted_at', 'Submitted', 'cip.compliance'],
        self::QUERY_RECEIVED => ['query_received_at', 'Query received', 'cip.compliance'],
        self::ACCEPTED => ['accepted_at', 'Accepted', 'cip.compliance'],
        self::DECISION => ['decided_at', 'Decision', 'cip.decide'],
    ];

    /**
     * The whole timeline: every step in its order, reached or still to come.
     *
     * `canEdit` answers whether this reader may correct the day, which is
     * only ever true of a step that has one: {@see correct()} fixes a date
     * that was recorded wrong, it does not record one. A milestone still
     * ahead of the file gets its date from the verb that moves the file
     * there, so that the status, the audit event and the date arrive
     * together. A null actor is a screen nobody is reading, and may edit
     * nothing.
     *
     * @return list<array{key:string,label:string,date:string|null,reached:bool,canEdit:bool}>
     */
    public static function for(CipApplication $application, ?User $actor = null): array
    {
        $milestones = [];

        foreach (self::STEPS as $key => [$column, $label, $capability]) {
            $date = $application->{$column};

            $milestones[] = [
                'key' => $key,
                'label' => $key === self::DECISION ? self::decisionLabel($application) : $label,
                'date' => $date?->toDateString(),
                'reached' => $date !== null,
                'canEdit' => $date !== null
                    && $actor !== null
                    && CipAccess::can($actor, $capability),
            ];
        }

        return $milestones;
    }

    /**
     * Correct the day a milestone was recorded on. The status does not move.
     *
     * The same argument {@see Submission::correct()} makes about a mistyped
     * CIP number: a date entered wrong, or carried in from a file the firm
     * kept before this portal existed, is not a lifecycle event, and making
     * somebody unwind a status to fix one would be worse than the mistake.
     * Every one of these dates is measured from somewhere — the delay clock
     * from Accepted (§20), the compliance window from Query received (§18),
     * every report from the decision — so a wrong day is not cosmetic.
     *
     * ONLY A DATE THAT ALREADY EXISTS
     *
     * Refusing an empty step is what keeps this a correction rather than a
     * second, quieter way to drive the lifecycle. Each of these columns means
     * something happened: `locked_at` freezes the original package (§15),
     * `accepted_at` starts the 180-day clock, `decided_at` sits beside an
     * outcome. Writing one by hand onto a file that has not been there would
     * put the portal into a state no transition produced — a package locked
     * without anybody confirming it, a clock running on a file the Unit has
     * not accepted — and none of the guards that exist to prevent exactly
     * that would have been asked.
     *
     * @throws \InvalidArgumentException  no such step, or nothing to correct
     * @throws \Illuminate\Auth\Access\AuthorizationException
     */
    public static function correct(
        CipApplication $application,
        User $actor,
        string $key,
        Carbon $date,
    ): CipApplication {
        [$column, $label, $capability] = self::STEPS[$key]
            ?? throw new \InvalidArgumentException('That is not a step on this application’s timeline.');

        abort_unless(
            CipAccess::can($actor, $capability),
            403,
            'You cannot change this application’s '.lcfirst($label).' date.',
        );

        $was = $application->{$column};

        if ($was === null) {
            throw new \InvalidArgumentException(sprintf(
                'This application has no %s date yet. Record the step itself, so the date and the status go together.',
                lcfirst($label),
            ));
        }

        $previous = $was->toDateString();
        $corrected = $date->toDateString();

        if ($previous === $corrected) {
            return $application;
        }

        return DB::transaction(function () use ($application, $actor, $key, $column, $label, $date, $previous, $corrected) {
            $application->forceFill([$column => $date->startOfDay()])->save();

            /*
             * The step is named by its key, not its label: the labels are the
             * card's wording and may be reworded, and the last one changes
             * with the outcome. An audit row read back in five years has to
             * say which column moved.
             */
            Engine::record($application, CipEvent::ACTION_MILESTONE_CORRECTED, $actor, [
                'milestone' => $key,
                'label' => $label,
                'previous' => $previous,
                'date' => $corrected,
            ]);

            ActivityLogger::log([
                'actor' => $actor,
                'type' => 'cip.milestone_corrected',
                'module' => 'cip',
                'description' => $application->displayNumber().'’s '.lcfirst($label).' date corrected to '.$corrected,
                'subject' => $application,
                'old' => [$key => $previous],
                'new' => [$key => $corrected],
            ]);

            return $application->refresh();
        });
    }

    /**
     * The last step is called what happened, once something has.
     *
     * "Decision" is the question and Approved or Denied is the answer, so the
     * card stops asking as soon as it knows. The wording comes from
     * {@see Status} rather than a second list here: the decision column and the
     * two terminal statuses are the same vocabulary, and reading it there is
     * what stops the card and the status chip beside it spelling it
     * differently. Anything else in the column is not a decision this module
     * recognises, and the step stays the question.
     */
    private static function decisionLabel(CipApplication $application): string
    {
        $decision = $application->decision;

        return $decision !== null && Status::isTerminal($decision)
            ? Status::label($decision)
            : 'Decision';
    }
}
