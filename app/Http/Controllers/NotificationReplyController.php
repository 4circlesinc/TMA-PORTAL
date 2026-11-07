<?php

namespace App\Http\Controllers;

use App\Support\Notifications\NotificationReply;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /portal/notifications/reply`: a reply typed into a notification on a
 * computer (the Mac app's Reply), from the signed-in page. The notification's
 * layout says what it answers (MessagePush::layout, replyTo); the session is
 * the person, so no device token or signed link is needed.
 */
class NotificationReplyController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:20000'],
            'replyTo' => ['required', 'array'],
            'replyTo.kind' => ['required', 'in:message,cip,email'],
            'replyTo.conversation' => ['required_if:replyTo.kind,message', 'string', 'max:64'],
            'replyTo.application' => ['required_if:replyTo.kind,cip', 'string', 'max:64'],
            'replyTo.lane' => ['required_if:replyTo.kind,cip', 'string', 'max:16'],
            'replyTo.message' => ['required_if:replyTo.kind,email', 'string', 'max:64'],
            'nonce' => ['nullable', 'uuid'],
        ]);

        $person = $request->user();
        $to = $data['replyTo'];

        return match ($to['kind']) {
            'cip' => NotificationReply::cip($person, $to['application'], $to['lane'], $data['body']),
            'email' => NotificationReply::email($person, $to['message'], $data['body']),
            default => NotificationReply::message($person, $to['conversation'], $data['body'], $data['nonce'] ?? null),
        };
    }
}
