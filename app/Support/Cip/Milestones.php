<?php

namespace App\Support\Cip;

use App\Models\CipApplication;

/**
 * The dates one application has reached, in the order it travels through them
 * — what §4d's Timeline card on Overview draws.
 *
 * Every step is answered, including the ones still ahead of the file: a
 * milestone that has not happened comes back with no date rather than being
 * left out, because the empty ones are how a reader tells what is still to
 * come. A list of only the dates that exist would make an application filed
 * this morning look finished.
 *
 * Plain days, never instants. These are DATE columns — the day the Unit
 * received something, not a moment in it — and every time in this portal is
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
     * key => [the column it reads, what it is called].
     *
     * The order of this array is the order of the timeline, and the timeline is
     * the journey: filed with us, submitted to the Unit (§16), the Unit's query
     * back, accepted for processing, decided.
     */
    private const STEPS = [
        self::FILED => ['created_at', 'Filed'],
        // §15's confirm-submission: the moment the original package froze and
        // stopped being editable by anybody, provider or staff. It sits before
        // the submission because it is what makes the submission possible, and
        // "when did this stop being changeable" is the first question asked of
        // a package the Unit later queries.
        self::LOCKED => ['locked_at', 'Package confirmed'],
        self::SUBMITTED => ['submitted_at', 'Submitted'],
        self::QUERY_RECEIVED => ['query_received_at', 'Query received'],
        self::ACCEPTED => ['accepted_at', 'Accepted'],
        self::DECISION => ['decided_at', 'Decision'],
    ];

    /**
     * The whole timeline: every step in its order, reached or still to come.
     *
     * @return list<array{key:string,label:string,date:string|null,reached:bool}>
     */
    public static function for(CipApplication $application): array
    {
        $milestones = [];

        foreach (self::STEPS as $key => [$column, $label]) {
            $date = $application->{$column};

            $milestones[] = [
                'key' => $key,
                'label' => $key === self::DECISION ? self::decisionLabel($application) : $label,
                'date' => $date?->toDateString(),
                'reached' => $date !== null,
            ];
        }

        return $milestones;
    }

    /**
     * The last step is called what happened, once something has.
     *
     * "Decision" is the question and Granted or Denied is the answer, so the
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
