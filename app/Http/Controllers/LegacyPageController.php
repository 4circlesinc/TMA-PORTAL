<?php

namespace App\Http\Controllers;

use App\Support\Access\Role;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Pages;
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
     * duplicate sidebar from resources/portal-pages, that was the source of
     * the "menu keeps reverting to an old order" bug.
     */
    public const SPA_PAGES = [
        'account',
        'account-settings',
        'calendar',
        // Staff-only (Role::PAGE_CAPABILITIES): recordings of client calls.
        'call-recordings',
        'citizenship-applications',
        'clients',
        'email',
        'email/templates',
        // Compose popped into its own window (desktop app or a portal popup).
        'email/compose',
        // The File Library, screen by screen. The sidebar links straight to
        // these, so anything the SPA can push must also be servable, a hard
        // refresh on /folders/all used to 404.
        'folders/all',
        'folders/clients',
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
        'reporting',
        'settings',
        'settings/change-email',
        'signatures',
        'social/feed',
        'social/messages',
        'templates',
        'templates/email',
        'templates/letters',
        'templates/documents',
        'users',
        'users/new',
        'workflows',
        'workflows/feedback',
        'workflows/updates',
    ];

    /**
     * Standalone portal HTML (not the main SPA shell). Intentionally separate
     * layouts, classic design, onboarding, billing wizards.
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

    /** One approved shell, menu order lives only here. */
    public static function spaShellPath(): string
    {
        return resource_path('views/pages/dashboard.html');
    }

    /**
     * Any path under /clients or /citizenship-applications: a file, a company,
     * an edit screen.
     *
     * The shell is the same one the list page gets; clients.js reads the path
     * and opens the right screen. Gated on the same capability as the list,
     * so a deep link is no way around the directory being closed to somebody.
     *
     * /clients still exists so old bookmarks open, then we send them to
     * /citizenship-applications so the address names the application.
     */
    public function clients(Request $request): Response
    {
        abort_unless($this->canViewClientsPage($request), 404);

        if ($redirect = $this->redirectLegacyClientsPath($request)) {
            return $redirect;
        }

        return PortalShell::respond(self::spaShellPath(), $request->user());
    }

    public function __invoke(Request $request, string $page): Response
    {
        if (in_array($page, self::PUBLIC_PAGES, true)) {
            $path = public_path($page.'/index.html');
        } elseif (in_array($page, self::SPA_PAGES, true)) {
            // A page the account may not use does not exist as far as it is
            // concerned. 404, not 403, so the portal never advertises the
            // staff tooling a client can't reach.
            if ($page === 'clients' || $page === 'citizenship-applications') {
                abort_unless($this->canViewClientsPage($request), 404);
                if ($page === 'clients' && ($redirect = $this->redirectLegacyClientsPath($request))) {
                    return $redirect;
                }
            } elseif ($page === 'folders/all') {
                abort_unless($this->canViewAllFilesPage($request), 404);
            } elseif ($page === 'workflows' || $page === 'workflows/feedback' || $page === 'workflows/updates') {
                abort_unless($this->canViewWorkflowsPage($request), 404);
            } elseif ($page === 'overview') {
                abort_unless($this->canViewOverviewPage($request), 404);
            } else {
                abort_unless(Role::canViewPage($request->user(), $page), 404);
            }

            // Reporting used to live under Account settings. Bookmarks and
            // search results still carry that query; send them to the page.
            if ($page === 'account-settings' && $request->query('settings-page') === 'reporting') {
                return redirect('/reporting');
            }

            // Hard-refreshing a portal URL gets the same shell the dashboard
            // does, capabilities and no-store headers included, otherwise the
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

    /**
     * /citizenship-applications is the CIP workspace shell. /clients is the
     * same page under the hub's old name; it redirects so the address says so.
     *
     * Staff still need `clients.view`. External CIP users (service-provider
     * contacts and private clients) hold no matrix capabilities by design, so
     * they are admitted by CIP reach instead.
     */
    private function canViewClientsPage(Request $request): bool
    {
        $user = $request->user();

        return Role::canViewPage($user, 'clients') || CipAccess::canReach($user);
    }

    /**
     * Old /clients bookmarks, rewritten to /citizenship-applications.
     *
     * `tab=info` was the hub contact. An application has no such tab, so it
     * is dropped rather than carried onto the new address.
     */
    private function redirectLegacyClientsPath(Request $request): ?Response
    {
        $path = $request->path();
        if ($path !== 'clients' && ! str_starts_with($path, 'clients/')) {
            return null;
        }

        $rest = $path === 'clients' ? '' : substr($path, strlen('clients'));
        $query = $request->query();
        if (($query['tab'] ?? null) === 'info') {
            unset($query['tab']);
        }

        $target = Pages::HOME.$rest;
        if ($query !== []) {
            $target .= '?'.http_build_query($query);
        }

        return redirect($target);
    }

    /**
     * Overview is staff tooling in the matrix, but the half of it that is not
     * administrator-only — your profile, your week, your recent files, your
     * notifications, your activity — is exactly as true of a service-provider
     * contact as of an employee. They already get a KPI row of their own on
     * the home page; without this the same account had a Dashboard and no
     * Overview behind it.
     *
     * The administrator tabs (Employees, Users, Recycle Bin) are chosen in
     * overview.js off `isAdmin`, and every one of them is separately enforced
     * server-side, so opening the page opens nothing else.
     */
    private function canViewOverviewPage(Request $request): bool
    {
        $user = $request->user();

        return Role::canViewPage($user, 'overview') || CipAccess::isProviderContact($user);
    }

    /**
     * All Files is the organization tree for staff. External CIP accounts
     * (provider contacts and private clients) get the same page, scoped to
     * the Clients folder, so the sidebar is not missing All Files for them.
     */
    private function canViewAllFilesPage(Request $request): bool
    {
        $user = $request->user();

        return Role::canViewPage($user, 'folders/all') || CipAccess::canReach($user);
    }

    /**
     * Workflows is staff tooling in the matrix. Service-provider contacts
     * still need the inbox of requests on the client files they can open,
     * without holding `workflows.view` (that would also open it to every
     * other Client account).
     */
    private function canViewWorkflowsPage(Request $request): bool
    {
        $user = $request->user();

        return CipAccess::canViewWorkflows($user);
    }
}
