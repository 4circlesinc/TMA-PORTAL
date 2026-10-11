<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Contacts;
use App\Support\Cip\NotReady;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Cip\StatusAttachment;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * One person's own step in the post-approval lane.
 *
 * A person stands where the application stands and their documents say;
 * this is the door for the few moves a hand makes instead: a NIC or
 * passport date recorded for this person alone, an outcome of their own,
 * or either being taken back. {@see PersonStatus::move()} decides which
 * of those the request is, and refuses everything else with the reason.
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

        StatusAttachment::accept($request);

        $application = ApplicationScope::findOrFail($user, $person->application->uuid);

        abort_unless(
            ($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL,
            422,
            'Person status may only be changed in post-approval.',
        );

        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(PersonStatus::ALL)],
            // The day a dated step happened. Asked for by the dialog; a
            // caller that leaves it out is recording today.
            'date' => ['nullable', 'date'],
            'note' => ['nullable', 'string', 'max:2000'],
        ]);

        $person->setRelation('application', $application);

        try {
            $moved = PersonStatus::move(
                $person,
                $data['status'],
                $user,
                ! empty($data['date']) ? Carbon::parse($data['date']) : null,
                (string) ($data['note'] ?? ''),
            );
        } catch (\InvalidArgumentException $e) {
            NotReady::abort($e);
        }

        if ($moved['changed']) {
            StatusAttachment::storeIfPresent($request, $application, $user, $person);

            // The provider side sees each person's chip too, so it hears.
            Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));
        }

        return response()->json([
            'application' => app(CipApplicationController::class)
                ->showRecord($application->fresh(), $user),
        ]);
    }
}
