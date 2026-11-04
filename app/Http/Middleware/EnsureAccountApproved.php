<?php

namespace App\Http\Middleware;

use App\Support\Access\Impersonation;
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

        // A suspended account logs its own session out. While an administrator
        // is viewing one, that logout would take the administrator with it.
        // Put them back on their own account instead.
        if ($user && Impersonation::isActive() && ($user->status === 'suspended' || ! $user->isApproved())) {
            $return = Impersonation::stop($request);

            return redirect($return);
        }

        if ($user && Impersonation::isActive()) {
            return $next($request);
        }

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
