<?php

namespace App\Http\Controllers;

use App\Support\Microsoft\ChangeNotifications;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Microsoft Graph change-notification endpoint.
 *
 * Two shapes of POST, both unauthenticated:
 *
 *  1. Handshake: `?validationToken=…` — Graph is proving the URL exists.
 *     The body must be that token as text/plain within a few seconds.
 *  2. Notification: JSON `{ value: [ … ] }` — something in a watched
 *     mailbox or drive changed. We dispatch the existing sync jobs and
 *     answer 202 before doing any Graph work of our own.
 */
class GraphWebhookController extends Controller
{
    public function __invoke(Request $request): Response
    {
        $token = $request->query('validationToken');

        if (is_string($token) && $token !== '') {
            return response($token, 200)->header('Content-Type', 'text/plain');
        }

        foreach ($request->input('value', []) as $notification) {
            if (is_array($notification)) {
                ChangeNotifications::handle($notification);
            }
        }

        return response('', 202);
    }
}
