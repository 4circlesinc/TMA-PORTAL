<?php

namespace App\Support\Access;

use App\Models\User;

/**
 * Who may see and do what, in one place.
 *
 * The portal has three account types on users.account_type — Client, Employee
 * and Administrator — and before this class every gate was an inline
 * `in_array($user->account_type, ['Administrator', 'Employee'])` repeated
 * across ~28 files. That made "what can a client actually reach?" a question
 * only a grep could answer, and it meant a new page could ship with no gate at
 * all simply because nobody remembered to add one.
 *
 * Everything now asks this class instead. {@see self::MATRIX} is the whole
 * access model: one capability per row, the roles that hold it per value.
 * Administrators hold every capability by definition and are never listed.
 *
 * The same capability names travel to the browser (see MeController::show) so
 * the sidebar, the mobile menu and the global search index hide exactly what
 * the server would refuse. The browser copy is a courtesy — every capability
 * is still enforced server-side.
 */
class Role
{
    public const CLIENT = 'Client';
    public const EMPLOYEE = 'Employee';
    public const ADMINISTRATOR = 'Administrator';

    /** Every assignable account type, in ascending order of reach. */
    public const ALL = [self::CLIENT, self::EMPLOYEE, self::ADMINISTRATOR];

    /** Everyone who works here, as opposed to the clients they work for. */
    public const STAFF = [self::ADMINISTRATOR, self::EMPLOYEE];

    /**
     * capability => the non-administrator roles that hold it.
     *
     * An empty array means administrators only. A capability that is not
     * listed here at all is unknown, and self::can() refuses it — so a typo
     * denies access rather than silently granting it.
     */
    private const MATRIX = [
        /* ── Clients ─────────────────────────────────────────────────── */
        // Reach the Clients hub at all.
        'clients.view' => [self::EMPLOYEE],
        // See every client record, rather than only the ones you are assigned
        // to. Move this to [] to scope employees to their own assignments —
        // client_assignments already drives folder access, so the data is there.
        'clients.viewAll' => [self::EMPLOYEE],
        // Create, edit, duplicate and delete client records.
        'clients.manage' => [self::EMPLOYEE],
        // Invite a client to create a portal account.
        'clients.invite' => [self::EMPLOYEE],
        // Decide which staff are assigned to which client.
        'clients.assign' => [],

        /* ── People and users ────────────────────────────────────────── */
        // Read the user directory (the Users page, the People section).
        'users.view' => [self::EMPLOYEE],
        // Create, approve, suspend, delete and re-type accounts.
        'users.manage' => [],
        // See colleagues' online/away presence and their work plans.
        'presence.view' => [self::EMPLOYEE],

        /* ── Communication ───────────────────────────────────────────── */
        // Use the portal mailbox (Gmail/Graph). Clients talk via Messages.
        'mail.use' => [self::EMPLOYEE],
        // The internal social feed.
        'feed.view' => [self::EMPLOYEE],
        // Start a conversation with anyone in the organization. Clients are
        // restricted to the staff assigned to them — see MessagingController.
        'messaging.contactAll' => [self::EMPLOYEE],

        /* ── Files ───────────────────────────────────────────────────── */
        // Browse the organization file tree (All Files, Shared Folders).
        // Clients still reach their own folder and anything shared with them.
        'files.viewOrg' => [self::EMPLOYEE],
        // Rehome system folders, delete another person's content.
        'files.admin' => [],
        // The File Library settings page (folder types, auto-provisioning).
        'files.settings' => [],

        /* ── Work ────────────────────────────────────────────────────── */
        // Create and send signature requests. Everyone can *sign* one
        // addressed to them; this is the authoring side.
        'signatures.create' => [self::EMPLOYEE],
        // Document templates.
        'templates.view' => [self::EMPLOYEE],
        // Automated workflows and the approval queue.
        'workflows.view' => [self::EMPLOYEE],
        // The Project Overview page (firm activity, storage, recycle bin).
        'overview.view' => [self::EMPLOYEE],
        // Read the whole firm's audit trail rather than only your own.
        'activity.viewAll' => [],

        /* ── Calendar ────────────────────────────────────────────────── */
        // Shared and group calendars, and colleagues' availability. Clients
        // keep their own calendar and the meetings they are invited to.
        'calendar.staff' => [self::EMPLOYEE],
        // The organization calendar and other people's calendar membership.
        'calendar.admin' => [],

        /* ── Groups ──────────────────────────────────────────────────── */
        // See teams, departments, projects and committees.
        'groups.view' => [self::EMPLOYEE],
        // Create and delete groups (a group manager curates membership only).
        'groups.manage' => [],

        /* ── Administration ──────────────────────────────────────────── */
        // The firm-wide recycle bin.
        'recyclebin.admin' => [],
        // Password, session and two-factor policy for the whole portal.
        'settings.security' => [],
        // Google/Microsoft connectors, enabled org-wide.
        'settings.connectors' => [],
    ];

