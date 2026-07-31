<?php

namespace App\Support\Clients;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Activity\ActivityLogger;
use App\Support\Mail\Deliveries;
use App\Support\Mail\Postcards;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * Assigning staff to clients, and everything that has to happen alongside it.
 *
 * An assignment is not just a row: it grants file access, it decides who gets
 * told about the client's work, and — when it ends — it has to take that access
 * away again without erasing the fact that it existed. Keeping all of that here
 * means the four things that must move together (the row, the access, the
 * audit trail, the people who are told) cannot drift apart.
 */
final class Assignments
{
    /**
     * Create or update an assignment.
     *
     * Re-assigning somebody who previously left revives their old row rather
     * than stacking a second one, so their history stays in one place.
     */
    public static function assign(Client $client, User $staff, array $attrs, User $by): ClientAssignment
    {
        $existing = ClientAssignment::where('client_id', $client->id)
            ->where('user_id', $staff->id)
            ->orderByRaw("CASE WHEN status = 'active' THEN 0 ELSE 1 END")
            ->latest('id')
            ->first();

        $wasLive = $existing?->isLive() ?? false;
        $previousRole = $existing?->role;
        $previousLevel = $existing?->permission_level;

        $assignment = DB::transaction(function () use ($client, $staff, $attrs, $by, $existing) {
            $row = $existing ?? new ClientAssignment([
                'client_id' => $client->id,
                'user_id' => $staff->id,
            ]);

            $row->forceFill([
                'client_id' => $client->id,
                'user_id' => $staff->id,
                'role' => $attrs['role'] ?? $row->role ?? 'general',
                'permission_level' => $attrs['level'] ?? $row->permission_level ?? 'view_files',
                // Always written, never inferred: a fresh row has no value for
                // this yet, and reading it back as null breaks everything
                // downstream that expects a boolean.
                'is_primary' => (bool) ($attrs['primary'] ?? $row->is_primary ?? false),
                'status' => ClientAssignment::STATUS_ACTIVE,
                'assigned_by' => $by->id,
                'starts_at' => $attrs['startsAt'] ?? null,
                'ends_at' => $attrs['endsAt'] ?? null,
                'notes' => $attrs['notes'] ?? null,
                // Reviving an ended assignment clears how it ended.
                'ended_at' => null,
                'ended_by' => null,
            ])->save();

            if ($row->is_primary) {
                self::makePrimary($client, $row);
            }

            return $row;
        });

        // A level or role change on a live assignment is a change, not a new
        // ask — the person is already working with this client and does not
        // need welcoming again.
        if (! $wasLive) {
            self::announceAssigned($client, $assignment, $by);
        } elseif ($previousRole !== $assignment->role || $previousLevel !== $assignment->permission_level) {
            self::announceChanged($client, $assignment, $by, $previousRole, $previousLevel);
        }

        return $assignment->fresh();
    }

