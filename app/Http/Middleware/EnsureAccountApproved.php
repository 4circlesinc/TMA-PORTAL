<?php

namespace App\Http\Middleware;

use App\Support\Access\Role;
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

        // 'Employee' is no longer a working role — the portal's roles are the
        // brief's five. An approved account still typed Employee is held on
        // the role-pending screen until an administrator assigns it a real
        // role from the Users page.
        if ($user && $user->account_type === Role::EMPLOYEE) {
            return redirect('/auth/role-pending');
        }

        return $next($request);
    }
}
