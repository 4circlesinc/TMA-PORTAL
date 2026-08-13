<?php

namespace App\Support\Access;

use App\Models\User;
use App\Support\Clients\ClientHubSettings;

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
        // These five are the baseline, not the last word: an administrator can
        // grant or revoke each of them for employees from Account settings >
        // Client hub management > Client hub access. See ClientHubSettings,
        // which self::can() consults for exactly this block.
        //
        // Reach the Clients hub at all.
        'clients.view' => [self::EMPLOYEE],
        // See every client record, rather than only the ones you are assigned
        // to. Employees are scoped to their live assignments — the same rows
        // that drive folder access, so what they can open and what they can
        // find agree. Enforced by App\Support\Access\ClientScope, which every
        // client query goes through; this row on its own decides nothing.
        'clients.viewAll' => [],
        // Create, edit, duplicate and delete client records.
        'clients.manage' => [self::EMPLOYEE],
        // Invite a client to create a portal account.
        'clients.invite' => [self::EMPLOYEE],
        // Decide which staff are assigned to which client.
        'clients.assign' => [],

        /* ── CBI (Citizenship by Investment) ─────────────────────────── */
        // Admin-only while the module is in development, and additionally
        // dark everywhere FEATURE_CBI is off — see the flag check in can().
        // Widen to [self::EMPLOYEE] (or per-role grants) at launch.
        'cbi.view' => [],

        /* ── CIP (native application-management portal) ──────────────── */
        // The CBI mirror's replacement. Every cip.* capability is dark while
        // FEATURE_CIP is off — see the flag check in can(), which sits before
        // the admin short-circuit so the module does not exist for anyone.
        //
        // Reach the CIP section. Staff-wide; external Service Provider
        // contacts and private clients arrive with their scoped views in a
        // later phase. Row visibility is App\Support\Cip\ApplicationScope —
        // this row on its own shows nobody any application.
        'cip.view' => [self::EMPLOYEE],
        // Create an application as staff. External creators (provider
        // contacts, private clients) are NOT granted through the matrix —
        // clients hold no matrix capability, ever — their reach is answered
        // by ApplicationScope and the engine's creator check, the same way
        // CompanyAccess answers for company members.
        'cip.create' => [self::EMPLOYEE],
        // Officer verbs. Admin-only here; specific employees are widened
        // per-user through App\Support\Cip\CipAccess grants (a CRO holds
        // cip.review, a Compliance Officer holds cip.compliance + cip.decide).
        'cip.review' => [],
        'cip.compliance' => [],
        'cip.assign' => [],
        'cip.decide' => [],
        // The provider registry, officer grants, document requirement and
        // decision templates — the module's configuration surface.
        'cip.configure' => [],
        'cip.report' => [],

        /* ── People and users ────────────────────────────────────────── */
        // The Users page — the account-management table. It lists every
        // account with its status, sign-in history and the approve / suspend /
        // reset / delete controls, so it is administration, not a directory.
        // This used to be granted to Employee and to gate the People section
        // as well, which is why it could not be closed without taking the
        // staff address book away too. Those are `directory.view` now.
        'users.view' => [],
        // Create, approve, suspend, delete and re-type accounts.
        'users.manage' => [],
        // The People section: browse colleagues, the shared and personal
        // address books. Split out of `users.view` so the Users page could be
        // closed without taking the directory with it, then closed too — an
        // employee has no need to enumerate the firm.
        'directory.view' => [],
        // See colleagues' online/away presence and their work plans.
        'presence.view' => [],

        /* ── Communication ───────────────────────────────────────────── */
        // Use the portal mailbox (Gmail/Graph). Clients talk via Messages.
        'mail.use' => [self::EMPLOYEE],
        // The internal social feed. Reaching it at all; what a person may do
        // *inside* a channel is decided by their membership row — see
        // App\Support\Feed\FeedAccess.
        'feed.view' => [self::EMPLOYEE],
        // Create a new channel. Employees may; whether a client channel is
        // allowed is a separate decision made per channel type.
        'feed.createChannel' => [self::EMPLOYEE],
        // Moderate any channel, including ones you were never added to —
        // delete posts, lock comments, archive. Administrators only, so
        // moderation still works on a private channel nobody invited them to.
        'feed.moderate' => [],
        // Read Feed analytics across every channel rather than only the ones
        // you administer.
        'feed.analytics' => [],
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
        // The Workflows section: requests waiting on you or sent by you, and
        // the comment threads you are part of, across every file.
        'workflows.view' => [self::EMPLOYEE],
        // The Client Call Recordings area. Employees hold it but see only the
        // calls they recorded — the wider view is the administrator's
        // (§ CallRecordingController::index). Clients never hold it: their
        // calls are recorded FOR the firm, not shared back as media.
        'callRecordings.view' => [self::EMPLOYEE],
        // The Overview page. Staff-wide: what it opens with — the metrics,
        // the week planner, recent files, the firm's sign-ins — was built for
        // employees too (see SignInActivityController). The administration it
        // also carries (the Users tab, the Recycle Bin, the presence board)
        // stays closed through its own capabilities, mirrored in overview.js.
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
        // The Admin Overview panel on the settings rail — the plan, the trial,
        // the account limits. Split from `overview.view` when the Overview
        // *page* opened to employees, so the page could travel without the
        // firm's account summary going with it.
        // The firm-wide recycle bin.
        'recyclebin.admin' => [],
        // Password, session and two-factor policy for the whole portal.
        'settings.security' => [],
        // The queue of long-running jobs for the whole firm.
        'settings.operations' => [],
        // Usage reports and the firm-wide notification history.
        'settings.reporting' => [],
        // The company name, logo and colours every account sees.
        'settings.branding' => [],
        // Who may reach the client hub, the service teams, the custom fields
        // every client record inherits. Employees *use* the hub; deciding how
        // it is shaped is a different thing.
        'settings.clientHub' => [],
        // Firm-wide storage usage against the licence.
        'settings.storage' => [],
        // Advanced Preferences — the firm-wide sharing and visibility defaults
        // every account inherits.
        'settings.advanced' => [],
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
        'call-recordings' => 'callRecordings.view',
        'cbi' => 'cbi.view',
        'clients' => 'clients.view',
        'email' => 'mail.use',
        'email/templates' => 'mail.use',
        // The File Library. Only the two organization-wide views are gated —
        // a client's own folders, what was shared with them, their favourites,
        // recent and recycle bin are theirs. Mirrors portal-access.js, which
        // hides exactly these two rows.
        'folders/all' => 'files.viewOrg',
        'folders/shared' => 'files.viewOrg',
        'overview' => 'overview.view',
        // The People section, screen by screen. These mirror portal-access.js
        // exactly: the sidebar hides what the server would refuse. A screen
        // may list several capabilities, and then *all* of them are required —
        // reaching People at all is `directory.view`, and the client screens
        // additionally need the capability that governs client data, so
        // reopening one does not silently reopen the other.
        'people' => 'directory.view',
        'people/employees' => 'directory.view',
        'people/clients' => ['directory.view', 'clients.view'],
        'people/prospects' => ['directory.view', 'clients.view'],
        'people/shared-address-book' => 'directory.view',
        'people/personal-address-book' => 'directory.view',
        'people/distribution-groups' => ['directory.view', 'groups.view'],
        'people/resend-welcome-emails' => 'users.manage',
        'social/feed' => 'feed.view',
        'templates' => 'templates.view',
        'users' => 'users.view',
        'users/new' => 'users.manage',
        'workflows' => 'workflows.view',
        'workflows/feedback' => 'workflows.view',
    ];

    /**
     * Account settings rail section => the capability needed to open it.
     *
     * /account-settings is the one settings home, so every account may load
     * it — their profile, theme, notifications, password and two-factor all
     * live there. The rail it renders, however, also carried the firm's
     * administration: security policy, connectors, branding, billing, storage
     * and the Advanced Preferences. Those were offered to employees and
     * clients alike, because the rail is one static list in portal-admin.js
     * and nothing pruned it. Sections absent from this map are personal.
     *
     * The browser mirror lives in portal-access.js and is held to this map by
     * PortalAccessTest, so the two cannot drift apart unnoticed.
     */
    private const SETTINGS_PAGE_CAPABILITIES = [
        'background-ops' => 'settings.operations',
        'reporting' => 'settings.reporting',
        'notification-history' => 'settings.reporting',
        'branding' => 'settings.branding',
        'clienthub-access' => 'settings.clientHub',
        'service-teams' => 'settings.clientHub',
        'custom-fields' => 'settings.clientHub',
        // "Account security" is the reader's own password and 2FA and stays
        // open; everything else under Security is firm-wide policy.
        'security-insights' => 'settings.security',
        'signin-policy' => 'settings.security',
        'security-policy' => 'settings.security',
        'alert-settings' => 'settings.security',
        'device-security' => 'settings.security',
        // "Connectors" stays open — it is where anyone links their own
        // Microsoft account (Outlook, Calendar, OneDrive).
        'storage-usage' => 'settings.storage',
        'permissions' => 'settings.advanced',
        'default-folders' => 'files.settings',
        'folder-templates' => 'files.settings',
    ];

    /** Every capability name the portal knows about. */
    public static function capabilityNames(): array
    {
        return array_keys(self::MATRIX);
    }

    /** Settings section => capability, for the browser mirror to be held to. */
    public static function settingsPageCapabilities(): array
    {
        return self::SETTINGS_PAGE_CAPABILITIES;
    }

    /** May this user open the given account settings section? */
    public static function canViewSettingsPage(?User $user, string $page): bool
    {
        $capability = self::SETTINGS_PAGE_CAPABILITIES[$page] ?? null;

        return $capability === null || self::can($user, $capability);
    }

    /**
     * The capabilities a portal page needs — all of them — or an empty list
     * when it is open to every approved account.
     *
     * @return list<string>
     */
    public static function pageCapabilities(string $page): array
    {
        return (array) (self::PAGE_CAPABILITIES[$page] ?? []);
    }

    /** May this user load the given portal page? */
    public static function canViewPage(?User $user, string $page): bool
    {
        foreach (self::pageCapabilities($page) as $capability) {
            if (! self::can($user, $capability)) {
                return false;
            }
        }

        return true;
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

        /*
         * CBI ships behind FEATURE_CBI. While the flag is off the module
         * does not exist for anyone — administrators included — so this
         * check sits BEFORE the admin short-circuit. One line here keeps
         * the page gate, the sidebar row and the capability list in
         * agreement across every environment.
         */
        if ($capability === 'cbi.view' && ! config('services.smartsheet.cbi_enabled')) {
            return false;
        }

        // Same contract for the native CIP module: while FEATURE_CIP is off,
        // every cip.* capability is denied for everyone, admins included.
        if (str_starts_with($capability, 'cip.') && ! config('services.cip.enabled')) {
            return false;
        }

        if (self::isAdmin($user)) {
            return true;
        }

        if (! array_key_exists($capability, self::MATRIX)) {
            return false;
        }

        return in_array(self::of($user), self::holders($capability), true);
    }

    /**
     * The non-administrator roles holding a capability right now.
     *
     * The matrix is the baseline for everything. Two blocks of it may be
     * re-shaped by a firm from the settings rail — the client-hub
     * capabilities, and the People directory under Advanced Preferences >
     * Permissions — so those resolve against their stored grants instead.
     * Only Employee is in play in either: a client never holds a client-hub
     * capability or the staff directory, whatever is saved.
     */
    private static function holders(string $capability): array
    {
        if (in_array($capability, ClientHubSettings::MANAGED, true)) {
            return ClientHubSettings::employeeHolds($capability) ? [self::EMPLOYEE] : [];
        }

        if (in_array($capability, PortalPermissions::MANAGED, true)) {
            return PortalPermissions::employeeHolds($capability) ? [self::EMPLOYEE] : [];
        }

        return self::MATRIX[$capability];
    }

    /**
     * Whether employees hold each client-hub capability out of the box — the
     * defaults the Client hub access screen starts from, read from the matrix
     * so the two cannot drift.
     *
     * @return array<string,bool>
     */
    public static function baselineEmployeeGrants(): array
    {
        return self::baselineGrantsFor(ClientHubSettings::MANAGED);
    }

    /**
     * Whether employees hold each of these capabilities in the matrix — the
     * defaults an overlay screen starts from. Read from the matrix so a
     * stored grant and the baseline it overlays cannot drift apart.
     *
     * @param  list<string>  $capabilities
     * @return array<string,bool>
     */
    public static function baselineGrantsFor(array $capabilities): array
    {
        $grants = [];

        foreach ($capabilities as $capability) {
            $grants[$capability] = in_array(self::EMPLOYEE, self::MATRIX[$capability] ?? [], true);
        }

        return $grants;
    }

    /** Every capability this user holds — the list handed to the browser. */
    public static function capabilities(?User $user): array
    {
        if ($user === null) {
            return [];
        }

        // Both branches route through can(), so per-capability conditions
        // (the FEATURE_CBI gate) hold for administrators too.
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
