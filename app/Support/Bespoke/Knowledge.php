<?php

namespace App\Support\Bespoke;

use App\Models\User;

/**
 * User-guide facts Bespoke may state. Grounded in docs/user-guide/guide_body.py
 * and the live nav in dashboard.html. Do not invent screens here.
 */
final class Knowledge
{
    /**
     * @param  array{accountType: string, isAdmin: bool, isStaff: bool, isClient: bool, isProviderContact: bool, cipEnabled: bool, cipReach: bool, capabilities: list<string>}  $identity
     * @return list<array<string, mixed>>
     */
    public static function visibleFaqs(User $user, array $identity): array
    {
        $out = [];
        foreach (self::catalogue() as $faq) {
            if (! self::allowedFor($user, $identity, $faq)) {
                continue;
            }
            $out[] = $faq;
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $identity
     * @param  array<string, mixed>  $faq
     */
    public static function allowedFor(User $user, array $identity, array $faq): bool
    {
        if (! empty($faq['cipOnly']) && ! $identity['cipEnabled']) {
            return false;
        }
        if (! empty($faq['staffOnly']) && ! $identity['isStaff'] && ! $identity['isProviderContact']) {
            return false;
        }
        if (! empty($faq['adminOnly']) && ! $identity['isAdmin']) {
            return false;
        }
        if (! empty($faq['needs']) && ! Bespoke::can($user, (string) $faq['needs'])) {
            return false;
        }
        if (! empty($faq['clientHide']) && $identity['isClient'] && ! $identity['isProviderContact'] && ! $identity['isStaff']) {
            return false;
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $identity
     * @param  array{path: string, view: string, title: string, kind: string}  $page
     * @param  list<array{label: string, empty: bool}>  $fieldHints
     */
    public static function match(User $user, array $identity, array $page, string $query, array $fieldHints = []): ?array
    {
        $q = self::fold($query);
        if ($q === '') {
            return null;
        }

        if (str_contains($q, 'summarize this page') || str_contains($q, 'what is on this') || str_contains($q, 'whats on this') || str_contains($q, "what's on this")) {
            return [
                'id' => 'page-summary',
                'answer' => self::pageSummary($identity, $page),
            ];
        }

        if ($identity['cipEnabled'] && (str_contains($q, 'status mean') || str_contains($q, 'what does this status') || preg_match('/what does (.+) mean/', $q))) {
            $status = self::statusFromQuery($q);
            if ($status !== null) {
                return [
                    'id' => 'cip-status',
                    'answer' => $status,
                ];
            }
        }

        if ($page['kind'] === 'cip-intake' && (str_contains($q, 'missing') || str_contains($q, 'required to file') || str_contains($q, 'whats required') || str_contains($q, "what's required"))) {
            return [
                'id' => 'intake-missing',
                'answer' => self::intakeChecklist($fieldHints),
            ];
        }

        $best = null;
        $bestScore = 0;
        foreach (self::visibleFaqs($user, $identity) as $faq) {
            $score = self::score($q, $faq);
            if ($score > $bestScore) {
                $bestScore = $score;
                $best = $faq;
            }
        }

        if ($best === null || $bestScore < 4) {
            return null;
        }

        return $best;
    }

    /**
     * @param  array<string, mixed>  $identity
     * @param  array{path: string, view: string, title: string, kind: string}  $page
     */
    public static function pageSummary(array $identity, array $page): string
    {
        $kind = $page['kind'];
        $title = $page['title'];
        $cip = $identity['cipEnabled'];

        $lines = ["This screen is **{$title}** (`{$page['path']}`)."];

        $copy = match ($kind) {
            'dashboard' => $identity['isStaff']
                ? 'Home: greeting, optional KPI cards, tiles you can hide from Edit Dashboard, Recent Files, and Default Folders (staff). Use the date range in the header for the cards.'
                : ($identity['isProviderContact']
                    ? 'Home for a service-provider contact: CIP counts, updates required, unread messages, and comments. Open a tile to go to that work.'
                    : 'Your home page. Tiles you are allowed to see, plus recent files shared with you.'),
            'overview' => 'Staff overview: profile, desktop/mobile app downloads, and tabs such as Employees, Files, Notifications, Activity, and Recycle. Administrator tabs stay hidden if you cannot open them.',
            'cip-list' => $cip
                ? 'CIP Applications. Open a number to work the file. Staff: Create New Application offers Pre-Approval, Post-Approval, New service provider, and Import. Provider contacts file pre-approval only.'
                : 'This area is not available in this environment.',
            'cip-intake' => $cip
                ? self::intakeChecklist([]).' Autosave runs about 1.2 seconds after you stop typing on Draft and new filings. Toast: Draft saved.'
                : 'CIP intake is not available in this environment.',
            'cip-file' => $cip
                ? 'A CIP file. Work Documents, comments, and status from here. Assign an officer is administrators only. Message the provider when the applicant is linked to a firm.'
                : 'CIP files are not available in this environment.',
            'files' => 'File Library. Views: All Files, Personal Folders, Shared Folders, Shared With Me, Favorites, Recent, File Box, Recycle Bin. Pin a folder with Add to Folder Shortcuts. File Box is temporary storage (default 180 days).',
            'email' => 'Connected mailbox. Clients do not have Email — they use Messages. Connect a mailbox from this page or Settings → Connectors.',
            'messages' => 'Portal chat. New message starts a thread. Voice call, video call, and Share your screen live on a conversation. Clients message the staff assigned to them.',
            'feed' => 'Internal posts and channels. Staff with feed access.',
            'calendar' => 'Your calendars. Staff also see shared calendars. Clients keep their own calendar and meetings they are invited to.',
            'signatures' => 'Signature Requests. Send a request, or sign one addressed to you.',
            'settings' => 'Account settings. Theme (Light/Dark, sidebar hover vs click), Time and Language, Account Security (two-factor), Connectors. Administrator groups appear only with the matching permission.',
            'users' => 'Account table for administrators. Approve, suspend, reset, delete, and assign CRO / Reviewing officer or Administrator. Client accounts arrive by invitation, not from this page.',
            'reporting' => 'Firm reports. Administrators.',
            'templates' => 'System Emails, Email Templates, Granted And Denied Letters, Document Requirements.',
            'workflows' => 'Requests, Feedback And Comments, Updates Required.',
            'people' => 'Directories, address books, distribution groups. Administrators.',
            'calls' => 'Recorded client calls. Staff; employees see their own recordings.',
            default => 'Use the sidebar to move. If a row is missing, your account does not have that area.',
        };

        $lines[] = $copy;

        return implode("\n\n", $lines);
    }

    /**
     * @param  list<array{label: string, empty: bool}>  $fieldHints
     */
    public static function intakeChecklist(array $fieldHints): string
    {
        $required = [
            'Service provider',
            'Investment type (if other, specify it)',
            'Sponsored (Yes or No; if Yes, complete sponsor fields)',
            'Passport photo — square, 2×2 inches, 600×600 pixels or larger',
            'First name and last name',
            'Gender and date of birth',
            'Country of birth and country of residence',
            'Occupation',
            'Passport number',
            'Passport bio page, birth certificate, and every other document Document Requirements marks required for the people on this form',
        ];

        $empty = [];
        foreach ($fieldHints as $hint) {
            if ($hint['empty']) {
                $empty[] = $hint['label'];
            }
        }

        $text = "Pre-approval intake needs:\n";
        foreach ($required as $item) {
            $text .= '- '.$item."\n";
        }
        $text .= "\nDependents: first name, last name, date of birth, relationship (Spouse or Qualified dependent).\n";
        $text .= 'Post-approval also needs the CIP application number from the decision letter.';
        $text .= "\n\n**Save as draft** (and autosave) keep the file in Draft. **Add** files it into New Applications when required fields and files are complete. Filing follows Document Requirements: every required upload for the applicant, a sponsor if Sponsored is Yes, and each dependent on the form. **Save** on an application already on file does not re-demand outstanding pack documents; those stay on the checklist.";

        if ($empty !== []) {
            $text .= "\n\nOn this form, these labels look empty: **".implode('**, **', $empty).'**. Required fields also show a red asterisk.';
        } else {
            $text .= "\n\nI cannot read the live form values. Check each red asterisk before you click Add.";
        }

        return $text;
    }

    /**
     * @param  array<string, mixed>  $identity
     */
    public static function pageGuide(array $identity, array $page): string
    {
        $chunks = [self::pageSummary($identity, $page)];

        if ($identity['cipEnabled'] && str_starts_with($page['kind'], 'cip')) {
            $chunks[] = self::intakeFacts();
            $chunks[] = self::statusFacts();
        }

        if ($page['kind'] === 'files') {
            $chunks[] = 'Folder Shortcuts is the Folders tab in the sidebar, not the full library. Right-click a folder → Add to Folder Shortcuts. File Box: temporary files when sending or requesting; default expiry 180 days; move into a permanent folder to keep them.';
        }

        if ($page['kind'] === 'settings') {
            $chunks[] = 'Two-factor: Settings → Account Security → Two-factor authentication → Authenticator app → Scan QR code. Sidebar style: Settings → Theme. You cannot turn 2FA off if firm policy requires it.';
        }

        return implode("\n\n", $chunks);
    }

    public static function intakeFacts(): string
    {
        return 'Create New Application: staff see Pre-Approval, Post-Approval, New service provider, and Import. Provider contacts: Pre-Approval only. Service provider is chosen on create and prefixes the number (for example GAL26-00001). It is not reassigned later. Officers are assigned by administrators — that is not picking a provider. Autosave ~1.2s after idle on Draft / new filings. Toast: Draft saved.';
    }

    public static function statusFacts(): string
    {
        $rows = [];
        foreach (self::statuses() as $name => $meaning) {
            $rows[] = '- **'.$name.'** — '.$meaning;
        }

        return "CIP statuses (pre-approval order unless an administrator overrides):\n".implode("\n", $rows);
    }

    /** @return array<string, string> */
    public static function statuses(): array
    {
        return [
            'Draft' => 'Intake still being typed. Autosave. Not in status pickers. File it with Add.',
            'New Applications' => 'Just filed. An administrator assigns a reviewing officer.',
            'Review Applications' => 'The officer reviews the file and documents. Next: Assessment Feedback.',
            'Assessment Feedback' => 'Feedback is recorded. Next: Updates Required or Ready to Submit.',
            'Updates Required' => 'The provider side has work to do. Also used in post-approval when more paper is needed.',
            'Ready to Submit' => 'Ready to go forward. Next: Pending Review, or back to Updates Required.',
            'Pending Review' => 'Waiting on review / compliance. Next: Non-compliant or Background Check.',
            'Non-compliant' => 'Did not meet a requirement. Can return to Pending Review or move to Background Check.',
            'Background Check' => 'Checks in progress. From here: Non-compliant, Delayed, Approved, or Denied.',
            'Delayed' => 'Held up. From here: Non-compliant, Approved, or Denied.',
            'Approved' => 'Pre-approval grant. Record decision uses Granted letter templates. Next: Post-Approval, or New Appeal.',
            'Denied' => 'Refused. Record decision uses Denied letter templates. Next: New Appeal if someone lodges an appeal.',
            'Post-Approval' => 'Work after a grant. Later stages such as Pending COR use Record … buttons so the date travels with the status.',
            'New Appeal' => 'The one status an external account may drive on a decided file that is theirs. Appeal Ready and Appeal Submitted are the firm’s.',
        ];
    }

    /**
     * Paths this account may be sent to. Staff-only destinations are omitted
     * for Client accounts.
     *
     * @param  array<string, mixed>  $identity
     * @return list<string>
     */
    public static function allowedPaths(User $user, array $identity): array
    {
        $paths = [
            '/',
            '/calendar',
            '/signatures',
            '/social/messages',
            '/folders/recent',
            '/folders/favorites',
            '/folders/shared-with-me',
            '/account-settings',
            '/settings',
            '/bespoke-ai',
        ];

        if (Bespoke::can($user, 'overview.view')) {
            $paths[] = '/overview';
        }
        if ($identity['cipReach'] || Bespoke::can($user, 'clients.view')) {
            $paths[] = '/citizenship-applications';
        }
        if (Bespoke::can($user, 'mail.use')) {
            $paths[] = '/email';
        }
        if (Bespoke::can($user, 'feed.view')) {
            $paths[] = '/social/feed';
        }
        if (Bespoke::can($user, 'files.viewOrg') || $identity['cipReach']) {
            $paths[] = '/folders/all';
        }
        if (! $identity['isProviderContact']) {
            $paths[] = '/folders/personal';
            $paths[] = '/folders/filebox';
        }
        if (Bespoke::can($user, 'files.viewOrg')) {
            $paths[] = '/folders/shared';
        }
        $paths[] = '/folders/recycle';
        if (Bespoke::can($user, 'users.view')) {
            $paths[] = '/users';
        }
        if (Bespoke::can($user, 'settings.reporting')) {
            $paths[] = '/reporting';
        }
        if (Bespoke::can($user, 'templates.view')) {
            $paths[] = '/templates';
        }
        if (Bespoke::can($user, 'workflows.view')) {
            $paths[] = '/workflows';
        }
        if (Bespoke::can($user, 'directory.view')) {
            $paths[] = '/people';
        }
        if (Bespoke::can($user, 'callRecordings.view')) {
            $paths[] = '/call-recordings';
        }

        return array_values(array_unique($paths));
    }

    /**
     * Strip markdown links this reader must not see. Leaves the label.
     *
     * @param  list<string>  $allowed
     */
    public static function sanitizeAnswer(string $text, array $allowed): string
    {
        return (string) preg_replace_callback(
            '/\[([^\]]+)\]\(([^)]+)\)/',
            function (array $m) use ($allowed) {
                $href = trim($m[2]);
                if (self::hrefAllowed($href, $allowed)) {
                    return $m[0];
                }

                return $m[1];
            },
            $text,
        );
    }

    /**
     * @param  list<string>  $allowed
     */
    public static function hrefAllowed(string $href, array $allowed): bool
    {
        $path = Page::normalise($href);
        foreach ($allowed as $ok) {
            if ($path === $ok || str_starts_with($path, $ok.'/')) {
                return true;
            }
        }

        return false;
    }

    /** Compact FAQ map for the JS local path (id, q, keywords, answer). */
    public static function clientFaqPayload(User $user, array $identity): array
    {
        $out = [];
        foreach (self::visibleFaqs($user, $identity) as $faq) {
            $out[] = [
                'id' => $faq['id'],
                'q' => $faq['q'],
                'keywords' => $faq['keywords'],
                'answer' => $faq['answer'],
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function catalogue(): array
    {
        return [
            [
                'id' => 'dashboard',
                'q' => 'What’s on this dashboard?',
                'keywords' => ['dashboard', 'home', 'tiles', 'kpi', 'greeting', 'edit dashboard'],
                'answer' => "The Dashboard is home after you sign in. Staff see a greeting, optional KPI cards, tiles (Recent Files, Email, Messages, Shortcuts, Employees, Favorites, Upcoming Events, CIP Applications, Requests, Comments), then Recent Files and Default Folders.\n\nClick **Edit Dashboard** (grid icon) to hide tiles. A tile that needs a permission you do not hold is not offered.\n\nOpen it: [/](/)",
            ],
            [
                'id' => 'start-cip',
                'q' => 'How do I start a CIP application?',
                'keywords' => ['start', 'create', 'new application', 'cip', 'pre-approval', 'file an application'],
                'cipOnly' => true,
                'answer' => "Open [CIP Applications](/citizenship-applications) → **Create New Application**.\n\nStaff: Pre-Approval, Post-Approval, New service provider, Import.\nProvider contacts: Pre-Approval only.\n\nPick the **service provider on create**. It prefixes the number (for example GAL26-00001) and is not reassigned later. Assigning an officer is a different, administrator-only action.",
            ],
            [
                'id' => 'file-library',
                'q' => 'Where is File Library?',
                'keywords' => ['file library', 'files', 'folders', 'documents', 'all files'],
                'answer' => "File Library is in the sidebar. Expand it for All Files, Personal Folders, Shared Folders, Shared With Me, Favorites, Recent, File Box, and Recycle Bin.\n\nThe **Folders** tab at the top of the sidebar is Folder Shortcuts (pins), not the full library.\n\nOpen [All Files](/folders/all) or [Recent](/folders/recent).",
            ],
            [
                'id' => 'autosave',
                'q' => 'How does draft autosave work?',
                'keywords' => ['autosave', 'auto-save', 'draft saved', '1.2'],
                'cipOnly' => true,
                'answer' => "On a new CIP filing or a file still in **Draft**, the form saves about **1.2 seconds** after you stop typing. You will see “Draft saved a moment ago” and a toast **Draft saved**.\n\n**Save as draft** saves immediately and keeps Draft. Autosave does not silently overwrite a filed application. If you return and a draft is waiting, choose Keep it or Start over.",
            ],
            [
                'id' => 'draft-vs-add',
                'q' => 'What’s the difference between Save as draft and Add?',
                'keywords' => ['save as draft', 'add', 'file the application', 'new applications', 'difference'],
                'cipOnly' => true,
                'answer' => "**Save as draft** (and autosave) keep a CIP intake in Draft. Drafts appear in the table with a number. Draft is not a queue in the status list.\n\n**Add** files the application into **New Applications** when required fields and files are complete. Filing follows Document Requirements: every required upload for the applicant, a sponsor if Sponsored is Yes, and each dependent on the form. Required items show a red asterisk. If something required is missing, the portal will not move the file.\n\n**Save** on an application already on file keeps details even when pack documents are still outstanding. Those rows stay on the checklist.",
            ],
            [
                'id' => 'photo',
                'q' => 'What photo size is required?',
                'keywords' => ['photo', 'passport photo', '2x2', '600', 'square', 'picture'],
                'cipOnly' => true,
                'answer' => 'Passport photo on CIP intake: **square**, **2×2 inches**, **600×600 pixels or larger**. Required fields are marked with a red asterisk.',
            ],
            [
                'id' => 'sponsored',
                'q' => 'What does Sponsored mean?',
                'keywords' => ['sponsored', 'sponsor'],
                'cipOnly' => true,
                'answer' => '**Sponsored** on CIP intake is Yes or No. If Yes, complete the sponsor fields the form shows. It is not the same as assigning an officer or picking a service provider.',
            ],
            [
                'id' => 'dependents',
                'q' => 'How do dependents work?',
                'keywords' => ['dependent', 'spouse', 'qualified', 'family', 'children'],
                'cipOnly' => true,
                'answer' => 'Add dependents on the intake form if needed. Each needs **first name**, **last name**, **date of birth**, and **relationship** (Spouse or Qualified dependent). Post-approval intake also asks for the CIP application number from the decision letter.',
            ],
            [
                'id' => 'queues',
                'q' => 'What are the queues?',
                'keywords' => ['queue', 'status list', 'new applications', 'review applications', 'stages'],
                'cipOnly' => true,
                'staffOnly' => true,
                'answer' => "Pre-approval runs in this order unless an administrator overrides:\n\n1. Draft (not a picker status)\n2. New Applications — administrator assigns an officer\n3. Review Applications\n4. Assessment Feedback\n5. Updates Required or Ready to Submit\n6. Pending Review → Non-compliant or Background Check\n7. Approved or Denied\n\nCRO / Reviewing officers drive mapped next steps. They cannot assign officers or pull a file backwards. Open [CIP Applications](/citizenship-applications).",
            ],
            [
                'id' => 'assign-officer',
                'q' => 'How do I assign an officer?',
                'keywords' => ['assign', 'officer', 'reviewing officer', 'assignment'],
                'cipOnly' => true,
                'adminOnly' => true,
                'answer' => "Only **administrators** assign CIP files to staff reviewers. Open the file in [CIP Applications](/citizenship-applications) → **Assign an officer**.\n\nThat is not how you attach a service provider. Pick **Service provider** on the intake form when you create the application. The firm is not reassigned later.",
            ],
            [
                'id' => 'invite-provider',
                'q' => 'How do I invite a service provider?',
                'keywords' => ['invite', 'service provider', 'provider access', 'new service provider'],
                'cipOnly' => true,
                'staffOnly' => true,
                'answer' => "Two steps. Do not add them on Users.\n\n1. Register the firm: [CIP Applications](/citizenship-applications) → Create New Application → **New service provider** → name → Create.\n2. Invite people: administrators open the provider → **Access** → email → Add (toast: Invitation sent). A CRO uses **Invite to portal** on the contact instead.\n\nThey arrive as **Client** accounts linked to that firm. They see that provider’s CIP files — not Users, not CIP Console, not other firms.",
            ],
            [
                'id' => 'provider-copies',
                'q' => 'How do I stop getting copies of the emails sent to service providers?',
                'keywords' => ['copy', 'copies', 'cc', 'service provider emails', 'cip emails', 'too many emails', 'notification emails'],
                'cipOnly' => true,
                'staffOnly' => true,
                'answer' => "[Settings → Notifications](/account-settings?settings-page=notifications) → **Copy me on service provider emails**. Off stops the email; the bell in the portal still shows every change.\n\nWhat you are copied on follows your account: administrators get every application, CROs the files they hold.",
            ],
            [
                'id' => 'pin-folder',
                'q' => 'How do I pin a folder?',
                'keywords' => ['pin', 'shortcut', 'folder shortcuts', 'star', 'favorites'],
                'answer' => "In File Library, right-click a folder (or the row menu) → **Add to Folder Shortcuts**. The toast reads Added to Folder Shortcuts. Those pins live on the **Folders** tab of the sidebar, which is not the full library.\n\n**Star** sends an item to Favorites. **Folder appearance** sets colour and icon. Open [File Library](/folders/all).",
            ],
            [
                'id' => 'filebox',
                'q' => 'What’s File Box?',
                'keywords' => ['file box', 'filebox', 'temporary', '180'],
                'answer' => "File Box is temporary storage when sending or requesting files. Loose files that are not yet in a folder land here. Default expiry is **180 days**. Move a file into a permanent folder to keep it longer.\n\nService-provider contacts do not use File Box or Personal Folders — uploads belong in the client folder.\n\nOpen [File Box](/folders/filebox).",
            ],
            [
                'id' => '2fa',
                'q' => 'How do I turn on two-factor?',
                'keywords' => ['2fa', 'two-factor', 'two factor', 'authenticator', 'qr'],
                'answer' => "Open [Settings](/account-settings) → **Account Security** → Two-factor authentication → Authenticator app → Scan QR code, then enter the six-digit code.\n\nYou can also add Phone number or Email. You cannot turn this off if firm policy requires it.",
            ],
            [
                'id' => 'sidebar-style',
                'q' => 'How do I change sidebar style?',
                'keywords' => ['sidebar', 'hover', 'overlay', 'standard sidebar', 'theme'],
                'answer' => 'Settings → **Theme** → Sidebar style. **Hover Overlay** (default): collapsed icons, hover to open labels over the page. **Standard**: stays expanded. Open [Settings](/account-settings).',
            ],
            [
                'id' => 'theme',
                'q' => 'How do I change Light or Dark?',
                'keywords' => ['dark', 'light', 'theme', 'sun', 'moon'],
                'answer' => 'The sun/moon button in the header toggles Light and Dark. Settings → Theme does the same and also sets font size. Open [Settings](/account-settings).',
            ],
            [
                'id' => 'users-missing',
                'q' => 'Why don’t I see Users, Reporting, or CIP Console?',
                'keywords' => ['users', 'reporting', 'cip console', 'missing', 'sidebar'],
                'answer' => 'Those areas are administration. Only accounts with the matching permission see them. A CRO / Reviewing officer will not see them. A missing sidebar row is expected, not a broken menu.',
            ],
            [
                'id' => 'email-missing',
                'q' => 'Why don’t I see Email?',
                'keywords' => ['email missing', 'mailbox', 'no email'],
                'answer' => 'Email is for staff with mail access. Clients use [Messages](/social/messages) instead. Staff connect a mailbox from Email or Settings → Connectors.',
            ],
            [
                'id' => 'messages',
                'q' => 'How do Messages and calls work?',
                'keywords' => ['messages', 'chat', 'video', 'voice', 'screen share', 'call'],
                'answer' => "Open [Messages](/social/messages). Search for people. **New message** starts a thread. In a conversation: Voice call, Video call, **Share your screen**.\n\nClients message the staff assigned to them. Recorded client calls appear under Call Recordings for staff.",
            ],
            [
                'id' => 'search',
                'q' => 'How do I search?',
                'keywords' => ['search', 'slash', 'find'],
                'answer' => 'Press **/** or click Search in the header. That is global search. Bespoke AI Assistant uses ⌘J / Ctrl+J and does not steal /.',
            ],
            [
                'id' => 'bespoke-page',
                'q' => 'Where are my Bespoke AI chats?',
                'keywords' => ['bespoke', 'past chats', 'assistant', 'history', 'ai chat'],
                'answer' => 'Open [Bespoke AI Assistant](/bespoke-ai) from the sidebar. Past chats are in the list on the left. The mark in the corner opens the same assistant on the page you are on. Shortcut: ⌘J / Ctrl+J.',
            ],
            [
                'id' => 'sign-out',
                'q' => 'How do I sign out?',
                'keywords' => ['sign out', 'log out', 'logout'],
                'answer' => 'Use the sign-out icon at the bottom of the sidebar, next to your name.',
            ],
            [
                'id' => 'support',
                'q' => 'Who do I contact if something is wrong?',
                'keywords' => ['support', 'help', 'contact', 'wrong'],
                'answer' => 'Email support@tmantoine.com. Privacy questions may use portal@tmantoinelaw.com. Include the page, account email, and application number if it is a CIP file. Do not send sign-in codes or authenticator codes.',
            ],
            [
                'id' => 'provider-assign',
                'q' => 'How do I assign a post-approval file to a service provider?',
                'keywords' => ['post-approval', 'assign provider', 'reassign', 'galaxy'],
                'cipOnly' => true,
                'staffOnly' => true,
                'answer' => 'You select the firm on the application. You do not assign it afterwards. New post-approval: Create New Post-Approval Application → Service provider → Add. A file already Approved in this portal keeps the provider chosen at original filing when you move it to Post-Approval. Assign an officer is only which staff member reviews the file.',
            ],
            [
                'id' => 'compose-updates',
                'q' => 'Draft a CIP updates-required message',
                'keywords' => ['draft', 'updates required', 'query', 'message to provider', 'compose'],
                'cipOnly' => true,
                'staffOnly' => true,
                'answer' => "Copy this into Messages or Email. I will not send it.\n\n**Subject:** Updates required\n\nPlease upload the outstanding documents for this file. Required items are marked on the Documents tab. Reply here when they are ready.\n\nThank you.",
            ],
        ];
    }

    /**
     * How well a raw question matches one FAQ entry (4 or more is a match).
     *
     * @param  array<string, mixed>  $faq
     */
    public static function scoreFor(string $query, array $faq): int
    {
        return self::score(self::fold($query), $faq);
    }

    /** @param  array<string, mixed>  $faq */
    private static function score(string $q, array $faq): int
    {
        $score = 0;
        $question = self::fold((string) $faq['q']);
        if ($question !== '' && (str_contains($q, $question) || str_contains($question, $q))) {
            $score += 12;
        }
        foreach ($faq['keywords'] as $word) {
            $word = self::fold((string) $word);
            if ($word !== '' && str_contains($q, $word)) {
                $score += strlen($word) > 4 ? 4 : 2;
            }
        }

        return $score;
    }

    private static function statusFromQuery(string $q): ?string
    {
        foreach (self::statuses() as $name => $meaning) {
            $needle = self::fold($name);
            if ($needle !== '' && str_contains($q, $needle)) {
                return '**'.$name.'** — '.$meaning;
            }
        }

        return null;
    }

    private static function fold(string $text): string
    {
        $text = mb_strtolower($text);
        $text = strtr($text, ['’' => "'", '‘' => "'", '“' => '"', '”' => '"']);
        $text = preg_replace("/[^\p{L}\p{N}\s\/'-]+/u", ' ', $text) ?? $text;

        return trim(preg_replace('/\s+/', ' ', $text) ?? $text);
    }
}
