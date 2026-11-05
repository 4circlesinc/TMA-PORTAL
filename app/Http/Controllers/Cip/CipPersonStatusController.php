<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipPerson;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Contacts;
use App\Support\Cip\Notices;
use App\Support\Cip\NotReady;
use App\Support\Cip\PersonStatus;
use App\Support\Cip\Phase;
use App\Support\Cip\StatusAttachment;
use App\Support\Cip\StatusCopies;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Throwable;

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
        // Named before the person moves, the same way an application status
        // refuses a bad address before the row is written. This only checks;
        // the notice that actually sends is what takes the list.
        StatusCopies::pull();

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
            $application = $application->fresh();
            $person->setRelation('application', $application);

            // The application's own notice, when the file followed this
            // person, already carried the upload. A step that leaves the
            // file where it is still has a notice of its own, and the file
            // goes on that one.
            if (! $request->attributes->get('cip.status_notice_sent')) {
                $file = StatusAttachment::alreadyClaimed()
                    ?? StatusAttachment::claimForNotice($application, $user);

                if ($file !== null) {
                    $copies = $request->attributes->has('cip.status_copies')
                        ? StatusCopies::taken()
                        : StatusCopies::take();

                    try {
                        Notices::personMoved(
                            $person,
                            $moved['from'],
                            $moved['to'],
                            $user,
                            $file,
                            $copies,
                        );
                        StatusAttachment::consumeClaim();
                    } catch (Throwable $e) {
                        Log::error('CIP person status notice failed after the person was saved.', [
                            'person' => $person->getKey(),
                            'status' => $moved['to'],
                            'error' => $e->getMessage(),
                        ]);
                    }
                }
            }

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
