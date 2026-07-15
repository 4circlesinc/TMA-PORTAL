<?php

namespace App\Http\Controllers;

use App\Support\AvatarService;
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
            'name' => $user->name,
            'firstName' => $user->first_name ?: $user->name,
            'lastName' => $user->last_name,
            'email' => $user->email,
            // No fallback avatar: the front-end draws initials when this is null.
            'avatar' => $user->avatar_url,
            'hasAvatar' => (bool) $user->avatar_url,
            'accountType' => $user->account_type,
            'isAdmin' => $user->account_type === 'Administrator',
            'providerPhoto' => $user->provider_avatar_url,
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