    /**
     * End an assignment. The row stays — it is the record that this person
     * looked after this client — but the access goes immediately.
     */
    public static function end(Client $client, ClientAssignment $assignment, User $by, ?string $reason = null): ClientAssignment
    {
        $assignment->forceFill([
            'status' => ClientAssignment::STATUS_ENDED,
            'ended_at' => now(),
            'ended_by' => $by->id,
            'is_primary' => false,
        ])->save();

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'client.unassigned',
            'description' => $by->name.' removed '.($assignment->user?->name ?? 'a staff member').' from '.$client->name,
            'subject' => $client,
            'client' => $client,
            'metadata' => array_filter([
                'role' => $assignment->role,
                'level' => $assignment->permission_level,
                'reason' => $reason,
            ]),
        ]);

        if ($assignment->user) {
            Notifier::send([
                'user' => $assignment->user,
                'actor' => $by,
                'type' => 'client.unassigned',
                'title' => 'You are no longer assigned to '.$client->name,
                'message' => 'Your access to their files has been removed.',
                'subject' => $client,
                'client' => $client,
            ]);
        }

        return $assignment->fresh();
    }

    /**
     * Hand a client from one staff member to another in one move, so the
     * client is told once rather than twice.
     */
    public static function reassign(Client $client, ClientAssignment $from, User $to, User $by): ClientAssignment
    {
        $attrs = [
            'role' => $from->role,
            'level' => $from->permission_level,
            'primary' => $from->is_primary,
            'notes' => $from->notes,
        ];

        self::end($client, $from, $by, 'reassigned');

        return self::assign($client, $to, $attrs, $by);
    }

    /** Exactly one primary per client. */
    public static function makePrimary(Client $client, ClientAssignment $assignment): void
    {
        ClientAssignment::where('client_id', $client->id)
            ->where('id', '!=', $assignment->id)
            ->update(['is_primary' => false]);

        if (! $assignment->is_primary) {
            $assignment->forceFill(['is_primary' => true])->save();
        }
    }

    /** Tell the staff member, the client, and the audit trail. */
    private static function announceAssigned(Client $client, ClientAssignment $assignment, User $by): void
    {
        $staff = $assignment->user;

        ActivityLogger::log([
            'actor' => $by,
            'type' => 'client.assigned',
            'description' => $by->name.' assigned '.($staff?->name ?? 'a staff member')
                .' to '.$client->name.' as '.$assignment->roleLabel(),
            'subject' => $client,
            'client' => $client,
            'metadata' => ['role' => $assignment->role, 'level' => $assignment->permission_level],
        ]);

        if (! $staff) {
            return;
        }

        Notifier::send([
            'user' => $staff,
            'actor' => $by,
            'type' => 'client.assigned',
            'title' => $by->name.' assigned you to '.$client->name,
            'message' => 'As '.$assignment->roleLabel().'.',
            'subject' => $client,
            'client' => $client,
            'action_url' => '/clients?client='.$client->uid,
        ]);

        self::emailStaff($client, $assignment, $by);
        self::tellClient($client, $assignment);
    }

    /** Told when the job changes but the person does not. */
    private static function announceChanged(
        Client $client,
        ClientAssignment $assignment,
        User $by,
        ?string $previousRole,
        ?string $previousLevel,
    ): void {
        ActivityLogger::log([
            'actor' => $by,
            'type' => 'client.assignment_changed',
            'description' => $by->name.' changed '.($assignment->user?->name ?? 'a staff member')
                .' on '.$client->name.' to '.$assignment->roleLabel(),
            'subject' => $client,
            'client' => $client,
            'old' => ['role' => $previousRole, 'level' => $previousLevel],
            'new' => ['role' => $assignment->role, 'level' => $assignment->permission_level],
        ]);

        if ($assignment->user) {
            Notifier::send([
                'user' => $assignment->user,
                'actor' => $by,
                'type' => 'client.assignment_changed',
                'title' => 'Your role on '.$client->name.' changed',
                'message' => 'You are now '.$assignment->roleLabel().'.',
                'subject' => $client,
                'client' => $client,
                'action_url' => '/clients?client='.$client->uid,
            ]);
        }
    }

    private static function emailStaff(Client $client, ClientAssignment $assignment, User $by): void
    {
        $staff = $assignment->user;

        if (! $staff?->email) {
            return;
        }

        Deliveries::send(
            Postcards::staffAssignedToClient(
                $staff->first_name ?: $staff->name,
                $client->name,
                $assignment->roleLabel(),
                $by->name,
                url('/clients?client='.$client->uid),
                $assignment->is_primary,
            ),
            $staff->email,
            $client,
            'staffAssignedToClient',
            // Inline for the same reason invitations are: this portal's queue
            // has sat undrained for days, and "you now look after this client"
            // is useless a week late. See App\Support\Invitations\Invitations.
            immediate: true,
        );
    }

    /**
     * Introduce the staff member to the client — but only once they have a
     * portal account, and only for the roles a client would expect to hear
     * about. Being told "your new finance contact is …" before you have even
     * created an account is noise.
     */
    private static function tellClient(Client $client, ClientAssignment $assignment): void
    {
        $account = $client->user;
        $staff = $assignment->user;

        if (! $account || ! $staff) {
            return;
        }

        Notifier::send([
            'user' => $account,
            'actor' => $staff,
            'type' => 'client.assigned',
            'title' => $staff->name.' is now your '.mb_strtolower($assignment->roleLabel()),
            'message' => 'You can reach them through the portal at any time.',
            'subject' => $client,
            'client' => $client,
            'action_url' => '/social/messages',
        ]);

        if ($account->email) {
            Deliveries::send(
                Postcards::clientStaffAssigned(
                    $account->first_name ?: $client->name,
                    $staff->name,
                    $assignment->roleLabel(),
                    url('/'),
                ),
                $account->email,
                $client,
                'clientStaffAssigned',
                immediate: true,
            );
        }
    }
}
