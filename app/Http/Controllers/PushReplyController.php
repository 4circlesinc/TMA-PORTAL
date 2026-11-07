<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * A reply typed into a message notification on an iPhone (the Reply box in
 * Notification Center), sent without opening the app.
 *
 * The app may be woken in the background with its web session long expired,
 * so it does not sign in: the notification carries a signed link scoped to
 * this person and this conversation (MessagePush, a few days), and the reply
 * must come with one of their registered device tokens, so signing out of the
 * phone (which drops the token) ends it. The message goes through the same
 * send as the Messages page, so blocking, membership, broadcasting and
 * everyone else's notifications behave exactly as if it were typed there, and
 * the conversation is marked read, as replying to it means it was.
 */
class PushReplyController extends Controller
{
    public function store(Request $request, string $conversation, int $user): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
            'device' => ['required', 'string', 'max:255'],
            'nonce' => ['nullable', 'uuid'],
        ]);

        $person = User::query()->find($user);
        abort_unless($person !== null, 403);
        abort_unless(
            DeviceToken::query()->where('user_id', $person->id)->where('token', $data['device'])->exists(),
            403,
            'This device is no longer signed in.',
        );

        // This request only: nothing is written to a session.
        Auth::setUser($person);

        $send = Request::create($request->url(), 'POST', array_filter([
            'body' => $data['body'],
            'nonce' => $data['nonce'] ?? null,
        ]));
        $send->headers->set('Accept', 'application/json');
        $send->setUserResolver(fn () => $person);

        $messaging = app(MessagingController::class);
        $response = $messaging->send($send, $conversation);

        try {
            $read = Request::create($request->url(), 'POST');
            $read->setUserResolver(fn () => $person);
            $messaging->markRead($read, $conversation);
        } catch (\Throwable $e) {
            Log::info('push reply: could not mark the conversation read', ['error' => $e->getMessage()]);
        }

        return $response;
    }
}
