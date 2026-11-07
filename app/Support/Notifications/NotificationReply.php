<?php

namespace App\Support\Notifications;

use App\Http\Controllers\MailController;
use App\Http\Controllers\MessagingController;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Threads;
use App\Support\Mail\QuickReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * A reply typed into a notification, wherever it was typed: an iPhone's or an
 * Android phone's notification (PushReplyController, a signed link and one of
 * the person's devices), or the Mac app's (NotificationReplyController, the
 * signed-in session). Each kind goes through the same send as the page it
 * belongs to, so blocking, membership, threading, broadcasting and everyone
 * else's notifications behave exactly as if it were typed there:
 *
 *   message   the conversation, then marked read (replying means it was read)
 *   cip       the CIP file's thread, in the lane the message came in on, so a
 *             reply to an internal note never reaches the service provider
 *   email     a real reply, to the email's Reply-To or sender, in its thread,
 *             signed off with the person's chosen signature (QuickReply)
 */
final class NotificationReply
{
    public static function message(User $person, string $conversation, string $body, ?string $nonce = null): JsonResponse
    {
        self::actAs($person);

        $send = self::request(array_filter(['body' => $body, 'nonce' => $nonce]), $person);
        $messaging = app(MessagingController::class);
        $response = $messaging->send($send, $conversation);

        try {
            $messaging->markRead(self::request([], $person), $conversation);
        } catch (\Throwable $e) {
            Log::info('notification reply: could not mark the conversation read', ['error' => $e->getMessage()]);
        }

        return $response;
    }

    public static function cip(User $person, string $application, string $lane, string $body): JsonResponse
    {
        self::actAs($person);
        abort_unless(CipAccess::canReach($person), 404);

        $file = ApplicationScope::findOrFail($person, $application);
        $message = Threads::create($file, $person, $body, $lane);

        return response()->json(
            Threads::present($message->fresh()->load(['author', 'companyMember', 'replyTo']), $person),
            201,
        );
    }

    public static function email(User $person, string $message, string $body): JsonResponse
    {
        self::actAs($person);
        abort_unless(Role::can($person, 'mail.use'), 403);

        $original = MailMessage::query()->where('user_id', $person->id)->where('uuid', $message)->first();
        abort_unless($original !== null, 404);

        return app(MailController::class)->send(self::request([
            'to' => [QuickReply::recipient($original)],
            'subject' => QuickReply::subject($original->subject),
            'bodyHtml' => QuickReply::html($body, $person),
            'mode' => 'reply',
            'inReplyTo' => $original->uuid,
        ], $person));
    }

    /** This request only: nothing is written to a session. */
    private static function actAs(User $person): void
    {
        Auth::setUser($person);
    }

    /** @param  array<string, mixed>  $data */
    private static function request(array $data, User $person): Request
    {
        $request = Request::create(url('/'), 'POST', $data);
        $request->headers->set('Accept', 'application/json');
        $request->setUserResolver(fn () => $person);

        return $request;
    }
}
