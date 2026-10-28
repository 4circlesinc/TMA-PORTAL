<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Where one person stands in the post-approval lane.
 *
 * The same lane the application walks, in the same words: Post-Approval,
 * Approved, Updates Required, Apply for COR, Pending COR, COR Received,
 * Apply for NIC, Pending NIC, NIC Received, Apply for Passport, Pending
 * Passport, Passport Received, Passport Delivered, Closed. A person's chip
 * and the application's chip used to come from two
 * vocabularies nothing connected, which is how a file standing at Approved
 * showed its main applicant as Not started.
 *
 * A person's status is READ, not typed. Three things decide it:
 *
 *  1. The application. A person stands where the file stands. When the
 *     file moves, by a recorded date or by its checklist, everyone on it
 *     moves with it.
 *  2. Their own documents. While a step is still collecting paper, the
 *     person's own checklist speaks for them: one document sent back is
 *     Updates Required, and every document Ready for submission is Apply
 *     for COR, whether or not the rest of the family is there yet. That is
 *     the individual rule beside the main one: the APPLICATION reaches
 *     Apply for COR only when every person on it has.
 *  3. Steps recorded for them alone. NIC and passport applications are
 *     made per person, so those dates can be recorded per person, and a
 *     person may stand ahead of the file that way. Each submission asks
 *     the same thing the application's does: every document this person
 *     owes for the step, and every one uploaded, Ready for submission.
 *     The Certificate of Registration is one package, confirmed and
 *     locked once, so its steps are the application's alone.
 *
 * A person never stands behind the file: it cannot move on until all its
 * documents are ready, so there is nobody for it to leave behind. And once
 * every person with papers in a step has been taken past it on their own,
 * the file follows on the last date recorded, so the main chip cannot
 * trail its own people. Somebody who owes nothing for a step, a child
 * under 16 for the NIC, a sponsor throughout, has nothing of their own to
 * record there and simply goes with the file.
 *
 * The one thing a hand does set is an outcome of the person's own: Denied,
 * one member of the family refused, or Closed, their part of the file
 * finished or withdrawn. That person stops following the file, and their
 * documents stop holding it.
 */
class PersonStatus
{
    public const POST_APPROVAL = Status::POST_APPROVAL;

    public const POST_APPROVED = Status::POST_APPROVED;

    public const POST_DENIED = Status::POST_DENIED;

    public const UPDATE_REQUIRED = Status::UPDATE_REQUIRED;

    public const APPLY_FOR_COR = Status::APPLY_FOR_COR;

    public const PENDING_COR = Status::PENDING_COR;

    public const COR_RECEIVED = Status::COR_RECEIVED;

    public const APPLY_FOR_NIC = Status::APPLY_FOR_NIC;

    public const PENDING_NIC = Status::PENDING_NIC;

    public const NIC_RECEIVED = Status::NIC_RECEIVED;

    public const APPLY_FOR_PASSPORT = Status::APPLY_FOR_PASSPORT;

    public const PENDING_PASSPORT = Status::PENDING_PASSPORT;

    public const PASSPORT_RECEIVED = Status::PASSPORT_RECEIVED;

    public const PASSPORT_DELIVERED = Status::PASSPORT_DELIVERED;

    public const CLOSED = Status::CLOSED;

    /**
     * A person's own move from NIC Received to Apply for Passport.
     *
     * Not a date the Unit records. The NIC received date already landed
     * them on NIC Received; starting the passport application is the next
     * status, and it has to stick when {@see settle()} reads their dates
     * back, so it is stored beside those dates.
     */
    private const START_PASSPORT = 'start_passport';

    /** `post_approval_apart`: this person was refused, the file was not. */
    public const APART_DENIED = 'denied';

    /** `post_approval_apart`: this person's part of the file is finished. */
    public const APART_CLOSED = 'closed';

    /** The audit row a hand-made move writes. */
    public const ACTION_CHANGED = 'person_status_changed';

    /** In the order the lane runs, which is the order a picker lists them. */
    public const ALL = [
        self::POST_APPROVAL,
        self::POST_APPROVED,
        self::POST_DENIED,
        self::UPDATE_REQUIRED,
        self::APPLY_FOR_COR,
        self::PENDING_COR,
        self::COR_RECEIVED,
        self::APPLY_FOR_NIC,
        self::PENDING_NIC,
        self::NIC_RECEIVED,
        self::APPLY_FOR_PASSPORT,
        self::PENDING_PASSPORT,
        self::PASSPORT_RECEIVED,
        self::PASSPORT_DELIVERED,
        self::CLOSED,
    ];

