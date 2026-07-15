<?php

namespace App\Http\Controllers;

use App\Support\AvatarService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class ProfileSetupController extends Controller
{
    public function show(Request $request): View
    {
        return view('auth.profile-setup', [
            'user' => $request->user(),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();
        $hasProviderPhoto = (bool) $user->provider_avatar_url;

        $data = $request->validate([
            'first_name' => ['required', 'string', 'max:100'],
            'middle_name' => ['nullable', 'string', 'max:100'],
            'last_name' => ['required', 'string', 'max:100'],
            'gender' => ['required', Rule::in(['Female', 'Male', 'Non-binary', 'Prefer not to say'])],
            // A real photo is required — unless a Google/Microsoft photo is
            // already on file, in which case uploading is optional.
            'avatar_photo' => [$hasProviderPhoto ? 'nullable' : 'required', 'image', 'mimes:jpeg,jpg,png,webp', 'max:8192'],
            'avatar_choice' => ['nullable', Rule::in(['provider', 'upload'])],
            'phone' => ['required', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{7,32}$/'],
            'job_title' => ['required', 'string', 'max:120'],
            'bio' => ['nullable', 'string', 'max:1000'],
            'linkedin_url' => ['nullable', 'string', 'max:255', 'regex:/^(https:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+/i'],
        ], [
            'avatar_photo.required' => 'Please upload a photo of yourself.',
            'avatar_photo.image' => 'That file is not an image. Use a JPG, PNG, or WebP.',
            'avatar_photo.max' => 'That image is too large. Keep it under 8 MB.',
            'phone.regex' => 'Enter a phone number, like +1 555 123 4567.',
            'linkedin_url.regex' => 'Enter a LinkedIn profile address, like linkedin.com/in/your-name.',
        ]);

        $fill = [
            'first_name' => $data['first_name'],
            'middle_name' => $data['middle_name'] ?? null,
            'last_name' => $data['last_name'],
            'gender' => $data['gender'] ?? null,
            'phone' => $data['phone'] ?? null,
            'job_title' => $data['job_title'] ?? null,
            'bio' => $data['bio'] ?? null,
            'linkedin_url' => $this->normalizeLinkedIn($data['linkedin_url'] ?? null),
            'profile_completed_at' => now(),
        ];

        if ($request->hasFile('avatar_photo') && ($data['avatar_choice'] ?? 'upload') !== 'provider') {
            $fill['avatar_url'] = AvatarService::storeUploaded($request->file('avatar_photo'), $user->avatar_url);
        } elseif ($hasProviderPhoto && ($data['avatar_choice'] ?? 'provider') === 'provider') {
            $fill['avatar_url'] = $user->provider_avatar_url;
        }

        $user->forceFill($fill);
        $user->syncDisplayName();
        $user->save();

        return redirect('/');
    }

    private function normalizeLinkedIn(?string $url): ?string
    {
        if (! $url) {
            return null;
        }

        return str_starts_with($url, 'http') ? $url : 'https://'.$url;
    }
}
