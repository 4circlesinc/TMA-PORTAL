<?php

namespace App\Http\Controllers;

use App\Support\Notifications\NotificationSounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** `GET|PUT /me/notification-sounds`: the iPhone app's notification sound. */
class NotificationSoundsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(NotificationSounds::for($request->user()) + ['options' => ['iphone' => NotificationSounds::IPHONE]]);
    }

    public function update(Request $request): JsonResponse
    {
        $request->validate(['iphone' => ['required', 'string', 'in:'.implode(',', NotificationSounds::IPHONE)]]);

        return response()->json(NotificationSounds::update($request->user(), $request->only('iphone')) + ['options' => ['iphone' => NotificationSounds::IPHONE]]);
    }
}
