<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\PortalShell;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class LegacyPageController extends Controller
{
    /** Publicly reachable static pages (stay in public/). */
    public const PUBLIC_PAGES = [
        '404',
        'coming-soon',
        'maintenance',
        'pricing',
        'privacy-policy',
        'terms-of-service',
    ];

    /**
     * Portal routes that use the single SPA shell
     * ({@see resource_path('views/pages/dashboard.html')}).
     *
     * Hard-refreshing /email, /overview, etc. must never load a stale
     * duplicate sidebar from resources/portal-pages — that was the source of
     * the "menu keeps reverting to an old order" bug.
     */
    public const SPA_PAGES = [
        'account',
        'account-settings',
        'calendar',
        // Staff-only (Role::PAGE_CAPABILITIES): recordings of client calls.
        'call-recordings',
        // Admin-only while in development (Role::PAGE_CAPABILITIES gates it,
        // and the whole module vanishes when FEATURE_CBI is off).
        'cbi',
        'clients',
        'email',
        'email/templates',
        // The File Library, screen by screen. The sidebar links straight to
        // these, so anything the SPA can push must also be servable — a hard
        // refresh on /folders/all used to 404.
        'folders/all',
        'folders/personal',
        'folders/shared',
        'folders/shared-with-me',
        'folders/favorites',
        'folders/recent',
        'folders/filebox',
        'folders/recycle',
        'overview',
        // The People section. Every screen is a real URL, so hard-refreshing
        // (or opening a link to) one loads the shell instead of 404ing and
        // sending the visitor back to the dashboard.
        'people',
        'people/employees',
        'people/clients',
        'people/prospects',
        'people/shared-address-book',
        'people/personal-address-book',
        'people/distribution-groups',
        'people/resend-welcome-emails',
        'projects',
        'projects/all',
        'projects/closed',
        'projects/recently_deleted',
        'reporting',
        'settings',
        'settings/change-email',
        'signatures',
        'social/feed',
        'social/messages',
        'templates',
        'users',
        'users/new',
        'workflows',
        'workflows/feedback',
    ];

    /**
     * Standalone portal HTML (not the main SPA shell). Intentionally separate
     * layouts — classic design, onboarding, billing wizards.
     */
    public const STANDALONE_PAGES = [
        'account-info',
        'billing-details',
        'billing-details/card',
        'choose-account-type',
        'classic',
    ];

    /** @deprecated Use SPA_PAGES + STANDALONE_PAGES. Kept for route registration. */
    public const PORTAL_PAGES = [
        ...self::SPA_PAGES,
        ...self::STANDALONE_PAGES,
    ];

    /** One approved shell — menu order lives only here. */
    public static function spaShellPath(): string
    {
        return resource_path('views/pages/dashboard.html');
    }

    /**
     * Any path under /clients — a client, a company, an edit screen.
     *
     * The shell is the same one /clients gets; clients.js reads the path and
     * opens the right screen. Gated on the same capability as /clients itself,
     * so a deep link is no way around the directory being closed to somebody.
     */
    public function clients(Request $request): Response
    {
        abort_unless(Role::canViewPage($request->user(), 'clients'), 404);

        return PortalShell::respond(self::spaShellPath(), $request->user());
    }

    public function __invoke(Request $request, string $page): Response
    {
        if (in_array($page, self::PUBLIC_PAGES, true)) {
            $path = public_path($page.'/index.html');
        } elseif (in_array($page, self::SPA_PAGES, true)) {
            // A page the account may not use does not exist as far as it is
            // concerned — 404, not 403, so the portal never advertises the
            // staff tooling a client can't reach.
            abort_unless(Role::canViewPage($request->user(), $page), 404);

            // Reporting used to live under Account settings. Bookmarks and
            // search results still carry that query; send them to the page.
            if ($page === 'account-settings' && $request->query('settings-page') === 'reporting') {
                return redirect('/reporting');
            }

            // Hard-refreshing a portal URL gets the same shell the dashboard
            // does, capabilities and no-store headers included — otherwise the
            // sidebar would paint its six blank gaps on every page but /.
            return PortalShell::respond(self::spaShellPath(), $request->user());
        } elseif (in_array($page, self::STANDALONE_PAGES, true)) {
            abort_unless(Role::canViewPage($request->user(), $page), 404);

            $path = resource_path('portal-pages/'.$page.'/index.html');
        } else {
            abort(404);
        }

        abort_unless(is_file($path), 404);

        // Only the public and standalone pages reach here; the SPA shell went
        // out above, where its no-store headers live with the rest of it.
        return response()->file($path);
    }
}