    /**
     * The vocabulary this replaced, kept only so an old audit row still
     * reads as what it said on the day.
     */
    private const RETIRED_LABELS = [
        'not_started' => 'Not started',
        'documents_pending' => 'Documents pending',
        'documents_in_review' => 'Documents in review',
        'ready_for_submission' => 'Ready for submission',
        'processing' => 'Processing',
        'completed' => 'Completed',
        'approved' => 'Approved',
        'denied' => 'Denied',
    ];

    /**
     * How far along the lane a status is.
     *
     * Updates Required and Denied have no place of their own: the first is
     * a state of whichever step is collecting, the second is off the lane.
     */
    private const RANK = [
        self::POST_APPROVAL => 0,
        self::POST_APPROVED => 1,
        self::APPLY_FOR_COR => 2,
        self::PENDING_COR => 3,
        self::COR_RECEIVED => 4,
        self::APPLY_FOR_NIC => 5,
        self::PENDING_NIC => 6,
        self::NIC_RECEIVED => 7,
        self::APPLY_FOR_PASSPORT => 8,
        self::PENDING_PASSPORT => 9,
        self::PASSPORT_RECEIVED => 10,
        self::PASSPORT_DELIVERED => 11,
        self::CLOSED => 12,
    ];

    /** The steps that are still collecting documents, and for which pack. */
    private const COLLECTING = [
        self::POST_APPROVAL => Pack::COR,
        self::POST_APPROVED => Pack::COR,
        self::APPLY_FOR_NIC => Pack::NIC,
        self::APPLY_FOR_PASSPORT => Pack::PASSPORT,
    ];

    /**
     * The dated steps that may be recorded for one person on their own.
     *
     * `about` is the pack the step belongs to: somebody asked for nothing in
     * it has no such step to record. `pack` is the checklist the step hands
     * over: a submission needs it Ready for submission, a receipt hands
     * nothing over and needs none.
     *
     * @var array<string, array{from:string, to:string, about:string, pack:?string}>
     */
    private const OWN_STEPS = [
        Stages::NIC_SUBMITTED => ['from' => self::APPLY_FOR_NIC, 'to' => self::PENDING_NIC, 'about' => Pack::NIC, 'pack' => Pack::NIC],
        Stages::NIC_RECEIVED => ['from' => self::PENDING_NIC, 'to' => self::NIC_RECEIVED, 'about' => Pack::NIC, 'pack' => null],
        self::START_PASSPORT => ['from' => self::NIC_RECEIVED, 'to' => self::APPLY_FOR_PASSPORT, 'about' => Pack::PASSPORT, 'pack' => null, 'dated' => false],
        Stages::PASSPORT_SUBMITTED => ['from' => self::APPLY_FOR_PASSPORT, 'to' => self::PENDING_PASSPORT, 'about' => Pack::PASSPORT, 'pack' => Pack::PASSPORT],
        Stages::PASSPORT_RECEIVED => ['from' => self::PENDING_PASSPORT, 'to' => self::PASSPORT_RECEIVED, 'about' => Pack::PASSPORT, 'pack' => null],
        Stages::PASSPORT_DELIVERED => ['from' => self::PASSPORT_RECEIVED, 'to' => self::PASSPORT_DELIVERED, 'about' => Pack::PASSPORT, 'pack' => null],
    ];

    public static function isValid(?string $status): bool
    {
        return $status !== null && in_array($status, self::ALL, true);
    }

    public static function label(string $status): string
    {
        return self::RETIRED_LABELS[$status] ?? Status::label($status);
    }

    public static function tone(string $status): string
    {
        return Status::tone($status);
    }

    /** @return array{status:string,label:string,tone:string} */
    public static function badge(string $status): array
    {
        return [
            'status' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ];
    }

    /**
     * Every status a person can wear, in lane order.
     *
     * @return list<array{value:string,label:string,tone:string}>
     */
    public static function listed(): array
    {
        return self::items(self::ALL);
    }

    /**
     * Where this person stands.
     *
     * The stored value once the rules have settled it. A row nobody has
     * settled yet, or one still holding a retired value, reads as the step
     * the application itself is on rather than as a status of its own.
     */
    public static function current(CipPerson $person): string
    {
        $stored = $person->post_approval_status;

        if (self::isValid($stored)) {
            return $stored;
        }

        $application = $person->relationLoaded('application') ? $person->application : null;

        return ($application ? self::fileStage($application) : null) ?? self::POST_APPROVAL;
    }

    /**
     * The chip one person wears in post-approval.
     *
     * @return array{status:string,statusLabel:string,statusTone:string}
     */
    public static function forPerson(CipPerson $person): array
    {
        $badge = self::badge(self::current($person));

        return [
            'status' => $badge['status'],
            'statusLabel' => $badge['label'],
            'statusTone' => $badge['tone'],
        ];
    }

