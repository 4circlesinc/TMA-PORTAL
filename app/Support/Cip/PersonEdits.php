<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\CipPersonChangeRequest;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Correcting a person's details on a post-approval file.
 *
 * Confirm submission freezes the package the Unit was handed, and for a long
 * time that freeze also held every name, date and passport number on the
 * file. It should not: the scans are what the Unit received, but a misspelt
 * name is simply wrong, and after the decision the firm is the party carrying
 * the file. So details become editable again once a file reaches
 * post-approval, and the freeze goes on protecting the documents.
 *
 * Who may do what, and why:
 *
 *   - An ADMINISTRATOR edits directly. They are the authority the rest of the
 *     module already defers to (section 26's overrides are theirs alone).
 *   - EVERYONE ELSE who can reach the file proposes: employees, officers, and
 *     the service provider contact who filed it. Their edit is written as a
 *     request, the value does not move, and an administrator approves it.
 *
 * A request is one proposal covering however many fields, not one per field:
 * a correction is usually "this person was entered from the wrong passport",
 * and approving half of that is not a decision anybody wants to make.
 */
class PersonEdits
{
    /** The fields a request may carry. The intake form's own person set. */
    public const FIELDS = [
        'firstName', 'lastName', 'gender', 'dateOfBirth',
        'countryOfBirth', 'countryOfResidence', 'occupation', 'passportNumber',
    ];

    /** camelCase field => the column it writes. */
    private const COLUMNS = [
        'firstName' => 'first_name',
        'lastName' => 'last_name',
        'gender' => 'gender',
        'dateOfBirth' => 'date_of_birth',
        'countryOfBirth' => 'country_of_birth',
        'countryOfResidence' => 'country_of_residence',
        'occupation' => 'occupation',
        'passportNumber' => 'passport_number',
    ];

    /**
     * Is this file one whose people may be corrected at all?
     *
     * Post-approval only. Before the decision the intake form already owns
     * these fields and the filing party edits them there.
     */
    public static function open(?CipApplication $application): bool
    {
        return $application !== null
            && ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL;
    }

    /** Does this reader's edit land straight on the record? */
    public static function editsDirectly(?User $user, ?CipApplication $application): bool
    {
        return self::open($application)
            && $user !== null
            && CipAccess::enabled()
            && Role::isAdmin($user);
    }

    /** May this reader at least propose a correction? */
    public static function mayPropose(?User $user, ?CipApplication $application): bool
    {
        if (! self::open($application) || $user === null || ! CipAccess::enabled()) {
            return false;
        }

        // Anyone the scope already lets near this file. Being able to read it
        // is the test, so a stranger cannot propose their way into knowing it
        // exists, and the provider side keeps a voice on their own filing.
        return ApplicationScope::query($user)->whereKey($application->getKey())->exists();
    }

    /**
     * Apply a correction, or record the ask.
     *
     * Returns the request when one was written, and null when the values went
     * straight onto the person — which is how a caller knows what to say.
     *
     * @param  array<string, mixed>  $changes  camelCase field => new value
     *
     * @throws AuthorizationException
     * @throws \InvalidArgumentException
     */
    public static function submit(
        CipPerson $person,
        User $actor,
        array $changes,
        ?string $note = null,
    ): ?CipPersonChangeRequest {
        $person->loadMissing('application');
        $application = $person->application;

        if (! self::open($application)) {
            throw new \InvalidArgumentException(
                'These details can only be corrected once the file is in post-approval.',
            );
        }

        if (! self::mayPropose($actor, $application)) {
            throw new AuthorizationException('You cannot change this person.');
        }

        $changes = self::clean($changes, $person);

        if ($changes === []) {
            throw new \InvalidArgumentException('Nothing was changed.');
        }

        if (self::editsDirectly($actor, $application)) {
            self::write($person, $changes, $actor, approvedRequest: null);

            return null;
        }

        return DB::transaction(function () use ($person, $application, $actor, $changes, $note) {
            /*
             * One open request per person. A second proposal replaces the
             * first rather than queueing behind it: the person asking has the
             * newer picture, and an approver reading two half-corrections
             * would have to reconcile them by hand.
             */
            CipPersonChangeRequest::query()
                ->where('person_id', $person->id)
                ->where('status', CipPersonChangeRequest::STATUS_PENDING)
                ->update([
                    'status' => CipPersonChangeRequest::STATUS_DECLINED,
                    'decided_by' => $actor->id,
                    'decided_at' => Carbon::now(),
                    'decision_note' => 'Replaced by a newer request.',
                ]);

            $request = CipPersonChangeRequest::create([
                'application_id' => $application->id,
                'person_id' => $person->id,
                'requested_by' => $actor->id,
                'changes' => $changes,
                'before' => self::snapshot($person, array_keys($changes)),
                'note' => trim((string) $note) ?: null,
            ]);

            Engine::record($application, CipEvent::ACTION_PERSON_CHANGE_REQUESTED, $actor, [
                'person' => $person->uuid,
                'fields' => array_keys($changes),
            ]);

            Notices::personChangeRequested($application, $person, $actor, $request);

            return $request;
        });
    }

    /**
     * An administrator's answer.
     *
     * @throws AuthorizationException
     */
    public static function decide(
        CipPersonChangeRequest $request,
        User $actor,
        bool $approve,
        ?string $note = null,
    ): CipPersonChangeRequest {
        if (! Role::isAdmin($actor)) {
            throw new AuthorizationException('Only an administrator can answer a change request.');
        }

        if (! $request->isPending()) {
            return $request;
        }

        return DB::transaction(function () use ($request, $actor, $approve, $note) {
            $request->loadMissing(['person', 'application']);

            if ($approve && $request->person) {
                self::write($request->person, $request->changes ?? [], $actor, approvedRequest: $request);
            }

            $request->forceFill([
                'status' => $approve
                    ? CipPersonChangeRequest::STATUS_APPROVED
                    : CipPersonChangeRequest::STATUS_DECLINED,
                'decided_by' => $actor->id,
                'decided_at' => Carbon::now(),
                'decision_note' => trim((string) $note) ?: null,
            ])->save();

            Notices::personChangeDecided($request->fresh()->loadMissing(['person', 'application']), $actor);

            return $request->fresh();
        });
    }

    /**
     * Open requests on a file, for the badge and the approver's list.
     *
     * @return list<array<string, mixed>>
     */
    public static function pending(CipApplication $application): array
    {
        return CipPersonChangeRequest::query()
            ->where('application_id', $application->id)
            ->where('status', CipPersonChangeRequest::STATUS_PENDING)
            ->with(['requester:id,name', 'person:id,uuid,first_name,last_name'])
            ->orderBy('id')
            ->get()
            ->map(fn (CipPersonChangeRequest $r) => [
                'id' => $r->uuid,
                'person' => $r->person?->uuid,
                'personName' => trim(($r->person?->first_name ?? '').' '.($r->person?->last_name ?? '')) ?: null,
                'by' => $r->requester?->name,
                'at' => $r->created_at?->toIso8601String(),
                'note' => $r->note,
                'changes' => self::describe($r),
            ])
            ->all();
    }

    /**
     * The proposal as label => [from, to], for an approver reading a diff.
     *
     * @return array<string, array{from:?string, to:?string}>
     */
    public static function describe(CipPersonChangeRequest $request): array
    {
        $before = $request->before ?? [];
        $out = [];

        foreach (($request->changes ?? []) as $field => $to) {
            $out[$field] = [
                'from' => self::text($before[$field] ?? null),
                'to' => self::text($to),
            ];
        }

        return $out;
    }

    /**
     * Write the values, and say so on the timeline.
     *
     * @param  array<string, mixed>  $changes
     */
    private static function write(
        CipPerson $person,
        array $changes,
        User $actor,
        ?CipPersonChangeRequest $approvedRequest,
    ): void {
        $before = self::snapshot($person, array_keys($changes));
        $columns = [];

        foreach ($changes as $field => $value) {
            if (isset(self::COLUMNS[$field])) {
                $columns[self::COLUMNS[$field]] = $value;
            }
        }

        if ($columns === []) {
            return;
        }

        $person->forceFill($columns)->save();

        $person->loadMissing('application');
        Engine::record(
            $person->application,
            CipEvent::ACTION_PERSON_CHANGED,
            $actor,
            array_filter([
                'person' => $person->uuid,
                'fields' => array_keys($changes),
                'before' => $before,
                'after' => $changes,
                'request' => $approvedRequest?->uuid,
            ]),
        );
    }

    /**
     * Keep the known fields, drop the ones that are not actually changing.
     *
     * @param  array<string, mixed>  $changes
     * @return array<string, mixed>
     */
    private static function clean(array $changes, CipPerson $person): array
    {
        $out = [];

        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $changes)) {
                continue;
            }

            $value = $changes[$field];
            $value = is_string($value) ? trim($value) : $value;
            $value = $value === '' ? null : $value;

            // A field sent back unchanged is not a correction, and an approver
            // should not have to read it as one.
            if (self::text($value) === self::text($person->{self::COLUMNS[$field]} ?? null)) {
                continue;
            }

            $out[$field] = $value;
        }

        return $out;
    }

    /**
     * @param  list<string>  $fields
     * @return array<string, mixed>
     */
    private static function snapshot(CipPerson $person, array $fields): array
    {
        $out = [];

        foreach ($fields as $field) {
            if (isset(self::COLUMNS[$field])) {
                $out[$field] = self::text($person->{self::COLUMNS[$field]} ?? null);
            }
        }

        return $out;
    }

    /** Dates and everything else as one comparable string. */
    private static function text(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return (string) $value;
    }
}
