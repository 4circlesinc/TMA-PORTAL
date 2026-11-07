<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\NotificationReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A reply typed into a message, CIP thread or email notification on a phone
 * (the iPhone's Reply box, Android's inline reply), sent without opening the
 * app.
 *
 * The app may be woken in the background with its web session long expired,
 * so it does not sign in: the notification carries a signed link scoped to
 * this person and this conversation (MessagePush, a few days), and the reply
 * must come with one of their registered device tokens, so signing out of the
 * phone (which drops the token) ends it. NotificationReply does the sending.
 */
class PushReplyController extends Controller
{
    public function store(Request $request, string $conversation, int $user): JsonResponse
    {
        $data = $this->validated($request);

        return NotificationReply::message($this->person($user, $data['device']), $conversation, $data['body'], $data['nonce'] ?? null);
    }

    public function mail(Request $request, string $message, int $user): JsonResponse
    {
        $data = $this->validated($request);

        return NotificationReply::email($this->person($user, $data['device']), $message, $data['body']);
    }

    public function cip(Request $request, string $application, int $user, string $lane): JsonResponse
    {
        $data = $this->validated($request);

        return NotificationReply::cip($this->person($user, $data['device']), $application, $lane, $data['body']);
    }

    /** @return array{body: string, device: string, nonce?: string|null} */
    private function validated(Request $request): array
    {
        return $request->validate([
            'body' => ['required', 'string', 'max:20000'],
            'device' => ['required', 'string', 'max:255'],
            'nonce' => ['nullable', 'uuid'],
        ]);
    }

    /** The person the link was signed for, from one of their own devices. */
    private function person(int $user, string $device): User
    {
        $person = User::query()->find($user);
        abort_unless($person !== null, 403);
        abort_unless(
            DeviceToken::query()->where('user_id', $person->id)->where('token', $device)->exists(),
            403,
            'This device is no longer signed in.',
        );

        return $person;
    }
}
