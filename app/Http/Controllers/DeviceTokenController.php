<?php

namespace App\Http\Controllers;

use App\Models\DeviceToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `POST /me/devices` and `DELETE /me/devices/{token}` — the native app
 * registers its push token after it has a session and on token rotation, and
 * drops it when the person signs out on that device (the Logout listener
 * does the same server-side, keyed on the session that registered it).
 */
class DeviceTokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'platform' => ['required', 'string', 'in:android'],
            'token' => ['required', 'string', 'max:512'],
            'appVersion' => ['nullable', 'string', 'max:32'],
            'deviceName' => ['nullable', 'string', 'max:120'],
        ]);

        $attrs = [
            'user_id' => $request->user()->id,
            'platform' => $data['platform'],
            'app_version' => $data['appVersion'] ?? null,
            'device_name' => $data['deviceName'] ?? null,
            'session_id' => $request->session()->getId(),
            'last_seen_at' => now(),
        ];

        $existing = DeviceToken::query()->where('token', $data['token'])->first();
        if ($existing) {
            // A token belongs to the device; whoever is signed in there now owns it.
            $existing->fill($attrs)->save();

            return response()->json(['ok' => true]);
        }

        DeviceToken::create($attrs + ['token' => $data['token']]);

        return response()->json(['ok' => true], 201);
    }

    public function destroy(Request $request, string $token): JsonResponse
    {
        DeviceToken::query()
            ->where('token', $token)
            ->where('user_id', $request->user()->id)
            ->delete();

        return response()->json(['ok' => true]);
    }
}
