<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WorkDay;
use App\Support\Access\Role;
use App\Support\Presence\AvailabilityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Presence board for the portal home: every approved account (staff, clients
 * and service-provider contacts) with online presence, plus today's work-plan
 * status for staff (office, remote, sick leave, …).
 *
 * Staff-only to view. Clients get `{ staff: false }` so the dashboard can hide
 * the widget without treating the response as an error.
 */
class StaffPresenceController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        return response()->json(self::payload($request->user()));
    }

    /** @return array<string, mixed> */
    public static function payload(?User $viewer): array
    {
        if ($viewer === null || ! Role::can($viewer, 'presence.view')) {
            return ['staff' => false, 'employees' => []];
        }

        /*
         * Everyone with a live login, not only Role::STAFF. The board used to
         * be the payroll; it is now the firm, so a client who is signed in
         * counts the same as a colleague. Work-plan status still belongs to
         * staff only - clients do not keep one.
         */
        $users = User::query()
            ->where('status', User::STATUS_APPROVED)
            ->with('presence')
            ->orderBy('name')
            ->get();

        $workStatuses = WorkDay::publicStatusesForUsers(
            $users->filter(fn (User $user) => Role::isStaff($user))
        );
        // Availability costs four queries a head when asked one at a time.
        AvailabilityService::primeStates($users->pluck('id'));

        $employees = $users->map(function (User $user) use ($viewer, $workStatuses) {
            $presence = AvailabilityService::forViewer($user, $viewer);

            return [
                'id' => $user->id,
                'name' => $user->name,
                'firstName' => $user->first_name,
                'jobTitle' => $user->job_title,
                'avatar' => $user->avatar_url,
                'accountType' => $user->account_type,
                'self' => $user->id === $viewer->id,
                'online' => (bool) ($presence['online'] ?? false),
                'lastSeen' => $presence['lastSeen'] ?? null,
                'lastSeenAt' => $presence['lastSeenAt'] ?? null,
                'status' => $presence['status'] ?? null,
                'statusLabel' => $presence['statusLabel'] ?? null,
                'statusSource' => $presence['statusSource'] ?? null,
                'statusMessage' => $presence['statusMessage'] ?? null,
                'statusIcon' => $presence['statusIcon'] ?? null,
                'workStatus' => $workStatuses[(int) $user->id] ?? null,
            ];
        })->sortBy(fn (array $p) => [
            // Ascending on 0/1 rather than a separate descending pass, so the
            // whole order is one comparison.
            $p['online'] ? 0 : 1,
            /*
             * Then most recently seen.
             *
             * Negated rather than sorted descending, because this column is
             * nullable: `desc` on a null would put everyone who has never
             * signed in at the head of the offline group, ahead of the
             * colleague who was here five minutes ago. Negated, never-seen is
             * 0 and lands after every real timestamp.
             */
            -($p['lastSeenAt'] ? strtotime($p['lastSeenAt']) : 0),
            // Everyone online was seen "now", so that group needs a real
            // tiebreak or its order is whatever the query happened to return.
            mb_strtolower((string) $p['name']),
        ])->values();

        return [
            'staff' => true,
            'employees' => $employees,
            // Administrators always see the widget; employees may too.
            'canManage' => Role::can($viewer, 'users.manage'),
        ];
    }
}
