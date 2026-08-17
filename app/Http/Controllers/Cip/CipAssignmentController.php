<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\ClientAssignmentController;
use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\User;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Assignments;
use App\Support\Clients\Assignments as ClientAssignments;
use App\Support\Cip\CipAccess;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Who is working an application (§10), and who could be.
 *
 * Sibling to {@see ClientAssignmentController}: the client hub has done this
 * shape for clients since the beginning, and the difference here is the
 * subject rather than the idea. The work itself lives in {@see Assignments} —
 * this only decides who may ask and what shape the answer takes.
 *
 * Every route resolves the application through {@see ApplicationScope} first,
 * so a reader who may not see it gets a 404 and not a 403: being refused the
 * right to staff an application would otherwise tell a stranger it exists.
 */
class CipAssignmentController extends Controller
{
    /** Who holds this application, and who else could. */
    public function index(Request $request, string $uuid): JsonResponse
    {
        return response()->json($this->payload($request, $this->application($request, $uuid)));
    }

    public function store(Request $request, string $uuid): JsonResponse
    {
        $application = $this->application($request, $uuid);
        $this->authorizeAssign($request);

        $data = $request->validate([
            'userId' => ['required', 'integer', Rule::exists('users', 'id')],
            'role' => ['nullable', Rule::in(array_keys(Assignments::ROLES))],
        ]);

        // Offered and accepted are the same list, so an account that is not on
        // it — a client, a suspended officer, somebody who already holds the
        // file — cannot be assigned by posting their id.
        $officer = Assignments::assignable($application)->firstWhere('id', $data['userId']);
        abort_unless($officer, 422, 'Choose an officer who can take this application.');

        /*
         * The job follows the account type unless the request names one: a
         * Compliance Officer takes the file as compliance officer, and a
         * picker that asked would be asking a question with one answer.
         *
         * Whichever way it arrives it has to match the type, because the role
         * is the job and the account type is what lets somebody do it — a
         * Compliance Officer handed the file as reviewing officer would hold
         * an application they cannot review, the reviewer verbs being gated on
         * `cip.review`.
         */
        $role = $data['role'] ?? CipAccess::officerRoles($officer)[0] ?? CipAccess::REVIEWING_OFFICER;
        abort_unless(
            CipAccess::isOfficer($officer, $role),
            422,
            'That officer cannot take this application as '.mb_strtolower(Assignments::roleLabel($role)).'.',
        );

        /*
         * Written to the CLIENT's assignment list, which is what the Assigned
         * tab shows and what §8's column draws — one record, so somebody put
         * on here appears there and vice versa.
         *
         * The CIP assignment is written too, because §10 hangs off it: the
         * file being assigned is what moves it into review, and the reviewer
         * verbs are gated on holding it. The client row is the one anybody
         * looks at; this is the one the workflow reads.
         */
        $client = $application->client;

        if ($client) {
            ClientAssignments::assign($client, $officer, [
                'role' => $role,
                'level' => 'editor',
            ], $request->user());
        }

        Assignments::assign($application, $officer, $request->user(), $role);

        // The officer's own worklist changes shape too — this row is what puts
        // the application on it. CLIENTS as well as CIP: the same write shows
        // up on the client's own Assigned tab.
        Live::staffAnd(Live::CIP, [$officer->id]);
        Live::staffAnd(Live::CLIENTS, [$officer->id]);

        return response()->json($this->payload($request, $application->fresh()), 201);
    }

    /**
     * Take the file off somebody. The row stays as history — see
     * {@see Assignments::end} — so the access goes without erasing the fact
     * that they held it.
     */
    public function destroy(Request $request, string $uuid, int $userId): JsonResponse
    {
        $application = $this->application($request, $uuid);
        $this->authorizeAssign($request);

        $assignment = CipApplicationAssignment::live()
            ->where('application_id', $application->id)
            ->where('user_id', $userId)
            ->first();

        if ($assignment) {
            Assignments::end($assignment, $request->user());
        }

        // And off the client's list, which is the one the two screens share.
        $client = $application->client;
        if ($client) {
            $held = $client->assignments()->live()->where('user_id', $userId)->first();
            if ($held) {
                ClientAssignments::end($client, $held, $request->user());
            }
        }

        Live::staffAnd(Live::CIP, [$userId]);
        Live::staffAnd(Live::CLIENTS, [$userId]);

        return response()->json($this->payload($request, $application->fresh()));
    }

    /* ── internals ─────────────────────────────────── */

    /** The application, if this reader may see it at all. */
    private function application(Request $request, string $uuid): CipApplication
    {
        return ApplicationScope::findOrFail($request->user(), $uuid);
    }

    private function authorizeAssign(Request $request): void
    {
        abort_unless(
            Assignments::canAssign($request->user()),
            403,
            'Only an administrator can assign an application.',
        );
    }

    /**
     * Who is on this file, from the one list the Assigned tab shares.
     *
     * The application's own assignments answer only where there is no client
     * record to share with — see the matching note in
     * {@see \App\Http\Controllers\Cip\CipApplicationController}. Kept in
     * step with §8's column on purpose: the picker and the cell it opens from
     * must never name different people.
     *
     * @return list<array<string, mixed>>
     */
    private static function holders(CipApplication $application): array
    {
        $client = $application->client;

        if ($client !== null) {
            return $client->assignments()->live()->with('user')->get()
                ->map(fn ($a) => [
                    'userId' => $a->user_id,
                    'name' => $a->user?->name,
                    'email' => $a->user?->email,
                    'avatar' => $a->user?->photoUrl(),
                    'role' => $a->role,
                    'roleLabel' => $a->roleLabel(),
                    'assignedAt' => ($a->starts_at ?? $a->created_at)?->toIso8601String(),
                ])->values()->all();
        }

        return Assignments::live($application)
            ->map(fn (CipApplicationAssignment $a) => [
                'userId' => $a->user_id,
                'name' => $a->user?->name,
                'email' => $a->user?->email,
                'avatar' => $a->user?->photoUrl(),
                'role' => $a->role,
                'roleLabel' => Assignments::roleLabel($a->role),
                'assignedAt' => ($a->starts_at ?? $a->created_at)?->toIso8601String(),
            ])->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Request $request, CipApplication $application): array
    {
        $canAssign = Assignments::canAssign($request->user());

        return [
            /*
             * Who is on this file, read off the client — the one list the
             * profile's Assigned tab shows and this table's picker edits.
             * Two records meant staff added in one place were invisible in
             * the other.
             */
            'assignments' => self::holders($application),
            'canAssign' => $canAssign,
            /*
             * Only somebody who may actually hand the file over is shown the
             * firm's officers. The provider side may see who has their
             * application — §8's table tells them that already — but reading
             * off every officer who could have had it is not theirs.
             */
            'assignable' => $canAssign
                ? Assignments::assignable($application)->map(fn (User $u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'avatar' => $u->photoUrl(),
                    'accountType' => $u->account_type,
                    'role' => CipAccess::officerRoles($u)[0] ?? null,
                ])->values()->all()
                : [],
            'roles' => collect(Assignments::ROLES)
                ->map(fn (string $label, string $value) => ['value' => $value, 'label' => $label])
                ->values()->all(),
        ];
    }
}
