<?php

namespace App\Http\Controllers;

use App\Models\UserLocation;
use App\Models\UserStatusSchedule;
use App\Support\Presence\AvailabilityService;
use App\Support\Presence\AvailabilityStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
        ]);

        $user = $request->user();
        AvailabilityService::applyLocation($user, $data);

        return response()->json(AvailabilityService::selfPayload($user));
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
                'enabled' => $data['enabled'] ?? true,
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
