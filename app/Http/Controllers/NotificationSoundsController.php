<?php

namespace App\Http\Controllers;

use App\Support\Notifications\NotificationSounds;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `GET|PUT /me/notification-sounds`: the sound notifications make in the Mac
 * and iPhone apps. See NotificationSounds for why the two lists differ.
 */
class NotificationSoundsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(self::payload(NotificationSounds::for($request->user())));
    }

    public function update(Request $request): JsonResponse
    {
        $request->validate([
            'mac' => ['sometimes', 'string', 'in:'.implode(',', NotificationSounds::MAC)],
            'iphone' => ['sometimes', 'string', 'in:'.implode(',', NotificationSounds::IPHONE)],
        ]);

        return response()->json(self::payload(NotificationSounds::update($request->user(), $request->only(['mac', 'iphone']))));
    }

    /** @param  array{mac: string, iphone: string}  $sounds */
    private static function payload(array $sounds): array
    {
        return $sounds + ['options' => ['mac' => NotificationSounds::MAC, 'iphone' => NotificationSounds::IPHONE]];
    }
}
