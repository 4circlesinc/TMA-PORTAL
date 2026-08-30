<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Date-driven hops after Apply for COR (brief §6–§12).
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
     * @var array<string, array{
     *     to: string,
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
            'to' => Status::APPLY_FOR_NIC,
            'column' => 'cor_received_at',
            'action' => CipEvent::ACTION_COR_RECEIVED,
            'label' => 'COR received',
            'button' => 'Record COR received',
            'dateLabel' => 'COR received date',
            'note' => 'The application will move to Apply for NIC.',
        ],
        self::NIC_SUBMITTED => [
            'to' => Status::PENDING_NIC,
            'column' => 'nic_submitted_at',
            'action' => CipEvent::ACTION_NIC_SUBMITTED,
            'label' => 'NIC submission',
            'button' => 'Record NIC submission',
            'dateLabel' => 'NIC submission date',
            'note' => 'The application will move to Pending NIC.',
        ],
        self::NIC_RECEIVED => [
            'to' => Status::APPLY_FOR_PASSPORT,
            'column' => 'nic_received_at',
            'action' => CipEvent::ACTION_NIC_RECEIVED,
            'label' => 'NIC received',
            'button' => 'Record NIC received',
            'dateLabel' => 'NIC received date',
            'note' => 'The application will move to Apply for Passport.',
        ],
        self::PASSPORT_SUBMITTED => [
            'to' => Status::PENDING_PASSPORT,
            'column' => 'passport_submitted_at',
            'action' => CipEvent::ACTION_PASSPORT_SUBMITTED,
            'label' => 'Passport application',
            'button' => 'Record passport application',
            'dateLabel' => 'Passport application date',
            'note' => 'The application will move to Pending Passport.',
        ],
        self::PASSPORT_RECEIVED => [
            'to' => Status::READY_FOR_DELIVERY,
            'column' => 'passport_received_at',
            'action' => CipEvent::ACTION_PASSPORT_RECEIVED,
            'label' => 'Passport received',
            'button' => 'Record passport received',
            'dateLabel' => 'Passport received date',
            'note' => 'The application will move to Ready for Delivery.',
        ],
        self::PASSPORT_DELIVERED => [
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
        return [
            ...self::dates($application),
            'stageAction' => self::payload($application, $actor),
        ];
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

        foreach (self::STEPS as $key => $step) {
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
                'label' => $step['button'],
                'dateLabel' => $step['dateLabel'],
                'note' => $step['note'],
            ];
        }

        return null;
    }

    /**
     * @return array<string, ?string>
     */
    public static function dates(CipApplication $application): array
    {
        return [
            'corSubmittedAt' => $application->cor_submitted_at?->toDateString(),
            'corReceivedAt' => $application->cor_received_at?->toDateString(),
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
     */
    public static function record(
        CipApplication $application,
        User $actor,
        string $key,
        ?Carbon $date = null,
    ): CipApplication {
        $step = self::STEPS[$key] ?? null;

        if ($step === null) {
            throw new \InvalidArgumentException('That is not a post-approval step this application can record.');
        }

        if (($step['lock'] ?? null) === 'cor' && ! $application->isCorLocked()) {
            throw new \InvalidArgumentException(
                'The service provider must confirm submission before the COR package can be sent.',
            );
        }

        $date ??= Carbon::now();
        $already = $application->status === $step['to'];

        if (! $already && ! Engine::canTransition($application, $step['to'])) {
            throw new \InvalidArgumentException(sprintf(
                'A %s date cannot be recorded while this application stands at %s.',
                lcfirst($step['label']),
                Status::label($application->status),
            ));
        }

        return DB::transaction(function () use ($application, $actor, $step, $date, $already, $key) {
            $application->forceFill([$step['column'] => $date->startOfDay()])->save();

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
