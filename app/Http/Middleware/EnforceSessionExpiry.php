<?php

namespace App\Http\Middleware;

use App\Support\SecurityPolicies;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Absolute sign-in lifetime. Idle timeout (SESSION_LIFETIME) still applies;
 * this is the "everyone signs in again every N days" cap, including people
 * who chose Stay signed in.
 *
 * Accounts that never got a stamp (tests using actingAs, sessions from before
 * this shipped) are left alone rather than kicked out on deploy — unless a
 * one-time force-reauth cutoff is set, which logs those sessions out too.
 */
class EnforceSessionExpiry
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || $request->routeIs('logout')) {
            return $next($request);
        }

        $stamp = $user->last_authenticated_at;
        $cutoff = SecurityPolicies::forceReauthAfter();

        if ($cutoff && ($stamp === null || $stamp->lt($cutoff))) {
            return $this->expire($request);
        }

        if ($stamp === null) {
            return $next($request);
        }

        $days = SecurityPolicies::sessionDays();

        if ($stamp->gt(now()->subDays($days))) {
            return $next($request);
        }

        return $this->expire($request);
    }

    private function expire(Request $request): Response
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        if ($request->expectsJson()) {
            return response()->json([
                'message' => 'Your sign-in expired. Sign in again.',
                'code' => 'session-expired',
                'redirect' => route('login'),
            ], 401);
        }

        return redirect()->route('login')->with('status', 'session-expired');
    }
}
