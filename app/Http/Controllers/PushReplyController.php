<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Mail\QuickReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * A reply typed into a message or email notification on an iPhone (the Reply
 * box in Notification Center), sent without opening the app.
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
        $data = $this->validated($request);
        $person = $this->person($user, $data['device']);

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

    /**
     * An email reply: back to whoever the email asks replies to go to, in its
     * thread, with the person's signature, through the same send as the Email
     * page (so it threads in Gmail and Outlook like any reply).
     */
    public function mail(Request $request, string $message, int $user): JsonResponse
    {
        $data = $this->validated($request);
        $person = $this->person($user, $data['device']);
        abort_unless(Role::can($person, 'mail.use'), 403);

        $original = MailMessage::query()->where('user_id', $person->id)->where('uuid', $message)->first();
        abort_unless($original !== null, 404);

        $send = Request::create($request->url(), 'POST', [
            'to' => [QuickReply::recipient($original)],
            'subject' => QuickReply::subject($original->subject),
            'bodyHtml' => QuickReply::html($data['body'], $person),
            'mode' => 'reply',
            'inReplyTo' => $original->uuid,
        ]);
        $send->headers->set('Accept', 'application/json');
        $send->setUserResolver(fn () => $person);

        return app(MailController::class)->send($send);
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

        // This request only: nothing is written to a session.
        Auth::setUser($person);

        return $person;
    }
}
