<?php

namespace App\Support\Cip;

use App\Models\CipPerson;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * Post-approval workflow status for one person on an application.
 *
 * Separate from {@see Status}, which describes the whole file through
 * pre-approval and ends at Granted/Denied. After approval each family
 * member has their own lane here.
 *
 * The vocabulary is intentionally small for now; administrators may set
 * any listed value directly (see spec §7). A transition map can tighten
 * employee choices once the final status list is confirmed.
 */
class PersonStatus
{
    public const NOT_STARTED = 'not_started';

    public const DOCUMENTS_PENDING = 'documents_pending';

    public const DOCUMENTS_IN_REVIEW = 'documents_in_review';

    public const UPDATE_REQUIRED = 'update_required';

    public const READY_FOR_SUBMISSION = 'ready_for_submission';

    public const PROCESSING = 'processing';

    public const COMPLETED = 'completed';

    public const ALL = [
        self::NOT_STARTED,
        self::DOCUMENTS_PENDING,
        self::DOCUMENTS_IN_REVIEW,
        self::UPDATE_REQUIRED,
        self::READY_FOR_SUBMISSION,
        self::PROCESSING,
        self::COMPLETED,
    ];

    private const LABELS = [
        self::NOT_STARTED => 'Not started',
        self::DOCUMENTS_PENDING => 'Documents pending',
        self::DOCUMENTS_IN_REVIEW => 'Documents in review',
        self::UPDATE_REQUIRED => 'Update required',
        self::READY_FOR_SUBMISSION => 'Ready for submission',
        self::PROCESSING => 'Processing',
        self::COMPLETED => 'Completed',
    ];

    private const TONES = [
        self::NOT_STARTED => 'neutral',
        self::DOCUMENTS_PENDING => 'neutral',
        self::DOCUMENTS_IN_REVIEW => 'pending',
        self::UPDATE_REQUIRED => 'danger',
        self::READY_FOR_SUBMISSION => 'teal',
        self::PROCESSING => 'indigo',
        self::COMPLETED => 'success',
    ];

    /** from => the statuses an officer may move to. Admins may set any. */
    private const TRANSITIONS = [
        self::NOT_STARTED => [self::DOCUMENTS_PENDING],
        self::DOCUMENTS_PENDING => [self::DOCUMENTS_IN_REVIEW],
        self::DOCUMENTS_IN_REVIEW => [self::UPDATE_REQUIRED, self::READY_FOR_SUBMISSION],
        self::UPDATE_REQUIRED => [self::DOCUMENTS_IN_REVIEW],
        self::READY_FOR_SUBMISSION => [self::PROCESSING],
        self::PROCESSING => [self::COMPLETED],
        self::COMPLETED => [],
    ];

    public static function isValid(string $status): bool
    {
        return in_array($status, self::ALL, true);
    }

    public static function label(string $status): string
    {
        return self::LABELS[$status] ?? $status;
    }

    public static function tone(string $status): string
    {
        return self::TONES[$status] ?? 'neutral';
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
     * The chip one person wears in post-approval.
     *
     * @return array{status:string,statusLabel:string,statusTone:string}
     */
    public static function forPerson(CipPerson $person): array
    {
        $stored = $person->post_approval_status;
        $status = ($stored !== null && self::isValid($stored))
            ? $stored
            : self::NOT_STARTED;

        $badge = self::badge($status);

        return [
            'status' => $badge['status'],
            'statusLabel' => $badge['label'],
            'statusTone' => $badge['tone'],
        ];
    }

    /**
     * Every status the picker may offer.
     *
     * @return list<array{value:string,label:string,tone:string}>
     */
    public static function listed(): array
    {
        return array_map(fn (string $status) => [
            'value' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ], self::ALL);
    }

    public static function current(CipPerson $person): string
    {
        $stored = $person->post_approval_status;

        return ($stored !== null && self::isValid($stored))
            ? $stored
            : self::NOT_STARTED;
    }

    public static function canTransition(CipPerson $person, string $to): bool
    {
        return self::isValid($to)
            && in_array($to, self::TRANSITIONS[self::current($person)] ?? [], true);
    }

    /**
     * @return list<array{value:string,label:string,tone:string}>
     */
    public static function availableTransitions(CipPerson $person, ?User $actor): array
    {
        if ($actor && ! CipAccess::canChangeApplicationStatus($actor)) {
            return [];
        }

        return self::present(self::TRANSITIONS[self::current($person)] ?? []);
    }

    /**
     * @return list<array{value:string,label:string,tone:string}>
     */
    public static function availableOverrides(CipPerson $person, ?User $actor): array
    {
        if (! CipAccess::canOverrideStatus($actor)) {
            return [];
        }

        $current = self::current($person);
        $next = self::TRANSITIONS[$current] ?? [];

        return self::present(array_values(array_filter(
            self::ALL,
            fn (string $status) => $status !== $current && ! in_array($status, $next, true),
        )));
    }

    public static function assertMayMove(CipPerson $person, string $to, ?User $actor): void
    {
        if (! self::isValid($to)) {
            throw new \InvalidArgumentException(self::label($to).' is not a person status.');
        }

        if (self::current($person) === $to) {
            return;
        }

        if (self::canTransition($person, $to)) {
            if ($actor && ! CipAccess::canChangeApplicationStatus($actor)) {
                throw new AuthorizationException(
                    'You cannot move this person to '.self::label($to).'.'
                );
            }

            return;
        }

        if (! CipAccess::canOverrideStatus($actor)) {
            throw new AuthorizationException(
                'Only an administrator can pull a person back to an earlier status.'
            );
        }
    }

    /**
     * @param  list<string>  $statuses
     * @return list<array{value:string,label:string,tone:string}>
     */
    private static function present(array $statuses): array
    {
        return array_map(fn (string $status) => [
            'value' => $status,
            'label' => self::label($status),
            'tone' => self::tone($status),
        ], $statuses);
    }
}