    /**
     * Everything a screen needs to draw one person's chip and its picker.
     *
     * @return array<string, mixed>
     */
    public static function present(
        CipPerson $person,
        CipApplication $application,
        ?User $viewer,
        bool $forListing = false,
    ): array {
        $person->setRelation('application', $application);

        return [
            ...self::forPerson($person),
            // Set by hand and no longer following the application.
            'statusApart' => $person->post_approval_apart !== null,
            'availableStatuses' => self::availableTransitions($person, $viewer, $forListing),
            'availableStatusOverrides' => self::availableOverrides($person, $viewer),
            'lockedStatuses' => self::lockedStatuses($person, $viewer, $forListing),
            'statusHold' => self::hold($person, $viewer, $forListing),
        ];
    }

    /**
     * Why this person's own next dated step is not on offer, or null.
     *
     * {@see availableTransitions()} leaves a submission out until the
     * person's documents for it are Ready for submission, and their menu
     * then showed the step greyed with nothing to say why. One sentence,
     * the same one the application's menu uses ({@see Stages::hold()}), and
     * only where that is the reason: somebody who owes nothing in the pack
     * has no step of their own and is told nothing. A listing has not
     * counted anybody's documents and offers the step instead.
     */
    public static function hold(CipPerson $person, ?User $actor, bool $forListing = false): ?string
    {
        $application = $person->application;

        if ($forListing || $actor === null || $application === null
            || ! CipAccess::canChangeApplicationStatus($actor)) {
            return null;
        }

        foreach (self::nextSteps($person, $application) as $to => $key) {
            $pack = $key !== null ? self::OWN_STEPS[$key]['pack'] : null;

            if ($pack !== null
                && Engine::allows($actor, $application, $to)
                && ! self::ready(self::tally($person, $application, $pack))) {
                return 'Every document must be Ready for submission first.';
            }
        }

        return null;
    }

    /**
     * The steps this reader may take this person to next.
     *
     * A dated step carries the stage it records and the label of its date,
     * so the dialog can ask for the day. A submission is offered only once
     * the person's documents for it are Ready for submission; a listing
     * that has not counted them offers the step and lets the write refuse,
     * the way {@see Engine::availableTransitions()} does for a table row.
     *
     * @return list<array<string, string>>
     */
    public static function availableTransitions(CipPerson $person, ?User $actor, bool $forListing = false): array
    {
        $application = $person->application;

        if ($actor === null || $application === null || ! CipAccess::canChangeApplicationStatus($actor)) {
            return [];
        }

        $next = [];

        foreach (self::nextSteps($person, $application) as $to => $key) {
            if (! Engine::allows($actor, $application, $to)) {
                continue;
            }

            $pack = $key !== null ? self::OWN_STEPS[$key]['pack'] : null;

            if (! $forListing && $pack !== null && ! self::ready(self::tally($person, $application, $pack))) {
                continue;
            }

            $next[] = self::item($to, $key);
        }

        return $next;
    }

    /**
     * The earlier steps this reader may pull this person back to.
     *
     * Only what was recorded for the person alone can be taken back here:
     * a step they stand ahead of the file on, or an outcome of their own.
     * Where the application itself stands is the application's to change.
     *
     * @return list<array<string, string>>
     */
    public static function availableOverrides(CipPerson $person, ?User $actor): array
    {
        $application = $person->application;

        if ($application === null || ! CipAccess::canOverrideStatus($actor)) {
            return [];
        }

        return self::items(self::backSteps($person, $application));
    }

    /**
     * The rest of the lane, shown but not pickable, so the picker reads as
     * the whole lifecycle rather than as one or two loose options.
     *
     * @return list<array<string, string>>
     */
    public static function lockedStatuses(CipPerson $person, ?User $actor, bool $forListing = false): array
    {
        if ($actor === null || ! CipAccess::canChangeApplicationStatus($actor)) {
            return [];
        }

        $open = array_merge(
            [self::current($person)],
            array_column(self::availableTransitions($person, $actor, $forListing), 'value'),
            array_column(self::availableOverrides($person, $actor), 'value'),
        );

        return self::items(array_values(array_filter(
            self::ALL,
            fn (string $status) => ! in_array($status, $open, true),
        )));
    }

