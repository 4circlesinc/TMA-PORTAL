<?php

namespace App\Http\Controllers;

use App\Models\UserLocation;
use App\Models\UserStatusSchedule;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\AvailabilityStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\Rule;

class AvailabilityController extends Controller
{
    /** Full presence state for the signed-in user (header dropdown + settings). */
    public function show(Request $request): JsonResponse
    {
        return response()->json(AvailabilityService::selfPayload($request->user()));
    }

    /** Set or clear a manual / timed status. */
    public function updateStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(array_keys(AvailabilityStatus::LABELS))],
            'message' => ['nullable', 'string', 'max:140'],
            'startsAt' => ['nullable', 'date'],
            'expiresAt' => ['nullable', 'date', 'after:startsAt'],
        ]);

        $user = $request->user();

        if ($data['message'] ?? null) {
            AvailabilityService::setMessage($user, $data['message']);
        }

        AvailabilityService::setManual($user, $data['status'], [
            'startsAt' => $data['startsAt'] ?? null,
            'expiresAt' => $data['expiresAt'] ?? null,
            'message' => $data['message'] ?? null,
        ]);

        return response()->json(AvailabilityService::selfPayload($user));
    }

    /** Clear a specific layered state (manual override off). */
    public function clearStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'string', Rule::in(array_keys(AvailabilityStatus::LABELS))],
        ]);

        $user = $request->user();
        AvailabilityService::clearState($user, $data['status']);

        return response()->json(AvailabilityService::selfPayload($user));
    }

    /** Optional custom message independent of status changes. */
    public function updateMessage(Request $request): JsonResponse
    {
        $data = $request->validate([
            'message' => ['nullable', 'string', 'max:140'],
        ]);

        $user = $request->user();
        AvailabilityService::setMessage($user, $data['message'] ?? null);

        return response()->json(AvailabilityService::selfPayload($user));
    }

    /**
     * Report current coordinates for geofence detection.
     *
     * Coordinates are used only to resolve in-office / remote and are not stored.
     */
    public function reportLocation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
            'accuracyM' => ['nullable', 'numeric', 'min:0', 'max:5000'],
        ]);

        $user = $request->user();
        AvailabilityService::applyLocation($user, $data);

        return response()->json(AvailabilityService::selfPayload($user));
    }

    /** Resolve an address to coordinates (Nominatim proxy — not stored). */
    public function geocode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'max:255'],
        ]);

        $results = self::nominatimSearch($data['q']);

        if ($results === null) {
            return response()->json(['message' => 'Geocoding is temporarily unavailable.'], 503);
        }

        if ($results === []) {
            return response()->json(['message' => 'No results for that address.'], 422);
        }

        $hit = $results[0];

        return response()->json([
            'lat' => (float) $hit['lat'],
            'lng' => (float) $hit['lon'],
            'label' => $hit['display_name'] ?? $data['q'],
        ]);
    }

    /** Resolve coordinates to a readable address (not stored). */
    public function reverseGeocode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'lat' => ['required', 'numeric', 'between:-90,90'],
            'lng' => ['required', 'numeric', 'between:-180,180'],
        ]);

        $response = Http::timeout(8)
            ->withHeaders(['User-Agent' => self::nominatimUserAgent()])
            ->get('https://nominatim.openstreetmap.org/reverse', [
                'lat' => $data['lat'],
                'lon' => $data['lng'],
                'format' => 'json',
            ]);

        if (! $response->successful()) {
            return response()->json(['message' => 'Reverse geocoding is temporarily unavailable.'], 503);
        }

        $body = $response->json();

        return response()->json([
            'lat' => (float) $data['lat'],
            'lng' => (float) $data['lng'],
            'label' => $body['display_name'] ?? null,
        ]);
    }

    /**
     * @return list<array<string, mixed>>|null null when the upstream service fails
     */
    private static function nominatimSearch(string $query): ?array
    {
        $response = Http::timeout(8)
            ->withHeaders(['User-Agent' => self::nominatimUserAgent()])
            ->get('https://nominatim.openstreetmap.org/search', [
                'q' => $query,
                'format' => 'json',
                'limit' => 1,
            ]);

        if (! $response->successful()) {
            return null;
        }

        $json = $response->json();

        return is_array($json) ? $json : [];
    }

    private static function nominatimUserAgent(): string
    {
        return config('app.name', 'TMA Portal').' (availability geocode; '.config('app.url', 'localhost').')';
    }

    /** Save office or remote work location. */
    public function upsertLocation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'string', Rule::in([UserLocation::TYPE_OFFICE, UserLocation::TYPE_REMOTE])],
            'label' => ['nullable', 'string', 'max:120'],
            'address' => ['nullable', 'string', 'max:255'],
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'radiusM' => ['nullable', 'integer', 'min:25', 'max:5000'],
            'enabled' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();

        UserLocation::updateOrCreate(
            ['user_id' => $user->id, 'type' => $data['type']],
            [
                'label' => $data['label'] ?? null,
                'address' => $data['address'] ?? null,
                'latitude' => $data['latitude'],
                'longitude' => $data['longitude'],
                'radius_m' => $data['radiusM'] ?? 100,
                'enabled' => array_key_exists('enabled', $data)
                    ? $request->boolean('enabled')
                    : true,
            ]
        );

        return response()->json(AvailabilityService::selfPayload($user));
    }

    public function deleteLocation(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, [UserLocation::TYPE_OFFICE, UserLocation::TYPE_REMOTE], true), 404);

        UserLocation::where('user_id', $request->user()->id)->where('type', $type)->delete();

        return response()->json(AvailabilityService::selfPayload($request->user()));
    }

    /** Create or update a scheduled status window. */
    public function storeSchedule(Request $request): JsonResponse
    {
        $data = $request->validate([
            'id' => ['nullable', 'integer'],
            'status' => ['required', 'string', Rule::in(array_keys(AvailabilityStatus::LABELS))],
            'message' => ['nullable', 'string', 'max:140'],
            'startsAt' => ['required', 'date'],
            'endsAt' => ['required', 'date', 'after:startsAt'],
            'recurrence' => ['nullable', 'string', 'max:32'],
            'enabled' => ['nullable', 'boolean'],
        ]);

        $user = $request->user();

        if (! empty($data['id'])) {
            $schedule = UserStatusSchedule::where('user_id', $user->id)->where('id', $data['id'])->firstOrFail();
            $schedule->update([
                'status' => $data['status'],
                'status_message' => $data['message'] ?? null,
                'starts_at' => $data['startsAt'],
                'ends_at' => $data['endsAt'],
                'recurrence' => $data['recurrence'] ?? null,
                'enabled' => $data['enabled'] ?? true,
            ]);
        } else {
            UserStatusSchedule::create([
                'user_id' => $user->id,
                'status' => $data['status'],
                'status_message' => $data['message'] ?? null,
                'starts_at' => $data['startsAt'],
                'ends_at' => $data['endsAt'],
                'recurrence' => $data['recurrence'] ?? null,
                'enabled' => $data['enabled'] ?? true,
            ]);
        }

        AvailabilityService::recompute($user);

        return response()->json(AvailabilityService::selfPayload($user));
    }

    public function destroySchedule(Request $request, int $id): JsonResponse
    {
        UserStatusSchedule::where('user_id', $request->user()->id)->where('id', $id)->delete();
        AvailabilityService::recompute($request->user());

        return response()->json(AvailabilityService::selfPayload($request->user()));
    }

    /** Call module reports active call state (also driven client-side). */
    public function reportCall(Request $request): JsonResponse
    {
        $data = $request->validate(['active' => ['required', 'boolean']]);

        $user = $request->user();
        AvailabilityService::setOnCall($user, (bool) $data['active']);

        return response()->json(['ok' => true]);
    }
}
