<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAccountApproved
{
    /**
     * Verified users whose account has not yet been approved by an
     * administrator are held on the pending screen.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->status === 'suspended') {
            auth()->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return redirect()->route('login')->with('social_error', 'Your account has been suspended. Contact support if you believe this is a mistake.');
        }

        if ($user && ! $user->isApproved()) {
            return redirect('/auth/pending');
        }

        return $next($request);
    }
}