    /**
     * Put every person on the application where the rules say they stand.
     *
     * Called wherever the answer can have changed: the application moved,
     * a document was judged, the file was opened. Cheap when nothing has:
     * one read of the family, one count per pack in play, and a write only
     * for a person whose status is no longer true.
     *
     * No audit row. The application's move or the document's verdict is
     * already on the trail, and six rows saying a family followed its own
     * file would bury it.
     */
    public static function settle(CipApplication $application): void
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return;
        }

        if (self::fileStage($application) === null) {
            // An appeal, or a file pulled into the other lane: nothing here
            // describes it, so people keep the status they last held.
            return;
        }

        Review::forgetTally($application);

        /*
         * Read fresh, never off the relation. A listing loads `people`
         * narrowed to the main applicant, and settling that would leave the
         * dependants exactly where this exists to stop them being left.
         */
        $loaded = $application->relationLoaded('people') ? $application->people : null;

        foreach ($application->people()->get() as $person) {
            $person->setRelation('application', $application);
            $to = self::resolve($person, $application);

            if ($to === null || $to === $person->post_approval_status) {
                continue;
            }

            $person->forceFill(['post_approval_status' => $to])->save();

            // The copy the caller is holding, so a response built from it
            // does not report the status this just replaced.
            $held = $loaded?->firstWhere('id', $person->id);
            if ($held !== null && $held !== $person) {
                $held->forceFill(['post_approval_status' => $to])->syncOriginalAttribute('post_approval_status');
            }
        }
    }

    /**
     * Move one person by hand.
     *
     * Three kinds of move, and nothing else is one: a dated step recorded
     * for this person alone, an outcome of their own, or pulling back
     * something that was recorded for them alone. Everything else a person
     * can be seen wearing is decided by the application or by their
     * documents, and is refused here with the reason.
     *
     * @return array{from:string, to:string, changed:bool}
     *
     * @throws AuthorizationException
     * @throws \InvalidArgumentException
     */
    public static function move(
        CipPerson $person,
        string $to,
        ?User $actor,
        ?Carbon $date = null,
        string $note = '',
    ): array {
        $application = $person->application;

        if ($application === null || ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            throw new \InvalidArgumentException('Person status may only be changed in post-approval.');
        }

        if (! self::isValid($to)) {
            throw new \InvalidArgumentException(self::label($to).' is not a person status.');
        }

        $from = self::current($person);

        if ($from === $to) {
            return ['from' => $from, 'to' => $to, 'changed' => false];
        }

        if ($actor !== null && ! CipAccess::canChangeApplicationStatus($actor)) {
            throw new AuthorizationException('You cannot move this person to '.self::label($to).'.');
        }

        $next = self::nextSteps($person, $application);
        $back = self::backSteps($person, $application);
        $meta = array_filter([
            'person_id' => $person->uuid,
            'person_name' => $person->fullName(),
            'person_role' => $person->role,
            'note' => trim($note) !== '' ? trim($note) : null,
        ]);

        if (array_key_exists($to, $next)) {
            if ($actor !== null && ! Engine::allows($actor, $application, $to)) {
                throw new AuthorizationException('You cannot move this person to '.self::label($to).'.');
            }

            $key = $next[$to];

            if ($key !== null) {
                $pack = self::OWN_STEPS[$key]['pack'];

                if ($pack !== null && ! self::ready(self::tally($person, $application, $pack, fresh: true))) {
                    throw self::notReady($person, $application, $pack);
                }

                $date = ($date ?? Carbon::now())->copy()->startOfDay();
                $fill = ['post_approval_dates' => array_merge(
                    self::dates($person),
                    [$key => $date->toDateString()],
                )];
                $meta['stage'] = $key;
                $meta['date'] = $date->toDateString();
            } else {
                $fill = ['post_approval_apart' => $to === self::POST_DENIED
                    ? self::APART_DENIED
                    : self::APART_CLOSED];
                $meta['apart'] = true;
            }
        } elseif (in_array($to, $back, true)) {
            if (! CipAccess::canOverrideStatus($actor)) {
                throw new AuthorizationException('You cannot pull this person back to an earlier status.');
            }

            $fill = $person->post_approval_apart !== null
                ? ['post_approval_apart' => null]
                : ['post_approval_dates' => self::datesUpTo($person, $to)];
            $meta['override'] = true;
            // Said outright, for the timeline: the retired vocabulary marked
            // every off-map move an override, forward ones included.
            $meta['back'] = true;
        } else {
            throw new \InvalidArgumentException(self::refusal($person, $application, $to));
        }

        $apartChanged = array_key_exists('post_approval_apart', $fill);

        DB::transaction(function () use ($person, $application, $fill, $actor, $meta, $from, $to) {
            if (array_key_exists('post_approval_dates', $fill) && $fill['post_approval_dates'] === []) {
                $fill['post_approval_dates'] = null;
            }

            $person->forceFill($fill)->save();

            // Somebody whose NIC is in gets their passport slots now, not
            // on the next open of the file.
            if (isset($meta['stage'])) {
                Requirements::settleChecklist($person);
            }

            self::settle($application);

            Engine::record($application, self::ACTION_CHANGED, $actor, $meta, $from, $to);
        });

        /*
         * An outcome of their own changes whose documents the FILE counts.
         *
         * Deny the one person whose paper was holding the package and the
         * family is ready; nothing is left to judge, so no document verdict
         * would ever tell the application. Take that outcome back and the
         * reverse is true. Either way the file is walked here, the way a
         * verdict would walk it, after the move itself has been committed.
         */
        if ($apartChanged) {
            Review::settle($application->fresh(), $actor);
        }

        $person->refresh()->setRelation('application', $application->fresh());

        // Recorded for the last person still on the step, or the last one
        // still on it set apart: the file has no one left there, so it goes.
        if (isset($meta['stage']) || $apartChanged) {
            self::liftFile($application);
        }

        return ['from' => $from, 'to' => self::current($person->refresh()), 'changed' => true];
    }

    /**
     * Is this person set apart from the file by an outcome of their own?
     *
     * {@see Review} asks, because a person refused or closed on their own
     * must not hold the rest of the family's package.
     */
    public static function isApart(CipPerson $person): bool
    {
        return $person->post_approval_apart !== null;
    }

    /**
     * Take the application after its people, if they have all left its step.
     *
     * {@see move()} asks as a step is recorded. {@see Review::settle()} asks
     * again after every document verdict and every edit of who is on the
     * file, because a lift can be refused on the day, a paper still unread,
     * the file on Updates Required, and has to be made when that clears.
     *
     * @return CipApplication the application as it now stands
     */
    public static function lift(CipApplication $application): CipApplication
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return $application;
        }

        // Only a step somebody can be taken past on their own can be left
        // behind; everywhere else there is nothing to ask, and no query.
        if (! in_array($application->status, array_column(self::OWN_STEPS, 'from'), true)) {
            return $application;
        }

        return self::liftFile($application);
    }

    /**
     * The application has handed a pack over: note who stood apart from it.
     *
     * Somebody set apart no longer holds the family's package, so it can go
     * to the Unit with their papers never accepted. That is the point of
     * setting them apart. It is also the one way a person could then ride
     * past the step: take the outcome back afterwards and they would stand
     * on Pending COR, or Pending NIC, on the strength of a package they were
     * not in. So the pack is written against them as it goes, and nobody
     * with one written against them is offered a way back into step.
     *
     * Only those apart AT the hand-over. An outcome set later, by mistake,
     * on somebody who was in the package can be taken back like any other.
     */
    public static function markMissed(CipApplication $application, string $pack): void
    {
        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return;
        }

        $apart = $application->people()->whereNotNull('post_approval_apart')->get();

        if ($apart->isEmpty()) {
            return;
        }

        Review::forgetTally($application);
        $tallies = Review::tallyByPerson($application, $pack);

        foreach ($apart as $person) {
            $own = $tallies[(int) $person->getKey()] ?? null;

            // Asked for nothing in it, or every paper of theirs accepted:
            // they were in the package as far as it concerned them.
            if (! self::owes($person, $application, $pack) || ($own !== null && self::ready($own))) {
                continue;
            }

            $missed = self::missed($person);

            if (! in_array($pack, $missed, true)) {
                $person->forceFill(['post_approval_missed' => implode(',', [...$missed, $pack])])->save();
            }
        }
    }

    /**
     * Has this person's NIC been recorded as received on their own?
     *
     * {@see Pack::openFor()} asks, to open their passport slots without
     * waiting for the rest of the family.
     */
    public static function hasOwnNic(CipPerson $person): bool
    {
        return ! empty(self::dates($person)[Stages::NIC_RECEIVED]);
    }

    /* ── the rules ─────────────────────────────────── */

    /** Where the rules put this person, or null to leave them be. */
    private static function resolve(CipPerson $person, CipApplication $application): ?string
    {
        return match ($person->post_approval_apart) {
            self::APART_DENIED => self::POST_DENIED,
            self::APART_CLOSED => self::CLOSED,
            default => self::following($person, $application),
        };
    }

    /** The same answer for a person who is following the file. */
    private static function following(CipPerson $person, CipApplication $application): ?string
    {
        $stage = self::stage($person, $application);

        if ($stage === null) {
            return null;
        }

        /*
         * A paper of theirs sent back in the pack the file is still
         * collecting is theirs to put right, wherever they have got to on
         * their own. Somebody recorded as Pending NIC whose R3 form is then
         * refused makes the APPLICATION Updates Required; without this
         * nobody on it would read that way, least of all the person whose
         * paper it was, and they would go on being offered NIC received.
         */
        $file = self::fileStage($application);
        $collecting = $file !== null ? (self::COLLECTING[$file] ?? null) : null;

        if ($collecting !== null && $stage !== $file) {
            $own = Review::tallyByPerson($application, $collecting)[(int) $person->getKey()] ?? null;

            if ($own !== null && $own[DocumentStatus::UPDATE_REQUIRED]['total'] > 0) {
                return self::UPDATE_REQUIRED;
            }
        }

        return self::refine($person, $application, $stage);
    }

    /**
     * The step this person is on: the file's, or one recorded for them
     * alone that is further along.
     */
    private static function stage(CipPerson $person, CipApplication $application): ?string
    {
        $file = self::fileStage($application);

        // A denied file is denied for everyone on it, wherever they had got to.
        if ($file === null || $file === self::POST_DENIED) {
            return $file;
        }

        $own = self::ownStage($person);

        return $own !== null && self::RANK[$own] > self::RANK[$file] ? $own : $file;
    }

    /**
     * The step the application puts a person on before their documents are
     * read, or null when the file is somewhere this lane does not describe.
     */
    private static function fileStage(CipApplication $application): ?string
    {
        $status = $application->status;

        if (($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL) {
            return null;
        }

        if ($status === Status::POST_DENIED) {
            return self::POST_DENIED;
        }

        // The whole of the COR collection is one step for a person: which
        // of its labels they wear is their own documents' to say.
        if (in_array($status, [Status::POST_APPROVAL, Status::POST_APPROVED, Status::APPLY_FOR_COR], true)) {
            return self::base($application);
        }

        if ($status === Status::UPDATE_REQUIRED) {
            return match (Pack::current($application)) {
                Pack::PASSPORT => self::APPLY_FOR_PASSPORT,
                Pack::NIC => self::APPLY_FOR_NIC,
                default => self::base($application),
            };
        }

        // A file recorded before Passport Received had this name.
        if ($status === Status::READY_FOR_DELIVERY) {
            return self::PASSPORT_RECEIVED;
        }

        return isset(self::RANK[$status]) ? $status : null;
    }

    /**
     * What a file still collecting its COR documents is called.
     *
     * Approved once the lane's decision has been recorded, Post-Approval
     * until then. A file wearing one of those two says so itself. Only
     * where the label is out of sight, on Updates Required or Apply for
     * COR, is the decision column asked which it was collecting under.
     * One definition, shared with {@see Review}, so the file and its
     * people come back to the same label after an update.
     */
    public static function base(CipApplication $application): string
    {
        if ($application->status === Status::POST_APPROVAL || $application->status === Status::POST_APPROVED) {
            return $application->status;
        }

        return $application->decision === Status::POST_APPROVED
            ? self::POST_APPROVED
            : self::POST_APPROVAL;
    }

    /**
     * Is this person asked for anything in this pack?
     *
     * Read off the requirements they are owed rather than the slots they
     * hold, so it is the same answer before a checklist has been opened
     * and costs no query: a child under 16 is asked for no NIC papers, a
     * sponsor for none at all.
     */
    private static function owes(CipPerson $person, CipApplication $application, string $pack): bool
    {
        $person->setRelation('application', $application);

        return Requirements::forPhase(ApplicantType::for($person), Phase::POST_APPROVAL, $application, $person)
            ->contains(fn ($row) => Pack::of($row) === $pack);
    }

    /** The furthest step recorded for this person alone, if any. */
    private static function ownStage(CipPerson $person): ?string
    {
        $dates = self::dates($person);
        $stage = null;

        foreach (self::OWN_STEPS as $key => $step) {
            if (! empty($dates[$key])) {
                $stage = $step['to'];
            }
        }

        return $stage;
    }

    /**
     * A collecting step, read through the person's own checklist.
     *
     * Any document sent back is Updates Required, whichever pack it is in.
     * The COR pack alone has a label for "all accepted", Apply for COR; a
     * person at Apply for NIC or Apply for Passport with everything ready
     * is simply ready to have the submission recorded.
     */
    private static function refine(CipPerson $person, CipApplication $application, string $stage): string
    {
        $pack = self::COLLECTING[$stage] ?? null;

        if ($pack === null) {
            return $stage;
        }

        $tallies = Review::tallyByPerson($application, $pack);
        $own = $tallies[(int) $person->getKey()] ?? null;

        if ($own !== null && $own[DocumentStatus::UPDATE_REQUIRED]['total'] > 0) {
            return self::UPDATE_REQUIRED;
        }

        if ($pack !== Pack::COR || ! self::ready($own)) {
            return $stage;
        }

        /*
         * Ready. For somebody with papers of their own in the pack that is
         * Apply for COR, whatever the rest of the family is doing.
         *
         * Somebody who owes nothing in it, a sponsor, say, has no documents
         * to speak for them, so they wear the file's own label: Apply for
         * COR once the file is there, and until then the one it is
         * collecting under. "Every document" over none of them must not put
         * a person ahead of a family that is still filing.
         */
        return $own !== null || $application->status === Status::APPLY_FOR_COR
            ? self::APPLY_FOR_COR
            : $stage;
    }

    /**
     * The moves forward from where this person stands, whoever is asking:
     * the status each leads to, and the stage it records (null for an
     * outcome, which records none).
     *
     * @return array<string, ?string>
     */
    private static function nextSteps(CipPerson $person, CipApplication $application): array
    {
        $file = self::fileStage($application);

        if ($file === null) {
            return [];
        }

        if ($person->post_approval_apart === self::APART_DENIED) {
            return [self::CLOSED => null];
        }

        $status = self::current($person);

        if ($person->post_approval_apart !== null || $status === self::CLOSED || $file === self::POST_DENIED) {
            return [];
        }

        $next = [];

        foreach (self::OWN_STEPS as $key => $step) {
            // Nothing of theirs is in this step: they go through it with
            // the file, and have no day of their own to record for it.
            if ($step['from'] === $status && self::owes($person, $application, $step['about'])) {
                $next[$step['to']] = $key;
            }
        }

        // One member of the family refused while the rest go through …
        $next[self::POST_DENIED] = null;
        // … or their part of the file finished, or withdrawn. Where Closed
        // is already the dated step, passport delivered, that is what it is.
        $next[self::CLOSED] ??= null;

        return $next;
    }

    /**
     * The earlier statuses this person can be pulled back to.
     *
     * @return list<string>
     */
    private static function backSteps(CipPerson $person, CipApplication $application): array
    {
        $file = self::fileStage($application);

        if ($file === null) {
            return [];
        }

        // An outcome of their own: the one way back is into step with the file.
        if ($person->post_approval_apart !== null) {
            if (self::missedThePackage($person)) {
                return [];
            }

            $to = self::following($person, $application);

            return $to !== null && $to !== self::current($person) ? [$to] : [];
        }

        $own = self::ownStage($person);

        if ($file === self::POST_DENIED || $own === null || self::RANK[$own] <= self::RANK[$file]) {
            return [];
        }

        return array_values(array_filter(
            array_keys(self::RANK),
            fn (string $status) => self::RANK[$status] >= self::RANK[$file]
                && self::RANK[$status] < self::RANK[$own],
        ));
    }

    /**
     * Did the application hand a pack over without this person's documents?
     *
     * Written by {@see markMissed()} as it happened, not worked out
     * afterwards from today's checklist: a requirement added since, or a
     * slot the confirmed package froze, would otherwise strand somebody who
     * was in the package all along.
     */
    private static function missedThePackage(CipPerson $person): bool
    {
        return self::missed($person) !== [];
    }

    /** @return list<string>  the packs written against this person */
    private static function missed(CipPerson $person): array
    {
        return array_values(array_filter(explode(',', (string) $person->post_approval_missed)));
    }

    /**
     * The person's own dates with everything past this status taken off.
     *
     * @return array<string, string>
     */
    private static function datesUpTo(CipPerson $person, string $status): array
    {
        $limit = self::RANK[$status] ?? 0;

        return array_filter(
            self::dates($person),
            fn (string $key) => isset(self::OWN_STEPS[$key])
                && self::RANK[self::OWN_STEPS[$key]['to']] <= $limit,
            ARRAY_FILTER_USE_KEY,
        );
    }

    /**
     * The file has nobody left on its step: take it on.
     *
     * When the last person with papers in the step has their own date
     * recorded, the application's is that date too. It goes through
     * {@see Stages::record()} like any other, so the day is stored, the
     * notice is sent once and the engine's own gates are asked again. A
     * refusal there leaves the file where it is rather than undoing the
     * person's step, which stands on its own; the lift is tried again each
     * time the checklist is read.
     *
     * Recorded as the system. Each person's step was a member of staff's
     * to record and is on the trail under their name; the application
     * following them is nobody's decision, and whoever happened to make the
     * last move, or to accept the last paper, did not move the file.
     */
    private static function liftFile(CipApplication $application): CipApplication
    {
        $steps = [];
        foreach (self::OWN_STEPS as $key => $step) {
            $steps[$step['from']] = $key;
        }

        for ($i = 0; $i < count(self::OWN_STEPS); $i++) {
            $application = $application->fresh() ?? $application;
            $key = $steps[$application->status] ?? null;

            if ($key === null) {
                return $application;
            }

            $people = $application->people()->get()
                ->filter(fn (CipPerson $person) => $person->post_approval_apart === null);

            /*
             * Everybody with papers in this step, that is. A child under 16
             * has no NIC to apply for and a sponsor has nothing at all, so
             * neither has a day of their own to record and neither may hold
             * the file on a step the rest of the family has left. If nobody
             * has papers in it there is nobody to have gone ahead.
             */
            $about = self::OWN_STEPS[$key]['about'];
            $people = $people->filter(fn (CipPerson $person) => self::owes($person, $application, $about));

            if ($people->isEmpty()) {
                return $application;
            }

            $rank = self::RANK[$application->status];
            $ahead = $people->every(fn (CipPerson $person) => (self::RANK[self::ownStage($person) ?? ''] ?? -1) > $rank);

            if (! $ahead) {
                return $application;
            }

            $step = self::OWN_STEPS[$key];

            // NIC Received → Apply for Passport records no Unit date. The
            // file follows its people the way a dated step does, through
            // the ordinary transition.
            if (($step['dated'] ?? true) === false) {
                try {
                    $application = Engine::apply($application, $step['to'], null);
                } catch (\InvalidArgumentException|AuthorizationException) {
                    return $application;
                }

                continue;
            }

            $latest = $people
                ->map(fn (CipPerson $person) => self::dates($person)[$key] ?? null)
                ->filter()
                ->max();

            try {
                $application = Stages::record($application, null, $key, $latest ? Carbon::parse($latest) : Carbon::now());
            } catch (\InvalidArgumentException|AuthorizationException) {
                return $application;
            }
        }

        return $application;
    }

    /* ── documents ─────────────────────────────────── */

    /**
     * One person's count for one pack, or null when they owe nothing in it.
     *
     * @return array<string, array{total:int, required:int}>|null
     */
    private static function tally(CipPerson $person, CipApplication $application, string $pack, bool $fresh = false): ?array
    {
        if ($fresh) {
            Review::forgetTally($application);
        }

        return Review::tallyByPerson($application, $pack)[(int) $person->getKey()] ?? null;
    }

    /**
     * Every required document accepted, and nothing uploaded still unread
     * or refused: the same test {@see Review::packageReady()} puts to the
     * whole file, asked of one person. Owing nothing is ready.
     *
     * @param  array<string, array{total:int, required:int}>|null  $tally
     */
    private static function ready(?array $tally): bool
    {
        if ($tally === null) {
            return true;
        }

        return $tally[DocumentStatus::UPDATE_REQUIRED]['total'] === 0
            && $tally[DocumentStatus::APPLICATION_REVIEW]['total'] === 0
            && $tally[DocumentStatus::READY_FOR_SUBMISSION]['required'] === array_sum(array_column($tally, 'required'));
    }

    /** The refusal for a submission whose documents are not ready, by name. */
    private static function notReady(CipPerson $person, CipApplication $application, string $pack): NotReady
    {
        $rows = Review::blockerRowsFor($application, $pack, $person);

        return $rows === []
            ? new NotReady('Every document must be Ready for submission before this step can be recorded.')
            : new NotReady(
                'Not yet Ready for submission: '.implode('; ', Review::blockersFor($application, $pack, $person)).'.',
                $rows,
            );
    }

    /** Why a status that is on the lane is not this person's to be given now. */
    private static function refusal(CipPerson $person, CipApplication $application, string $to): string
    {
        $name = $person->fullName() ?: 'This person';

        if ($person->post_approval_apart !== null && self::missedThePackage($person)) {
            return $name.' cannot rejoin this application; it has moved on without their documents.';
        }

        if ($to === self::UPDATE_REQUIRED) {
            return 'Send a document back to put '.$name.' on Updates Required.';
        }

        if ($to === self::APPLY_FOR_COR) {
            return $name.' moves to Apply for COR when every one of their documents is Ready for submission.';
        }

        // The decision and the Certificate of Registration belong to the
        // file: one letter, one package, confirmed and locked once.
        if (in_array($to, [self::POST_APPROVAL, self::POST_APPROVED, self::PENDING_COR, self::COR_RECEIVED, self::APPLY_FOR_NIC], true)) {
            return Status::label($to).' is recorded on the application, for everyone on it.';
        }

        return $name.' cannot move from '.self::label(self::current($person)).' to '.self::label($to).'.';
    }

    /* ── shapes ─────────────────────────────────── */

    /** @return array<string, string> */
    private static function dates(CipPerson $person): array
    {
        $dates = $person->post_approval_dates;

        return is_array($dates) ? $dates : [];
    }

    /**
     * @param  list<string>  $statuses
     * @return list<array<string, string>>
     */
    private static function items(array $statuses): array
    {
        return array_map(fn (string $status) => self::item($status, null), array_values($statuses));
    }

    /**
     * One picker row. A dated step says which stage it records and what to
     * call its date, so the dialog asks for the day rather than assuming it.
     *
     * @return array<string, string>
     */
    private static function item(string $status, ?string $stage): array
    {
        $item = [
            'value' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ];

        if ($stage !== null && (self::OWN_STEPS[$stage]['dated'] ?? true)) {
            $item['stage'] = $stage;
            $item['dateLabel'] = Stages::dateLabel($stage) ?? 'Date';
        }

        return $item;
    }
}
