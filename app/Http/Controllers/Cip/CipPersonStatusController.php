<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Realtime\Live;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Post-approval status for one person on an application.
 *
 * Each family member has their own status once the file is in the
 * post-approval lane. Application-level status stays at Granted.
 */
class CipPersonStatusController extends Controller
{
    public function update(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        abort_unless(CipAccess::canChangeApplicationStatus($user), 403);

        $person = CipPerson::query()
            ->where('uuid', $uuid)
            ->with('application.client')
            ->firstOrFail();

        $application = ApplicationScope::findOrFail($user, $person->application->uuid);

        abort_unless(
            ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL,
            422,
            'Person status may only be changed in post-approval.',
        );

        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(PersonStatus::ALL)],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $from = $person->post_approval_status ?? PersonStatus::NOT_STARTED;
        $to = $data['status'];

        if ($from === $to) {
            return response()->json([
                'application' => app(CipApplicationController::class)
                    ->showRecord($application, $user),
            ]);
        }

        try {
            PersonStatus::assertMayMove($person, $to, $user);
        } catch (AuthorizationException $e) {
            abort(403, $e->getMessage());
        } catch (\InvalidArgumentException $e) {
            abort(422, $e->getMessage());
        }

        $note = trim($data['note'] ?? '');
        $meta = array_filter([
            'person_id' => $person->uuid,
            'person_name' => $person->fullName(),
            'person_role' => $person->role,
            'note' => $note !== '' ? $note : null,
            'override' => PersonStatus::canTransition($person, $to) ? null : true,
        ]);

        $person->forceFill(['post_approval_status' => $to])->save();

        Engine::record(
            $application,
            'person_status_changed',
            $user,
            $meta,
            $from,
            $to,
        );

        Live::staff(Live::CIP);

        return response()->json([
            'application' => app(CipApplicationController::class)
                ->showRecord($application->fresh(), $user),
        ]);
    }
}
