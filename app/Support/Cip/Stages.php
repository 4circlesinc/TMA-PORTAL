<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Date-driven hops after Apply for COR (brief section 6–section 12).
 *
 * Each step is a date the Unit or the firm recorded, and the status that
 * date moves the file to. The generic status picker refuses these targets
 * so a bare chip cannot leave the date empty.
 */
class Stages
{
    public const COR_SUBMITTED = 'cor_submitted';

    public const COR_RECEIVED = 'cor_received';

    public const NIC_SUBMITTED = 'nic_submitted';

    public const NIC_RECEIVED = 'nic_received';

    public const PASSPORT_SUBMITTED = 'passport_submitted';

    public const PASSPORT_RECEIVED = 'passport_received';

    public const PASSPORT_DELIVERED = 'passport_delivered';

    /**
     * `from` is the one status a step is recorded from. The map has other
     * edges into some of these destinations, the checklist's own return from
     * Updates Required to Apply for NIC for one, and a step offered along
     * those was the COR received date being asked for a second time.
     *
     * `subject` is what section 22's worked examples put in the subject line
     * for a receipt: COR RECEIVED, not the status the file moves on to.
     *
     * @var array<string, array{
     *     from: string,
     *     to: string,
     *     subject?: string,
     *     column: string,
     *     action: string,
     *     label: string,
     *     button: string,
     *     dateLabel: string,
     *     note: string,
     *     lock?: string
     * }>
     */
    private const STEPS = [
        self::COR_SUBMITTED => [
            'from' => Status::APPLY_FOR_COR,
            'to' => Status::PENDING_COR,
            'column' => 'cor_submitted_at',
            'action' => CipEvent::ACTION_COR_SUBMITTED,
            'label' => 'COR submission',
            'button' => 'Record COR submission',
            'dateLabel' => 'COR submission date',
            'note' => 'The application will move to Pending COR.',
            'lock' => 'cor',
        ],
        self::COR_RECEIVED => [
            'from' => Status::PENDING_COR,
            'to' => Status::APPLY_FOR_NIC,
            'subject' => 'COR RECEIVED',
            'column' => 'cor_received_at',
            'action' => CipEvent::ACTION_COR_RECEIVED,
            'label' => 'COR received',
            'button' => 'Record COR received',
            'dateLabel' => 'COR received date',
            'note' => 'The application will move to Apply for NIC.',
        ],
        self::NIC_SUBMITTED => [
            'from' => Status::APPLY_FOR_NIC,
            'to' => Status::PENDING_NIC,
            'column' => 'nic_submitted_at',
            'action' => CipEvent::ACTION_NIC_SUBMITTED,
            'label' => 'NIC submission',
            'button' => 'Record NIC submission',
            'dateLabel' => 'NIC submission date',
            'note' => 'The application will move to Pending NIC.',
        ],
        self::NIC_RECEIVED => [
            'from' => Status::PENDING_NIC,
            'to' => Status::APPLY_FOR_PASSPORT,
            'subject' => 'NIC RECEIVED',
            'column' => 'nic_received_at',
            'action' => CipEvent::ACTION_NIC_RECEIVED,
            'label' => 'NIC received',
            'button' => 'Record NIC received',
            'dateLabel' => 'NIC received date',
            'note' => 'The application will move to Apply for Passport.',
        ],
        self::PASSPORT_SUBMITTED => [
            'from' => Status::APPLY_FOR_PASSPORT,
            'to' => Status::PENDING_PASSPORT,
            'column' => 'passport_submitted_at',
            'action' => CipEvent::ACTION_PASSPORT_SUBMITTED,
            'label' => 'Passport application',
            'button' => 'Record passport application',
            'dateLabel' => 'Passport application date',
            'note' => 'The application will move to Pending Passport.',
        ],
        self::PASSPORT_RECEIVED => [
            'from' => Status::PENDING_PASSPORT,
            'to' => Status::READY_FOR_DELIVERY,
            'subject' => 'PASSPORT RECEIVED',
            'column' => 'passport_received_at',
            'action' => CipEvent::ACTION_PASSPORT_RECEIVED,
            'label' => 'Passport received',
            'button' => 'Record passport received',
            'dateLabel' => 'Passport received date',
            'note' => 'The application will move to Ready for Delivery.',
        ],
        self::PASSPORT_DELIVERED => [
            'from' => Status::READY_FOR_DELIVERY,
            'to' => Status::CLOSED,
            'column' => 'passport_delivered_at',
            'action' => CipEvent::ACTION_PASSPORT_DELIVERED,
            'label' => 'Passport delivered',
            'button' => 'Record passport delivered',
            'dateLabel' => 'Passport delivered date',
            'note' => 'The application will move to Closed.',
        ],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::STEPS);
    }

    /** @return list<string> */
    public static function destinations(): array
    {
        return array_values(array_map(fn (array $step) => $step['to'], self::STEPS));
    }

    /**
     * Dates and the next Record button, for any payload that draws this file.
     *
     * @return array<string, mixed>
     */
    public static function into(CipApplication $application, ?User $actor): array
    {
        $action = self::payload($application, $actor);

        return [
            ...self::dates($application),
            'stageAction' => $action,
            'stageHold' => $action === null ? self::hold($application, $actor) : null,
        ];
    }

    /**
     * What section 22's worked examples call this step in a subject line.
     *
     * Only a receipt has a name of its own there: COR RECEIVED, NIC
     * RECEIVED, PASSPORT RECEIVED. Every other step is announced by the
     * status the file moves to, so this is null for them.
     */
    public static function subject(?string $key): ?string
    {
        return $key !== null ? (self::STEPS[$key]['subject'] ?? null) : null;
    }

    /** What the date of one step is called, for a dialog that asks for it. */
    public static function dateLabel(string $key): ?string
    {
        return self::STEPS[$key]['dateLabel'] ?? null;
    }

    public static function owns(string $status): bool
    {
        return in_array($status, self::destinations(), true);
    }

    public static function refusal(string $status): string
    {
        foreach (self::STEPS as $step) {
            if ($step['to'] === $status) {
                return 'Record the '.lcfirst($step['dateLabel']).' instead, so the day and the status go together.';
            }
        }

        return 'Record the date for this step instead, so the day and the status go together.';
    }

    /**
     * The next date verb this reader may press, or null.
     *
     * @return array{key:string, label:string, dateLabel:string, note:string}|null
     */
    public static function payload(CipApplication $application, ?User $actor): ?array
    {
        if ($actor === null) {
            return null;
        }

        /*
         * A denied file has no stages left.
         *
         * It still closes — that edge is on the map — but not by recording
         * the delivery of a passport nobody was issued. Every step here is a
         * thing that happened to a file working its way through; a refused
         * one skipped all of them, so it is closed from the status picker
         * instead.
         */
        if ($application->status === Status::POST_DENIED || $application->status === Status::DENIED) {
            return null;
        }

        foreach (self::STEPS as $key => $step) {
            if ($application->status !== $step['from']) {
                continue;
            }

            if (! Engine::canTransition($application, $step['to'])) {
                continue;
            }

            if (! Engine::allows($actor, $application, $step['to'])) {
                continue;
            }

            if (($step['lock'] ?? null) === 'cor' && ! $application->isCorLocked()) {
                continue;
            }

            return [
                'key' => $key,
                // Where the step lands, so a status menu can offer it on
                // that row and ask for the day as it is pressed.
                'to' => $step['to'],
                'label' => $step['button'],
                'dateLabel' => $step['dateLabel'],
                'note' => $step['note'],
            ];
        }

        return null;
    }

    /**
     * Why no date can be recorded yet, in one short sentence, or null.
     *
     * A status menu draws the dated steps greyed until they can be taken,
     * and a column of grey rows with nothing beside it read as a menu that
     * was broken. Each of these is something the file is waiting on, and
     * who it is waiting on is the whole answer.
     *
     * Asked only when {@see payload()} has nothing to offer, and only of
     * the stretches where the reason is one of these two: papers still to
     * be accepted, or the package still to be confirmed. A file waiting on
     * the Unit has its button; a denied or closed one has no step left.
     *
     * @return array{to:string, note:string}|null
     */
    public static function hold(CipApplication $application, ?User $actor): ?array
    {
        if ($actor === null
            || ($application->phase ?? Phase::PRE_APPROVAL) !== Phase::POST_APPROVAL
            || ! CipAccess::canChangeApplicationStatus($actor)) {
            return null;
        }

        $status = $application->status;

        if ($status === Status::APPLY_FOR_COR && ! $application->isCorLocked()) {
            return [
                'to' => Status::PENDING_COR,
                'note' => Confirmation::allows($actor, $application)
                    ? 'Confirm submission first.'
                    : 'Waiting for the service provider to confirm submission.',
            ];
        }

        if (! in_array($status, [Status::POST_APPROVAL, Status::POST_APPROVED, Status::UPDATE_REQUIRED], true)) {
            return null;
        }

        // Said only while it is true. A file put on Updates Required by
        // hand may have every paper accepted, and is waiting on no document.
        if (Review::packageReady($application)) {
            return null;
        }

        $to = match (Pack::current($application)) {
            Pack::PASSPORT => Status::PENDING_PASSPORT,
            Pack::NIC => Status::PENDING_NIC,
            default => Status::PENDING_COR,
        };

        return [
            'to' => $to,
            'note' => 'Every document must be Ready for submission first.',
        ];
    }

    /**
     * @return array<string, ?string>
     */
    public static function dates(CipApplication $application): array
    {
        return [
            'corSubmittedAt' => $application->cor_submitted_at?->toDateString(),
            'corReceivedAt' => $application->cor_received_at?->toDateString(),
            'corNumber' => $application->cor_number,
            'nicSubmittedAt' => $application->nic_submitted_at?->toDateString(),
            'nicReceivedAt' => $application->nic_received_at?->toDateString(),
            'passportSubmittedAt' => $application->passport_submitted_at?->toDateString(),
            'passportReceivedAt' => $application->passport_received_at?->toDateString(),
            'passportDeliveredAt' => $application->passport_delivered_at?->toDateString(),
        ];
    }

    /**
     * Write the date and move the file.
     *
     * Idempotent when the file already stands at the destination: a second
     * press updates the day rather than sending a second notice.
     *
     * A null actor is the system: the application following people who have
     * each had the step recorded on their own ({@see PersonStatus}).
     */
    public static function record(
        CipApplication $application,
        ?User $actor,
        string $key,
        ?Carbon $date = null,
        ?string $corNumber = null,
    ): CipApplication {
        $step = self::STEPS[$key] ?? null;

        if ($step === null) {
            throw new \InvalidArgumentException('That is not a post-approval step this application can record.');
        }

        /*
         * Asked here as well as by the engine, because the engine is only
         * reached when the file moves. Pressing a step the file already
         * stands on rewrites its day and moves nothing, and that path let
         * anybody who could open the file change a date the firm recorded.
         */
        if ($actor !== null && ! Engine::allows($actor, $application, $step['to'])) {
            throw new AuthorizationException('You cannot record this step on this application.');
        }

        /*
         * A file closed with no delivery on record was closed some other
         * way: the lane denied it, and it was closed from the status menu
         * with a reason. Pressing this step on it would be taken for a
         * correction of the day and write a passport onto the timeline of a
         * refusal. Read off the file as it stands, not off the decision
         * column, which a denial that was later undone still carries.
         */
        if ($key === self::PASSPORT_DELIVERED
            && $application->status === Status::CLOSED
            && $application->passport_delivered_at === null) {
            throw new \InvalidArgumentException('This application was closed without a passport delivery.');
        }

        if (($step['lock'] ?? null) === 'cor' && ! $application->isCorLocked()) {
            throw new \InvalidArgumentException(
                'The service provider must confirm submission before the COR package can be sent.',
            );
        }

        /*
         * Sending a pack to the Unit requires the pack. Each *_submitted step
         * hands over the current stage's documents, so every required slot,
         * and every document that has been uploaded, has to stand at Ready
         * for submission first. A pack the administrators have written no
         * requirements for owes nothing and may move, unless something
         * uploaded is still in Application review or Update required.
         */
        if (in_array($key, [self::COR_SUBMITTED, self::NIC_SUBMITTED, self::PASSPORT_SUBMITTED], true)
            && ! Review::packageReady($application)) {
            throw new NotReady(
                'Every required document, and every document that has been uploaded, must be Ready for submission before this stage can be recorded.',
                Review::blockerRows($application),
            );
        }

        $date ??= Carbon::now();
        $already = $application->status === $step['to'];

        if (! $already
            && ($application->status !== $step['from'] || ! Engine::canTransition($application, $step['to']))) {
            throw new \InvalidArgumentException(sprintf(
                'A %s date cannot be recorded while this application stands at %s.',
                lcfirst($step['label']),
                Status::label($application->status),
            ));
        }

        return DB::transaction(function () use ($application, $actor, $step, $date, $already, $key, $corNumber) {
            $fill = [$step['column'] => $date->startOfDay()];
            if ($key === self::COR_RECEIVED) {
                $number = trim((string) $corNumber);
                if ($number !== '') {
                    $fill['cor_number'] = $number;
                }
            }
            $application->forceFill($fill)->save();

            $meta = [
                'stage' => $key,
                'date' => $date->toDateString(),
            ];

            if (! $already) {
                Engine::apply($application, $step['to'], $actor, $meta);
            }

            Engine::record($application, $step['action'], $actor, $meta);

            return $application->refresh();
        });
    }
}
