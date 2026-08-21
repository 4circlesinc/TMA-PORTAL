<?php

namespace App\Http\Controllers;

use App\Actions\Fortify\PasswordValidationRules;
use App\Models\AuthEvent;
use App\Models\User;
use App\Support\AuthenticatorApp;
use App\Support\Security\SecurityAlerts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SecuritySettingsController extends Controller
{
    use PasswordValidationRules;

    /**
     * JSON feed for the Account settings > Security pages (portal-admin.js).
     */
    public function data(Request $request): JsonResponse
    {
        $user = $request->user();

        $failed = AuthEvent::where('user_id', $user->id)
            ->whereIn('event', ['login_failed', 'lockout'])
            ->where('created_at', '>=', now()->subDays(7))
            ->count();

        $events = AuthEvent::where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(20)
            ->get()
            ->map(fn (AuthEvent $event) => [
                'event' => $event->event,
                'detail' => $event->detail,
                'when' => $event->created_at->diffForHumans(),
                'atIso' => $event->created_at->toIso8601String(),
                'ip' => $event->ip,
                'device' => $this->describeAgent((string) $event->user_agent),
            ]);

        $google = $user->connectedAccount('google');
        $microsoft = $user->connectedAccount('microsoft');

        return response()->json([
            'email' => $user->email,
            'google' => ['connected' => (bool) $google, 'email' => $google?->email],
            'microsoft' => ['connected' => (bool) $microsoft, 'email' => $microsoft?->email],
            'hasRealPassword' => ! $user->password_auto,
            'phone' => $user->phone,
            'alerts' => SecurityAlerts::forUser($user),
            'syncAvailable' => [
                'google' => (bool) config('services.google.sync'),
                'microsoft' => (bool) config('services.microsoft.sync'),
            ],
            'trustedDevices' => $user->trustedDevices()
                ->where('expires_at', '>', now())
                ->orderByDesc('last_used_at')
                ->get()
                ->map(fn ($device) => [
                    'id' => $device->id,
                    'device' => $device->device,
                    'ip' => $device->ip,
                    'lastUsed' => $device->last_used_at?->diffForHumans(),
                    'expires' => $device->expires_at->diffForHumans(),
                ]),
            'twoFactor' => $user->two_factor_confirmed_at ? 'on' : ($user->two_factor_secret ? 'pending' : 'off'),
            'twoFactorSince' => $user->two_factor_confirmed_at?->format('j M Y'),
            'twoFactorApp' => AuthenticatorApp::meta($user->two_factor_app),
            'recoveryCodesCount' => $user->two_factor_confirmed_at ? count($user->recoveryCodes()) : 0,
            'failedSignins7d' => $failed,
            'sessions' => $this->sessionsFor($user, $request->session()->getId())->values(),
            'events' => $events,
        ]);
    }

    /**
     * Set (or replace) the account's phone number.
     *
     * The same `users.phone` column My profile writes — the two screens are
     * two doors onto one number, not two numbers. Nothing here claims the
     * number is verified: verification needs an SMS gateway, and the portal
     * has none configured, so `phone_verified_at` deliberately stays null
     * rather than being stamped on trust.
     */
    public function updatePhone(Request $request): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{7,32}$/'],
        ], [
            'phone.regex' => 'Enter a phone number, like +1 555 123 4567.',
        ]);

        $request->user()->forceFill([
            'phone' => $data['phone'],
            'phone_verified_at' => null,
        ])->save();

        return response()->json(['status' => 'ok', 'phone' => $data['phone']]);
    }

    public function removePhone(Request $request): JsonResponse
    {
        $request->user()->forceFill(['phone' => null, 'phone_verified_at' => null])->save();

        return response()->json(['status' => 'ok', 'phone' => null]);
    }

    /** Save the Security notifications switches. */
    public function updateAlerts(Request $request): JsonResponse
    {
        $rules = [];
        foreach (array_keys(SecurityAlerts::DEFAULTS) as $key) {
            $rules[$key] = ['sometimes', 'boolean'];
        }
        $data = $request->validate($rules);

        return response()->json([
            'status' => 'ok',
            'alerts' => SecurityAlerts::update($request->user(), $data),
        ]);
    }

    /**
     * Give an account with no password of its own one — the only way a person
     * who joined through Google/Microsoft, or was created by an administrator,
     * can get a password without going through "forgot password".
     *
     * Fortify's own endpoint can't do this: it demands the current password,
     * which is a random string nobody has ever seen.
     */
    public function setPassword(Request $request): JsonResponse
    {
        $user = $request->user();

        if (! $user->password_auto) {
            throw ValidationException::withMessages([
                'password' => 'Your account already has a password. Use "Change password" instead.',
            ]);
        }

        $data = $request->validate([
            'password' => $this->passwordRules(),
        ]);

        $user->forceFill([
            'password' => Hash::make($data['password']),
            'password_auto' => false,
        ])->save();

        return response()->json(['status' => 'ok']);
    }

    /**
     * End one other session. The client never sees a real session id — that is
     * a bearer token for that browser — so sessions are addressed by a digest
     * of the id and matched back here.
     */
    public function revokeSession(Request $request, string $session): JsonResponse
    {
        $current = $request->session()->getId();

        $match = DB::table('sessions')
            ->where('user_id', $request->user()->id)
            ->get()
            ->first(fn ($row) => $row->id !== $current && hash('sha256', (string) $row->id) === $session);

        if (! $match) {
            return response()->json(['message' => 'That session has already ended.'], 404);
        }

        DB::table('sessions')->where('id', $match->id)->delete();

        // Dropping the row is not enough on its own. A browser that answered
        // "yes" to Stay signed in holds a remember-me cookie and would simply
        // let itself back in on the next request, so the button would look
        // like it worked and do nothing. Remember tokens belong to the
        // account, not the session, so the only way to stop that one device is
        // to cycle the token — which asks every other remembered device to
        // sign in again. For a security control that is the safe way to be
        // wrong, and the UI says so.
        $user = $request->user();
        $user->setRememberToken(Str::random(60));
        $user->save();

        // …then hand this browser the new token, so the person doing the
        // signing-out isn't the one who gets signed out.
        $guard = Auth::guard('web');
        if ($request->cookies->has($guard->getRecallerName())) {
            $guard->getCookieJar()->queue($guard->getCookieJar()->forever(
                $guard->getRecallerName(),
                $user->getAuthIdentifier().'|'.$user->getRememberToken().'|'.$user->getAuthPassword(),
            ));
        }

        return response()->json(['status' => 'ok']);
    }

    public function revokeTrustedDevice(Request $request, int $device): JsonResponse
    {
        $request->user()->trustedDevices()->where('id', $device)->delete();

        return response()->json(['status' => 'ok']);
    }

    public function revokeAllTrustedDevices(Request $request): JsonResponse
    {
        $request->user()->trustedDevices()->delete();

        return response()->json(['status' => 'ok']);
    }

    public function setTwoFactorApp(Request $request): JsonResponse
    {
        $data = $request->validate([
            'app' => ['required', Rule::in(AuthenticatorApp::KEYS)],
        ]);

        $request->user()->forceFill(['two_factor_app' => $data['app']])->save();

        return response()->json(['status' => 'ok']);
    }

    public function logoutOtherDevices(Request $request): JsonResponse|RedirectResponse
    {
        $request->validate([
            'password' => ['required', 'current_password'],
        ]);

        Auth::logoutOtherDevices($request->string('password'));

        DB::table('sessions')
            ->where('user_id', $request->user()->id)
            ->where('id', '!=', $request->session()->getId())
            ->delete();

        if ($request->wantsJson()) {
            return response()->json(['status' => 'ok']);
        }

        return back()->with('status', 'other-sessions-ended');
    }

    private function sessionsFor(User $user, string $currentSessionId): Collection
    {
        return DB::table('sessions')
            ->where('user_id', $user->id)
            ->orderByDesc('last_activity')
            ->get()
            ->map(fn ($session) => (object) [
                // A digest, never the session id itself: the id is the cookie
                // value that browser signs in with, and rendering it into this
                // page would hand every other session's key to whatever runs
                // here. revokeSession() matches on the same digest.
                'id' => hash('sha256', (string) $session->id),
                'device' => $this->describeAgent((string) $session->user_agent),
                'ip' => $session->ip_address,
                'lastActive' => now()->setTimestamp($session->last_activity)->diffForHumans(),
                'current' => $session->id === $currentSessionId,
            ]);
    }

    private function describeAgent(string $agent): string
    {
        $browser = match (true) {
            str_contains($agent, 'Edg/') => 'Edge',
            str_contains($agent, 'Chrome/') => 'Chrome',
            str_contains($agent, 'Safari/') => 'Safari',
            str_contains($agent, 'Firefox/') => 'Firefox',
            default => 'Browser',
        };

        $platform = match (true) {
            str_contains($agent, 'iPhone') => 'iPhone',
            str_contains($agent, 'Android') => 'Android',
            str_contains($agent, 'Macintosh') => 'Mac',
            str_contains($agent, 'Windows') => 'Windows',
            str_contains($agent, 'Linux') => 'Linux',
            default => 'Unknown device',
        };

        return "{$browser} on {$platform}";
    }
}
