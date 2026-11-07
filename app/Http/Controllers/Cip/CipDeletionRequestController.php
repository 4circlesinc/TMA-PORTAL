<?php

namespace App\Http\Controllers\Cip;

use App\Http\Controllers\Controller;
use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Contacts;
use App\Support\Cip\Engine;
use App\Support\Cip\Notices;
use App\Support\Realtime\Live;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Asking an administrator to delete a filed application.
 *
 * Staff and the provider side ask; an administrator answers by deleting the
 * file (the ordinary delete, which tells the requester) or by declining here.
 * The requester may also take the ask back. One open request per file:
 * asking again replaces the reason.
 */
class CipDeletionRequestController extends Controller
{
    private const REASON_MAX = 2000;

    /** Ask. */
    public function store(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = $this->reachable($user, $uuid);
        abort_unless(
            CipAccess::canRequestDeletion($user, $application),
            403,
            'You can’t request deletion of this application.',
        );

        $data = $request->validate([
            'reason' => ['required', 'string', 'max:'.self::REASON_MAX],
        ], [
            'reason.required' => 'Say why this application should be deleted.',
        ]);
        $reason = trim($data['reason']);

        $application->forceFill([
            'deletion_requested_at' => Carbon::now(),
            'deletion_requested_by' => $user->id,
            'deletion_request_reason' => $reason,
        ])->save();

        Engine::record($application, CipEvent::ACTION_DELETION_REQUESTED, $user, ['reason' => $reason]);
        Notices::deletionRequested($application, $user, $reason);
        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json(['status' => 'ok']);
    }

    /**
     * Take the ask back (the requester), or decline it (an administrator).
     * Nothing open is already the answer either wanted.
     */
    public function destroy(Request $request, string $uuid): JsonResponse
    {
        $user = $request->user();
        $application = $this->reachable($user, $uuid);

        if ($application->deletion_requested_at === null) {
            return response()->json(['status' => 'ok']);
        }

        $isAdmin = Role::isAdmin($user);
        $isRequester = (int) $application->deletion_requested_by === (int) $user->id;
        abort_unless($isAdmin || $isRequester, 403, 'Only an administrator can decline this request.');

        $note = trim((string) $request->input('note', ''));
        $requester = $application->deletionRequester;

        $application->forceFill([
            'deletion_requested_at' => null,
            'deletion_requested_by' => null,
            'deletion_request_reason' => null,
        ])->save();

        if ($isRequester && ! $isAdmin) {
            Engine::record($application, CipEvent::ACTION_DELETION_WITHDRAWN, $user);
        } else {
            Engine::record($application, CipEvent::ACTION_DELETION_DECLINED, $user, array_filter(['note' => $note]));
            Notices::deletionDecided($application, $requester, $user, false, $note);
        }
        Live::staffAnd(Live::CIP, Contacts::providerUserIds($application));

        return response()->json(['status' => 'ok']);
    }

    private function reachable(User $user, string $uuid): CipApplication
    {
        abort_unless(CipAccess::canCreate($user), 404);

        $application = ApplicationScope::query($user)->where('uuid', $uuid)->first();
        abort_unless($application, 404);

        return $application;
    }
}
