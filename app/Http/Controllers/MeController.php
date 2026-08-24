<?php

namespace App\Http\Controllers;

use App\Models\WorkDay;
use App\Support\Access\Role;
use App\Support\AvatarService;
use App\Support\Cip\CipAccess;
use App\Support\Messaging\MessagingSettings;
use App\Support\Notifications\ToastSettings;
use App\Support\Presence\AvailabilityService;
use App\Support\RealtimeConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MeController extends Controller
{
    /**
     * The signed-in user, for the static portal shells.
     */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'id' => $user->id,
            'name' => $user->name,
            'firstName' => $user->first_name ?: $user->name,
            'lastName' => $user->last_name,
            'email' => $user->email,
            // The profile card renders straight from this store, on the account
            // page and on the Overview — without these four it had nothing but
            // dashes to show.
            'phone' => $user->phone,
            'jobTitle' => $user->job_title,
            'company' => $user->companyName(),
            'linkedin' => $user->linkedin_url,
            // No fallback avatar: the front-end draws initials when this is null.
            'avatar' => $user->avatar_url,
            'hasAvatar' => (bool) $user->avatar_url,
            'accountType' => $user->account_type,
            'isAdmin' => Role::isAdmin($user),
            'isStaff' => Role::isStaff($user),
            // External CIP: service-provider contacts see only their firm's
            // applications (no Service providers tab). Private clients too.
            'cipReach' => CipAccess::canReach($user),
            'isProviderContact' => CipAccess::isProviderContact($user),
            'isPrivateClient' => CipAccess::isPrivateClient($user),
            // What this account may reach, so the sidebar, the mobile menu and
            // the global search index can hide exactly what the server would
            // refuse. Convenience only — every one of these is enforced again
            // on the request that acts on it.
            'capabilities' => Role::capabilities($user),
            'providerPhoto' => $user->provider_avatar_url,
            // Lets the notification realtime share the messaging websocket.
            'realtime' => RealtimeConfig::client(),
            // Toast prefs load with identity so the first notification of the
            // session already lands in the right corner with the right hold.
            'toasts' => ToastSettings::for($user),
            // Desktop notifications are raised by the notification store, which
            // runs on every shell — including the ones that never mount
            // Messages and so never load the messaging settings.
            'desktopNotifications' => [
                'enabled' => (bool) MessagingSettings::get($user, 'desktopNotifications'),
                'preview' => (bool) MessagingSettings::get($user, 'notificationPreview'),
            ],
            // Today's work plan (public fields only) for Messages / profiles.
            'workStatus' => WorkDay::publicStatusFor($user),
            // Availability status for the header dropdown and self presence.
            'availability' => AvailabilityService::selfPayload($user),
        ]);
    }

    /**
     * Everything the "My profile" page needs.
     */
    public function profile(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'name' => $user->name,
            'firstName' => $user->first_name,
            'middleName' => $user->middle_name,
            'lastName' => $user->last_name,
            'gender' => $user->gender,
            'email' => $user->email,
            'phone' => $user->phone,
            'jobTitle' => $user->job_title,
            // The editable value, not companyName(): a client must not have
            // their client record's company silently saved back onto them.
            'company' => $user->company,
            'companyInherited' => $user->company ? null : $user->clientRecord?->company,
            'bio' => $user->bio,
            'linkedin' => $user->linkedin_url,
            'accountType' => $user->account_type,
            'avatar' => $user->avatar_url,
            'providerPhoto' => $user->provider_avatar_url,
            // Connected Google/Microsoft accounts, so the profile page can offer
            // "use my account photo" (pulling it needs a fresh sign-in).
            'connected' => $user->connectedAccounts->map(fn ($a) => [
                'key' => $a->provider,
                'name' => ucfirst($a->provider),
            ])->values(),
        ]);
    }

    /**
     * Update the signed-in user's photo: either an uploaded image, or a switch
     * back to the photo their Google/Microsoft account supplied. System avatars
     * are no longer offered.
     */
    public function updateAvatar(Request $request): JsonResponse
    {
        $data = $request->validate([
            'avatar_photo' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'source' => ['nullable', Rule::in(['upload', 'provider'])],
        ], [
            'avatar_photo.image' => 'That file is not an image. Use a JPG, PNG, or WebP.',
            'avatar_photo.max' => 'That image is too large. Keep it under 8 MB.',
        ]);

        $user = $request->user();

        if ($request->hasFile('avatar_photo') && ($data['source'] ?? 'upload') !== 'provider') {
            $avatar = AvatarService::storeUploaded($request->file('avatar_photo'), $user->avatar_url);
        } elseif (($data['source'] ?? null) === 'provider' && $user->provider_avatar_url) {
            $avatar = $user->provider_avatar_url;
        } else {
            throw ValidationException::withMessages([
                'avatar_photo' => 'Choose a photo to upload.',
            ]);
        }

        $user->forceFill(['avatar_url' => $avatar])->save();

        return response()->json(['status' => 'ok', 'avatar' => $avatar]);
    }
}
