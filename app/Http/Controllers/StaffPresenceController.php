<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WorkDay;
use App\Support\Messaging\PresenceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Team board for the portal home: approved staff with online presence and
 * today's work-plan status (office, remote, sick leave, …).
 *
 * Staff-only. Clients get `{ staff: false }` so the dashboard can hide the
 * widget without treating the response as an error.
 */
class StaffPresenceController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $viewer = $request->user();

        if (! in_array($viewer->account_type, ['Administrator', 'Employee'], true)) {
            return response()->json(['staff' => false, 'employees' => []]);
        }

        $users = User::query()
            ->whereIn('account_type', ['Administrator', 'Employee'])
            ->where('status', User::STATUS_APPROVED)
            ->with('presence')
            ->orderBy('name')
            ->get();

        $workStatuses = WorkDay::publicStatusesForUsers($users);

        $employees = $users->map(function (User $user) use ($viewer, $workStatuses) {
            $presence = PresenceService::forViewer($user, $viewer);

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
                'workStatus' => $workStatuses[(int) $user->id] ?? null,
            ];
        })->sortBy([
            ['online', 'desc'],
            ['name', 'asc'],
        ])->values();

        return response()->json([
            'staff' => true,
            'employees' => $employees,
            // Administrators always see the widget; employees may too.
            'canManage' => $viewer->account_type === 'Administrator',
        ]);
    }
}