    /**
     * Portal page slug => the capability needed to load it.
     *
     * Pages absent from this map are open to every approved account (their
     * own dashboard, calendar, files, signatures, messages and settings).
     * Without this the shell was served to anyone and only the API refused,
     * so a client clicking "Clients" got a real page that then filled with
     * permission errors.
     */
    private const PAGE_CAPABILITIES = [
        'clients' => 'clients.view',
        'email' => 'mail.use',
        'email/templates' => 'mail.use',
        'overview' => 'overview.view',
        // The People section, screen by screen. These mirror portal-access.js
        // exactly: the sidebar hides what the server would refuse.
        'people' => 'users.view',
        'people/employees' => 'users.view',
        'people/clients' => 'clients.view',
        'people/prospects' => 'clients.view',
        'people/shared-address-book' => 'users.view',
        'people/personal-address-book' => 'users.view',
        'people/distribution-groups' => 'groups.view',
        'people/resend-welcome-emails' => 'users.manage',
        'social/feed' => 'feed.view',
        'users' => 'users.view',
        'users/new' => 'users.manage',
    ];

    /** Every capability name the portal knows about. */
    public static function capabilityNames(): array
    {
        return array_keys(self::MATRIX);
    }

    /** The capability a portal page needs, or null when it is open to all. */
    public static function pageCapability(string $page): ?string
    {
        return self::PAGE_CAPABILITIES[$page] ?? null;
    }

    /** May this user load the given portal page? */
    public static function canViewPage(?User $user, string $page): bool
    {
        $capability = self::pageCapability($page);

        return $capability === null || self::can($user, $capability);
    }

    public static function of(?User $user): ?string
    {
        return $user?->account_type;
    }

    public static function isAdmin(?User $user): bool
    {
        return self::of($user) === self::ADMINISTRATOR;
    }

    public static function isStaff(?User $user): bool
    {
        return in_array(self::of($user), self::STAFF, true);
    }

    public static function isClient(?User $user): bool
    {
        return self::of($user) === self::CLIENT;
    }

    /**
     * Does this user hold the capability? Administrators always do; an unknown
     * capability is always denied.
     */
    public static function can(?User $user, string $capability): bool
    {
        if ($user === null) {
            return false;
        }

        if (self::isAdmin($user)) {
            return true;
        }

        if (! array_key_exists($capability, self::MATRIX)) {
            return false;
        }

        return in_array(self::of($user), self::MATRIX[$capability], true);
    }

    /** Every capability this user holds — the list handed to the browser. */
    public static function capabilities(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        if (self::isAdmin($user)) {
            return self::capabilityNames();
        }

        return array_values(array_filter(
            self::capabilityNames(),
            fn (string $capability) => self::can($user, $capability),
        ));
    }

    /** Refuse the request unless the user holds the capability. */
    public static function authorize(?User $user, string $capability): void
    {
        abort_unless(self::can($user, $capability), 403, 'You do not have access to this.');
    }

    /** Refuse the request unless the user is staff. */
    public static function authorizeStaff(?User $user): void
    {
        abort_unless(self::isStaff($user), 403, 'Staff only.');
    }

    /** Refuse the request unless the user is an administrator. */
    public static function authorizeAdmin(?User $user): void
    {
        abort_unless(self::isAdmin($user), 403, 'Administrators only.');
    }
}
