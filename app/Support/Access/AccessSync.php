<?php

namespace App\Support\Access;

use App\Models\CipApplicationAssignment;
use App\Support\Cip\Assignments;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\CompanyStaffAssignment;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Activity\ActivityLogger;

/**
 * Phase 20, keeping access in step when the thing it hangs off goes away.
 *
 * Most of the portal already revokes access the moment it should: assignments
 * are read through `live()` scopes, company shares resolve against current
 * membership, and an ended assignment stops granting anything on the next
 * request. Nothing has to run for any of that.
 *
 * Three cases are not like that, because the *subject* changes rather than the
 * grant, and every grant pointing at it has to be settled:
 *
 *  - a user is suspended , they keep rows that would work again on reinstate
 *  - a client is archived, its assignments and invitations should stop
 *  - a company is archived, the same, one level up
 *
 * Each is deliberately synchronous. The spec allows background jobs but says
 * the interface must immediately show the expected state, and for work this
 * small the honest way to guarantee that is to do it inline.
 */
final class AccessSync
{
    /**
     * A suspended account keeps nothing that would let it act.
     *
     * Assignments are ended rather than deleted, so reinstating somebody is a
     * deliberate re-assignment rather than a silent restoration of everything
     * they used to reach, which is the safer default after a suspension.
     */
    public static function userSuspended(User $user, ?User $by = null): array
    {
        $endedClients = ClientAssignment::live()->where('user_id', $user->id)->get();
        foreach ($endedClients as $assignment) {
            $assignment->forceFill([
                'status' => ClientAssignment::STATUS_ENDED,
                'is_primary' => false,
                'ended_at' => now(),
                'ended_by' => $by?->id,
            ])->save();
        }

        $endedCompanies = CompanyStaffAssignment::live()->where('user_id', $user->id)->get();
        foreach ($endedCompanies as $assignment) {
            $assignment->forceFill([
                'status' => CompanyStaffAssignment::STATUS_ENDED,
                'is_primary' => false,
                'ended_at' => now(),
                'ended_by' => $by?->id,
            ])->save();
        }

        // Company membership is suspended with the account, not erased: the
        // person still belongs to the company, they just cannot act.
        $memberships = CompanyMember::active()->where('user_id', $user->id)->get();
        foreach ($memberships as $member) {
            $member->forceFill([
                'status' => CompanyMember::STATUS_REMOVED,
                'is_primary' => false,
                'removed_at' => now(),
                'removed_by' => $by?->id,
            ])->save();
        }

        // CIP application assignments end like client assignments, reinstate
        // is a deliberate re-assignment. The officer *grant* survives, like
        // company membership: the person is still a CRO, they just cannot act.
        $endedCipFiles = CipApplicationAssignment::live()->where('user_id', $user->id)->get();
        foreach ($endedCipFiles as $assignment) {
            $assignment->end($by);

            /*
             * And the cache with it.
             *
             * `cip_applications.assigned_officer_id` is a copy of whoever holds
             * the file, and every screen reads the copy rather than the
             * assignments table. Ending the row without refreshing it left the
             * §8 table and the officer's own work queue naming a suspended
             * colleague, the file would have looked handled while nobody held
             * it.
             */
            if ($assignment->application) {
                Assignments::refreshCache($assignment->application);
            }
        }

        $summary = [
            'clientAssignments' => $endedClients->count(),
            'companyAssignments' => $endedCompanies->count(),
            'companyMemberships' => $memberships->count(),
            'cipAssignments' => $endedCipFiles->count(),
        ];

        if (array_sum($summary) > 0) {
            ActivityLogger::log([
                'actor' => $by,
                'type' => 'account.access_removed',
                'module' => 'account',
                'description' => 'Access removed for '.$user->name.' on suspension',
                'subject' => $user,
                'metadata' => $summary,
            ]);
        }

        return $summary;
    }

    /**
     * An archived client stops being worked on: its live assignments end and
     * any outstanding invitation is withdrawn, so nobody accepts an invitation
     * into a record that is no longer active.
     */
    public static function clientArchived(Client $client, ?User $by = null): array
    {
        $assignments = ClientAssignment::live()->where('client_id', $client->id)->get();
        foreach ($assignments as $assignment) {
            $assignment->forceFill([
                'status' => ClientAssignment::STATUS_ENDED,
                'is_primary' => false,
                'ended_at' => now(),
                'ended_by' => $by?->id,
            ])->save();
        }

        $invitations = Invitation::where('client_id', $client->id)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->get();

        foreach ($invitations as $invitation) {
            $invitation->forceFill([
                'status' => Invitation::STATUS_CANCELLED,
                'cancelled_at' => now(),
                'cancelled_by' => $by?->id,
            ])->save();
        }

        $summary = [
            'assignmentsEnded' => $assignments->count(),
            'invitationsCancelled' => $invitations->count(),
        ];

        if (array_sum($summary) > 0) {
            ActivityLogger::log([
                'actor' => $by,
                'type' => 'client.status_changed',
                'description' => $client->name.' was archived; access was removed',
                'subject' => $client,
                'client' => $client,
                'metadata' => $summary,
            ]);
        }

        return $summary;
    }

    /** The same, one level up: an archived company settles everything under it. */
    public static function companyArchived(Company $company, ?User $by = null): array
    {
        $assignments = CompanyStaffAssignment::live()->where('company_id', $company->id)->get();
        foreach ($assignments as $assignment) {
            $assignment->forceFill([
                'status' => CompanyStaffAssignment::STATUS_ENDED,
                'is_primary' => false,
                'ended_at' => now(),
                'ended_by' => $by?->id,
            ])->save();
        }

        $invitations = Invitation::where('company_id', $company->id)
            ->whereIn('status', Invitation::LIVE_STATUSES)
            ->whereNull('accepted_at')
            ->whereNull('cancelled_at')
            ->get();

        foreach ($invitations as $invitation) {
            $invitation->forceFill([
                'status' => Invitation::STATUS_CANCELLED,
                'cancelled_at' => now(),
                'cancelled_by' => $by?->id,
            ])->save();
        }

        // Members keep their rows, the company is archived, not disbanded, and
        // un-archiving should not mean rebuilding the contact list by hand.
        $summary = [
            'assignmentsEnded' => $assignments->count(),
            'invitationsCancelled' => $invitations->count(),
        ];

        if (array_sum($summary) > 0) {
            ActivityLogger::log([
                'actor' => $by,
                'type' => 'client.status_changed',
                'description' => $company->name.' was archived; staff access was removed',
                'subject' => $company,
                'metadata' => $summary,
            ]);
        }

        return $summary;
    }
}
