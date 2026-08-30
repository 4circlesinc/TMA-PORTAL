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

    public const COR_SUBMITTED = 'cor_submitted';

    public const COR_RECEIVED = 'cor_received';

    public const NIC_SUBMITTED = 'nic_submitted';

    public const NIC_RECEIVED = 'nic_received';

    public const PASSPORT_SUBMITTED = 'passport_submitted';

    public const PASSPORT_RECEIVED = 'passport_received';

    public const PASSPORT_DELIVERED = 'passport_delivered';

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
     * Dates after a grant. Shown once the file is in post-approval (or a
     * date has already been recorded), so a pre-approval Overview is not
     * seven empty rows of work that has not started.
     *
     * @var array<string, array{0: string, 1: string, 2: string}>
     */
    private const POST_STEPS = [
        self::COR_SUBMITTED => ['cor_submitted_at', 'COR submitted', 'cip.compliance'],
        self::COR_RECEIVED => ['cor_received_at', 'COR received', 'cip.compliance'],
        self::NIC_SUBMITTED => ['nic_submitted_at', 'NIC submitted', 'cip.compliance'],
        self::NIC_RECEIVED => ['nic_received_at', 'NIC received', 'cip.compliance'],
        self::PASSPORT_SUBMITTED => ['passport_submitted_at', 'Passport applied', 'cip.compliance'],
        self::PASSPORT_RECEIVED => ['passport_received_at', 'Passport received', 'cip.compliance'],
        self::PASSPORT_DELIVERED => ['passport_delivered_at', 'Passport delivered', 'cip.compliance'],
    ];

    /**
     * The whole timeline: every step in its order, reached or still to come.
     *
     * Two answers per step, and they are never both true. `canEdit` is a day
     * already recorded that this reader may correct — {@see correct()} fixes a
     * date entered wrong and moves nothing else. `canRecord` is an empty step
     * this reader may record right now, which the card turns into the verb
     * that drives it, so the status, the audit event and the date still arrive
     * together rather than a date appearing on a step the file never took.
     *
     * A null actor is a screen nobody is reading, and may do neither.
     *
     * @return list<array{
     *     key:string, label:string, date:string|null, reached:bool,
     *     canEdit:bool, canRecord:bool
     * }>
     */
    public static function for(CipApplication $application, ?User $actor = null): array
    {
        $milestones = [];
        $steps = self::STEPS + (self::showsPost($application) ? self::POST_STEPS : []);

        foreach ($steps as $key => [$column, $label, $capability]) {
            $date = $application->{$column};

            $milestones[] = [
                'key' => $key,
                'label' => $key === self::DECISION ? self::decisionLabel($application) : $label,
                'date' => $date?->toDateString(),
                'reached' => $date !== null,
                'canEdit' => $date !== null
                    && $actor !== null
                    && CipAccess::can($actor, $capability),
                'canRecord' => $date === null && self::canRecord($application, $actor, $key),
            ];
        }

        return $milestones;
    }

    /**
     * The status each step's verb drives the file to.
     *
     * Filed has no verb — a row exists, so it happened — and the lock is not a
     * status change at all, which is why it is answered separately below.
     */
    private const RECORDS = [
        self::SUBMITTED => Status::PENDING_REVIEW,
        self::QUERY_RECEIVED => Status::NON_COMPLIANT,
        self::ACCEPTED => Status::BACKGROUND_CHECK,
        self::DECISION => Status::GRANTED,
        self::COR_SUBMITTED => Status::PENDING_COR,
        self::COR_RECEIVED => Status::APPLY_FOR_NIC,
        self::NIC_SUBMITTED => Status::PENDING_NIC,
        self::NIC_RECEIVED => Status::APPLY_FOR_PASSPORT,
        self::PASSPORT_SUBMITTED => Status::PENDING_PASSPORT,
        self::PASSPORT_RECEIVED => Status::READY_FOR_DELIVERY,
        self::PASSPORT_DELIVERED => Status::CLOSED,
    ];

    /**
     * May this reader record this step right now — the answer that decides
     * whether an empty row on the card is a way in or just a dash.
     *
     * The engine's own two questions, not a third reading of them: is the edge
     * in the lifecycle from where the file stands, and may this actor drive
     * it. Offering a step that would then be refused would be the card hiding
     * a rule it could simply not have shown, which is the same argument the
     * action bar's buttons are drawn from.
     *
     * The lock is not a status change, so it is asked of
     * {@see Confirmation::allows()} instead — the authority the Confirm
     * submission button itself uses. Staff never hold it: the press is the
     * submitting party's.
     */
    private static function canRecord(CipApplication $application, ?User $actor, string $key): bool
    {
        if ($actor === null) {
            return false;
        }

        if ($key === self::LOCKED) {
            return Confirmation::allows($actor, $application);
        }

        if ($key === self::COR_SUBMITTED && ! $application->isCorLocked()) {
            return false;
        }

        $to = self::RECORDS[$key] ?? null;

        return $to !== null
            && Engine::canTransition($application, $to)
            && Engine::allows($actor, $application, $to);
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
        [$column, $label, $capability] = (self::STEPS + self::POST_STEPS)[$key]
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

    /**
     * Post-approval dates belong on the card once that lane has started.
     *
     * A date already stored still shows after an override pulls the file
     * back: hiding a recorded day would be the card disagreeing with the
     * columns that hold it.
     */
    private static function showsPost(CipApplication $application): bool
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
            return true;
        }

        foreach (self::POST_STEPS as [$column]) {
            if ($application->{$column} !== null) {
                return true;
            }
        }

        return false;
    }
}
