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
 * this shipped) are left alone rather than kicked out on deploy.
 */
class EnforceSessionExpiry
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (
            ! $user
            || $user->last_authenticated_at === null
            || $request->routeIs('logout')
        ) {
            return $next($request);
        }

        $days = SecurityPolicies::sessionDays();

        if ($user->last_authenticated_at->gt(now()->subDays($days))) {
            return $next($request);
        }

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
