<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Messaging\LiveCalls;
use App\Support\Notifications\NotificationReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A phone ringing from a push, talking about that call without its web
 * session (it may have been woken from closed, with the page not loaded).
 *
 *   state    should it still be ringing? An iPhone asks every few seconds
 *            while its call screen rings, because a VoIP push cannot carry
 *            a "stop": answered elsewhere, declined, or the caller gave up.
 *   decline  the call screen's Decline, without opening the app.
 *
 * The ring push carries a signed link scoped to this person and this call
 * (Push::callRing); the request must also come with one of their registered
 * devices, so signing out of the phone ends it (as PushReplyController).
 */
class PushCallController extends Controller
{
    public function store(Request $request, string $signal, int $user): JsonResponse
    {
        $data = $request->validate([
            'device' => ['required', 'string', 'max:512'],
            'action' => ['required', 'string', 'in:state,decline'],
        ]);
        $person = $this->person($user, $data['device']);

        $record = LiveCalls::find($signal);
        if ($record === null) {
            // Long gone: the caller's tab closed mid-ring, or a stale push.
            return response()->json(['ringing' => false, 'outcome' => LiveCalls::ENDED, 'answeredHere' => false]);
        }
        abort_unless(LiveCalls::rings($record, $person->id), 404);

        if ($data['action'] === 'decline' && LiveCalls::isRinging($record)) {
            NotificationReply::declineCall($person, $record);
            $record = LiveCalls::find($signal) ?? $record;
        }

        return response()->json([
            'ringing' => LiveCalls::isRinging($record),
            'outcome' => $record['outcome'],
            // Answered by this person, which may be on this very phone.
            'answeredHere' => $record['outcome'] === LiveCalls::ANSWERED && (int) $record['by'] === $person->id,
        ]);
    }

    /** The person the link was signed for, from one of their own devices. */
    private function person(int $user, string $device): User
    {
        $person = User::query()->find($user);
        abort_unless($person !== null, 403);
        abort_unless(
            DeviceToken::query()
                ->where('user_id', $person->id)
                ->where(fn ($q) => $q->where('token', $device)->orWhere('voip_token', $device))
                ->exists(),
            403,
            'This device is no longer signed in.',
        );

        return $person;
    }
}
