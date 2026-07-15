<?php

namespace App\Http\Controllers;

use App\Support\AvatarService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    /**
     * "My profile" lives inside Account settings, in the portal's own shell.
     */
    public function show(): RedirectResponse
    {
        return redirect('/account-settings?page=profile');
    }

    public function update(Request $request): JsonResponse|RedirectResponse
    {
        $user = $request->user();

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'middle_name' => ['nullable', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'gender' => ['nullable', Rule::in(['Female', 'Male', 'Non-binary', 'Prefer not to say'])],
            'phone' => ['nullable', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{7,32}$/'],
            'job_title' => ['nullable', 'string', 'max:120'],
            'bio' => ['nullable', 'string', 'max:1000'],
            'linkedin_url' => ['nullable', 'string', 'max:255', 'regex:/^(https:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+/i'],
            'avatar_photo' => ['nullable', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'source' => ['nullable', Rule::in(['upload', 'provider'])],
        ], [
            'avatar_photo.image' => 'That file is not an image. Use a JPG, PNG, or WebP.',
            'avatar_photo.max' => 'That image is too large. Keep it under 8 MB.',
            'phone.regex' => 'Enter a phone number, like +1 555 123 4567.',
            'linkedin_url.regex' => 'Enter a LinkedIn profile address, like linkedin.com/in/your-name.',
        ]);

        $linkedin = $data['linkedin_url'] ?? null;
        if ($linkedin && ! str_starts_with($linkedin, 'http')) {
            $linkedin = 'https://'.$linkedin;
        }

        $fill = [
            'first_name' => $data['first_name'],
            'middle_name' => $data['middle_name'] ?? null,
            'last_name' => $data['last_name'],
            'gender' => $data['gender'] ?? null,
            'phone' => $data['phone'] ?? null,
            'job_title' => $data['job_title'] ?? null,
            'bio' => $data['bio'] ?? null,
            'linkedin_url' => $linkedin,
        ];

        // Email and account type are not self-service: an administrator owns
        // those. A new upload replaces the current photo; choosing "provider"
        // switches back to the Google/Microsoft photo we kept on file.
        if ($request->hasFile('avatar_photo') && ($data['source'] ?? 'upload') !== 'provider') {
            $fill['avatar_url'] = AvatarService::storeUploaded($request->file('avatar_photo'), $user->avatar_url);
        } elseif (($data['source'] ?? null) === 'provider' && $user->provider_avatar_url) {
            $fill['avatar_url'] = $user->provider_avatar_url;
        }

        $user->forceFill($fill);
        $user->syncDisplayName();
        $user->save();

        if ($request->wantsJson()) {
            return response()->json(['status' => 'ok', 'name' => $user->name]);
        }

        return redirect()->route('profile')->with('status', 'profile-updated');
    }
}
