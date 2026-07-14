<?php

namespace App\Http\Controllers;

use App\Models\AuthEvent;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\View\View;

class SecuritySettingsController extends Controller
{
    public function show(Request $request): View
    {
        $user = $request->user();

        // Recovery codes are displayed only immediately after being (re)generated.
        $showRecoveryCodes = in_array(session('status'), [
            'two-factor-authentication-confirmed',
            'recovery-codes-generated',
        ], true);

        return view('security.settings', [
            'user' => $user,
            'sessions' => $this->sessionsFor($user, $request->session()->getId()),
            'events' => AuthEvent::where('user_id', $user->id)->orderByDesc('created_at')->limit(20)->get(),
            'showRecoveryCodes' => $showRecoveryCodes,
        ]);
    }

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
                'when' => $event->created_at->diffForHumans(),
                'atIso' => $event->created_at->toIso8601String(),
                'ip' => $event->ip,
                'device' => $this->describeAgent((string) $event->user_agent),
            ]);

        $google = $user->connectedAccount('google');

        return response()->json([
            'email' => $user->email,
            'google' => ['connected' => (bool) $google, 'email' => $google?->email],
            'hasRealPassword' => ! $user->password_auto,
            'twoFactor' => $user->two_factor_confirmed_at ? 'on' : ($user->two_factor_secret ? 'pending' : 'off'),
            'twoFactorSince' => $user->two_factor_confirmed_at?->format('j M Y'),
            'recoveryCodesCount' => $user->two_factor_confirmed_at ? count($user->recoveryCodes()) : 0,
            'failedSignins7d' => $failed,
            'sessions' => $this->sessionsFor($user, $request->session()->getId())->values(),
            'events' => $events,
        ]);
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
