# Browser tests

The signature editor, the signing page and the sidebar are the parts of the
portal PHPUnit can't reach: pdf.js rendering, canvas painting, pointer-driven
field placement and drawing, and computed CSS only exist in a browser.

- **`signature-editor.mjs`** — log in, pick a library file, add recipients,
  place fields on the rendered PDF, drag one, confirm the coordinates persist
  as page-relative fractions.
- **`signing-flow.mjs`** — the whole round trip: the owner sends, a recipient
  opens the link in a *separate browser context* (no portal session), draws a
  signature, finishes; then the used link must be dead and the portal
  unreachable from that session.
- **`stamped-output.mjs`** — the end product. After a real signing it renders
  the *stored signed PDF* and counts ink per horizontal band, so a signature
  placed at `y=0.78` on page 2 has to actually appear in the bottom of page 2 —
  and the original must still have none.
- **`folder-shortcuts.mjs`** — the sidebar's two tabs and the Folder Shortcuts
  list: pin a folder from the File Library, no duplicates, nested and shared
  folders, open, drag to reorder, remove, and a deleted folder dropping itself.
  It also measures the Dashboard nav icon's *computed* colour and box, which is
  the only way to catch a tinted icon that silently changes size or disappears
  in the collapsed rail.
- **`clients.mjs`** — the Client hub is server-backed, not the old in-memory
  mock: create a client through the form, confirm it survives a reload, then
  bulk-delete it. Reads the directory back through the API so the check doesn't
  depend on how the list renders. Needs a staff account.
- **`client-referrals.mjs`** — client type and Referred by. `ClientReferralTest`
  covers the API; what only a browser can check is the reading, because the
  three referral answers differ only in what the table prints — a company's
  name, "Private", and an em dash for one nobody has recorded. It creates the
  four cases from the spec, then drives the filter popover: any company, one
  named company, Private, No referral, and client type, plus the chip and the
  Reset. A company that has referred nobody must not be offered as a filter.

  Two things it was written around. The clients table is scoped in every
  selector: all the portal's pages live in one SPA shell, so a bare
  `.tma-dash__ctr--body` also collects hidden views' rows. And it parks the
  pointer on the right of the page before touching the toolbar — the desktop
  sidebar can be set to Hover Overlay, and it expands over exactly the strip
  where the Filter button sits.

  Setup is the standard throwaway server plus three companies, one of which
  deliberately refers nobody:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
    \$u = App\Models\User::where('email', 'e2e@example.com')->first();
    foreach (['Galaxy', 'Blue Media', 'Nobody Ltd'] as \$n) {
      App\Models\Company::create(['uid' => Str::slug(\$n), 'name' => \$n, 'created_by' => \$u->id]);
    }
  "
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/client-referrals.mjs
  ```
- **`clients-table.mjs`** — the directory table at scale. Written against ~11k
  rows because every one of these behaved perfectly with five clients and fell
  over with eleven thousand: the total stated above the table, a default page
  size of 100, pagination that says "page 4 of 111" and can actually reach 111,
  the table scrolling sideways in its own container rather than dragging the
  shell, row checkboxes, select-all, the Type facet counts agreeing with what
  filtering returns, and filter popovers that neither clip a long company name
  nor run off-screen.

  The bug it was written to catch: select-all captured its checkboxes when it
  was wired, and being a node that survives morphing it kept the first render's
  elements for ever — after a page turn it ticked boxes that had left the
  document and nothing happened. Anything that reads a node list at wire time
  in this page is suspect for the same reason.

  Same two harness rules as `client-referrals.mjs` (scope selectors to the
  clients table; park the pointer away from the hover-overlay sidebar), plus a
  third: scope pagination to `[data-clients-pagination]`, or a hidden view's
  pager in the shared shell matches too.

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/clients-table.mjs
  ```
- **`clients-loading.mjs`** — what the hub does while it loads, when it has
  nothing to show, and when the request fails. These were one state before, and
  that is the bug it was written for: the directory shipped every client's full
  contact profile on every page load (9.6 MB of JSON and a 127 MB PHP memory
  peak at eleven thousand clients, which was exhausting the container), and when
  that request timed out the page caught the error, hydrated an empty list from
  it, and rendered **"No clients found"** — telling staff the firm had no
  clients whenever the directory failed.

  So it asserts the listing carries no `profile` key and stays under 400 bytes a
  record; that a skeleton holds the table's layout while waiting (the header must
  not move when the data lands) and that neither the count nor the pager claims a
  total it has not been told; that a 500 renders a *failure* with a retry that
  actually recovers; that searching a nickname — held only in the blob the
  browser no longer has — still finds the client; and that "no matches", "no
  clients yet" and "couldn't load" are three different screens, only the middle
  one offering to add anything.

  It fakes its failures with `page.route`, so the three 500s in the console at
  the end are the point rather than a problem. Two things it was written around:
  click the **name cell** (`.tma-dash__cc--user`), because the Referral column is
  a link to the referring company and sits under the middle of the row; and a
  delayed route handler still sleeping when its route is lifted throws, so its
  `continue()` is guarded.

  Wants the same large directory as `clients-table.mjs`:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/clients-loading.mjs
  ```

  Note that `client-referrals.mjs` and `clients.mjs` want the *opposite* — a
  near-empty directory. Run them against a fresh database, or the clients they
  create land on page 300 of the big one and every assertion reads `undefined`.
- **`owner-column.mjs`** — the File Library's Owner column after it was given
  CBI's Assigned column's behaviour: a face per person on the row (owner first,
  then everyone it is shared with), a hover card naming their role here with
  Message/Call/Video, and a filter by owner with a count each.

  It checks **both** pages, and that is the point. The card was lifted out of
  `cbi.js` into `public/js/person-card.js` so the two draw the same component
  instead of two copies; a passing File Library beside a broken CBI is the
  failure mode, so the last step loads `/cbi` and asserts no missing-symbol
  errors. The facet is also checked for the thing facets get wrong: the owner
  list is measured *before* the filter is applied, or picking an owner leaves a
  menu offering only that owner and no way back.

  Three things it was written around. The page is at **`/folders/all`**, not
  `/files`. The owner filter deliberately does not render when one person owns
  everything in view, so the seed has to create a second owner or the check
  fails on a control that is correctly absent. And a `shares` row needs a
  `token` even for a user share, which only link shares ever read.

  ```sh
  TMA_DB="$DB" TMA_BASE_URL=http://127.0.0.1:8901 node tests/Browser/owner-column.mjs
  ```
- **`feed.mjs`** — the Feed module. PHPUnit covers the API
  (`tests/Feature/FeedTest.php`); what only a browser can check is §22 — that
  posting, commenting, reacting, voting, bookmarking and pinning all *patch*
  the page instead of reloading it. So it plants a sentinel on `window` at the
  start and asserts it is still there at the end: a single navigation anywhere
  in the run kills it.

  It also covers the parts that only exist as rendered state: the Feed's own
  sidebar and its memory (the selected channel and a collapsed group both have
  to survive a reload — they are keyed by account, and reading that key before
  `/me` answers is what broke it the first time), the rich-text composer
  (`data-morph-skip` on the editor is load-bearing; without it a re-render
  mid-sentence deletes what was typed), threaded replies, live poll tallies,
  and that author faces fall back to initials rather than a blank pixel.

  Ends with a **second browser context** on another staff account, confirming a
  private channel is absent from their sidebar while the org-wide one is there.

  Needs two staff accounts (`e2e@example.com` and `bea@example.com`). The
  empty-state check only runs on a fresh database, so it is safe to re-run:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/feed.mjs
  ```
- **`sync-toasts.mjs`** — the bottom-right sync cards, driven for the mailbox.
  The only script here that needs **no server and no login**: it loads
  `public/js/sync-toasts.js` into a blank page over a stubbed `/me/sync-status`,
  which is the only practical way to watch a queued sync change state on cue.

  It covers the mailbox case the toast used to miss entirely — a sync started
  after the first import, when `/me/sync-status` answered `done` because the
  backfill was long finished. Checks the card appears the moment the page calls
  `TMASyncToasts.watch('email')`, survives the queue grace (the job is queued,
  not running, so the honest server answer is still `done`), follows the real
  run, retires itself, and stands down while the mail page's own import panel
  (`.tma-mail-sync`) is on screen.

  ```sh
  node tests/Browser/sync-toasts.mjs
  ```

- **`email-sidebar.mjs`** — the mailbox sidebar after it was restyled to match
  the Feed's: a card at 232px with collapsible Mailboxes and Labels groups,
  rather than the bare 72px icon rail that sat flush against the main menu.

  It asserts **computed** style, not markup, because every bug in this area has
  been a specificity bug that is invisible from the rule that looks like it
  should win — a blanket `152px` in `dashboard-tma-overrides.css` (which loads
  last) and a hardcoded `168px` inside a `min-width: 861px` media query each
  silently beat the sidebar's own width. It also checks the unread pill and a
  plain total are styled differently (a total drawn as the filled pill made "27
  templates" read as 27 unread), that the collapsed rail still collapses, that a
  closed group survives a reload, that dark mode does not leave the card white,
  and that mobile is untouched.

  One harness note: park the mouse away from the main rail before clicking in
  the sidebar. Left hovering there, the hover-overlay sidebar expands across the
  email card and swallows the click — that is the rail behaving normally.

  Needs a staff account with a connected mailbox:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/email-sidebar.mjs
  ```
- **`people.mjs`** — the whole People section, which used to render from a
  localStorage store that was always empty. Checks each of the eight URLs is
  *served* on a cold load (they 404'd before, so a hard refresh dropped you on
  the dashboard) and that each screen paints a real table: staff on Browse
  employees with their activation state and a working Showing filter, client
  accounts on Browse client contacts, both prospect sources merged, a contact
  added to the personal book surviving a reload while staying out of the shared
  one, a real group created through the builder, and the resend screen listing
  who is actually still waiting. Ends by confirming a Client gets a 404 rather
  than a page that fills with permission errors.

  Step 2 also measures the home cards' **icons**, which are masked spans rather
  than `<img>` (the phosphor art is `fill="currentColor"`, so through an `<img>`
  it renders flat black and CSS cannot recolour it). It asserts the computed
  44px tile, the 20px icon, a non-black tint, seven distinct masks, and that
  each mask URL actually loads — a 404 mask still leaves a correctly sized,
  correctly coloured box, so the art has to be fetched to catch it. It also
  pins that the masks resolve against the *stylesheet* (`/images/…`): named
  inline instead, a relative `url()` would resolve to `/people/images/…` and
  404 on every nested People URL. See the nav-icon notes in
  `folder-shortcuts.mjs` for the same class of bug.

  Needs the three standard accounts, one client record carrying a pending
  invitation, and an account that has never signed in:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute='
    App\Models\AuthEvent::create(["user_id" => 1, "event" => "login",
      "ip" => "127.0.0.1", "user_agent" => "seed", "created_at" => now()->subDay()]);
    App\Models\User::where("email", "emp@example.com")->update(["password_auto" => true]);
    $c = App\Models\Client::create(["uid" => "selina-kyle", "name" => "Selina Kyle",
      "company" => "Kyle Ltd", "email" => "selina@example.com", "data" => []]);
    App\Models\ClientInvite::create(["client_id" => $c->id, "email" => "selina@example.com",
      "token" => App\Models\ClientInvite::freshToken(), "expires_at" => now()->addDays(14),
      "last_sent_at" => now()]);'

  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/people.mjs
  ```

- **`cbi.mjs`** — the CBI development preview at `/dev/cbi`. The module is
  deliberately dark (no sidebar entry, no SPA page, gated on `FEATURE_CBI` +
  admin), so what only a browser can check is that the standalone shell
  actually paints against real synced data: the stage tabs filter, search
  narrows the table, an application opens into its workspace with the
  Applicant/Case/Comments/Activity panels, a portal comment posts and
  survives a reload, and — the part that matters most while it's hidden — an
  employee gets a **404**, not a page, from both the URL and the JSON API.

  Needs `FEATURE_CBI=true`, the standard `e2e@example.com` admin (plus
  `emp@example.com` for the 404 check) and `cbi_applications` rows — either
  from a real `smartsheet:sync` or copied in from another environment:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/cbi.mjs
  ```

- **`settings-access.mjs`** — who the account settings rail offers what to.
  `/account-settings` is the one settings home, so *every* account loads it —
  but the rail it draws is a single static list in `portal-admin.js` and
  nothing pruned it, so employees and clients were offered Admin Overview, the
  security and sign-in policies, company branding, storage and the whole
  Advanced Preferences group beside their own profile.

  `PortalAccessTest` can check the matrix; only a browser can check what the
  rail *paints*. It reads every section each account type is offered (expanding
  the collapsed groups first — their children aren't in the DOM otherwise),
  then checks the three ways in that don't go through the rail: a deep link
  (`?settings-page=security-policy` must fall back to the reader's profile,
  not render the panel), global search, and the "Manage client hub" dropdown
  on the Clients page.

  Two timing traps it exists to catch, both of which show up as an
  *administrator* losing access rather than an employee gaining it:

  - The rail paints before `/me` answers, so nobody holds a capability yet.
    Both the rail and the Clients dropdown have to repaint once the answer
    lands. Wait on `document.documentElement[data-tma-access="ready"]` rather
    than a fixed beat.
  - The search index is built at boot for the same reason, so the allowed
    sections are pushed into it afterwards — and the palette used to snapshot
    the array with `.concat`, which quietly threw those away. Step 6 is that
    check; it failed on the first run of this script.

  Needs the three standard accounts:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/settings-access.mjs
  ```

- **`sidebar-first-paint.mjs`** — the sidebar *before* `/me` answers. The
  role-gated rows (Overview, Client hub, Email, Feed, Users, Templates) live in
  one static list shared by every account, so portal-access.js held them with
  `visibility:hidden` until the capabilities landed. That reserves their space:
  the menu painted with six full-height blank gaps for the length of a round
  trip, which reads as icons failing to load rather than as a permissions
  wait. `App\Support\PortalShell` now bakes the reader's capabilities into the
  shell, so the nav is settled before the sidebar parses.

  The state only exists for a few hundred milliseconds on a local server, so
  the script **stalls `/me` for four seconds** through `page.route` and
  measures inside that window. It asserts no row reserves space while drawing
  nothing, the menu isn't empty, every drawn row's icon mask is a `data:` URI
  rather than a fetch, and — the check that catches a shell disagreeing with
  `/me` — that the menu is *identical* once the answer lands. Runs for all
  three account types and writes a rail screenshot per account.

  Reverting only `public/js/portal-access.js` reproduces the original failure
  exactly, naming all six blank rows, which is worth knowing if this ever
  regresses. Needs the three standard accounts:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/sidebar-first-paint.mjs
  ```

- **`boot-skeleton.mjs`** — the main area's first paint, the companion to the
  sidebar check above. The shell used to serve an empty Dashboard mount, so
  until the bundle executed the page was a white void with a lone placeholder
  row in each right-rail section. The shell now carries a boot skeleton inside
  the mount, and this asserts all of it: "/" paints the dashboard-shaped
  variant (hero, KPI cards, panel tiles), any other entry path switches to the
  view-agnostic rows via the inline path check, a client never sees the
  staff-only KPI placeholder row (portal-access.js prunes `[data-boot-needs]`
  from its boot capabilities), the right rail carries three rows per section,
  and — on a normal un-stalled load — portal-home replaces the skeleton with
  the real board.

  The window under test closes when the deferred bundle runs, so the script
  stalls every script except portal-access.js and samples after `commit` —
  waiting for DOMContentLoaded would wait for the very scripts being held.
  Needs the administrator and client accounts:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/boot-skeleton.mjs
  ```

- **`account-reporting.mjs`** — Account settings → Account and Reporting, after
  its three pages stopped reading `window.TMAPortalData`. Reporting used to file
  a name and a date into localStorage with no numbers behind them, the
  notification history listed whatever the mock had pushed into it, and branding
  applied to the one browser that typed it.

  `ReportingTest`, `NotificationHistoryTest` and `BrandingTest` cover the
  endpoints; what only a browser can show is that the pages reach them. It
  creates a usage report and a storage report through the dialog and checks the
  metric strip carries the *seeded* figures (three sign-ins, two uploads,
  3.0 MB), drills into one, runs it again, deletes it — and then wipes
  `localStorage` and reloads, which is the sharpest check in the file: under the
  old build the page went blank.

  For the history it checks the two states a mock never had: a queued email
  reported as queued rather than sent, and a failed one carrying its reason.
  For branding it saves, reloads, then opens a **second browser context** on an
  employee account that never visited Settings — their shell can only know the
  firm's name and title if it really is stored server-side — and confirms their
  own write is refused.

  Two things it was written around: the tab title is owned by the shell's
  per-view heading, so branding's page title is the name it *falls back* to, not
  a replacement (check the value through `window.TMABranding.get()`, not
  `document.title`); and step 11 was flaky until the branding cache stopped
  merging edits over a possibly-stale cached copy — see
  `BrandingTest::test_a_save_is_not_lost_to_a_reader_that_cached_the_row_late`.

  Needs `e2e@example.com` (Administrator) and `emp@example.com` (Employee), plus
  a few rows to measure:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute='
    $admin = App\Models\User::where("email", "e2e@example.com")->first();
    foreach (range(1, 3) as $i) {
      App\Models\ActivityLog::create(["uid" => (string) Str::ulid(), "actor_id" => $admin->id,
        "activity_type" => "security.login", "module" => "security", "action" => "login",
        "description" => "Test Admin signed in"]);
    }
    $folder = App\Models\Folder::create(["uuid" => (string) Str::uuid(), "name" => "Docs",
      "owner_id" => $admin->id, "created_by" => $admin->id]);
    foreach ([1048576, 2097152] as $i => $size) {
      App\Models\FileItem::create(["uuid" => (string) Str::uuid(), "folder_id" => $folder->id,
        "owner_id" => $admin->id, "uploaded_by" => $admin->id, "name" => "brief-$i.pdf",
        "extension" => "pdf", "mime_type" => "application/pdf", "size" => $size,
        "disk" => "local", "storage_path" => "files/x$i.pdf"]);
    }
    App\Models\EmailDelivery::create(["recipient" => "dana@example.com", "status" => "sent",
      "subject" => "Your invitation to the portal", "template" => "clientInvite",
      "queued_at" => now(), "sent_at" => now()]);
    App\Models\EmailDelivery::create(["recipient" => "sam@example.com", "status" => "queued",
      "subject" => "Password reset", "template" => "passwordReset", "queued_at" => now()]);
    App\Models\EmailDelivery::create(["recipient" => "lost@example.com", "status" => "failed",
      "subject" => "Welcome aboard", "template" => "welcome", "error" => "Mailbox unavailable",
      "queued_at" => now(), "failed_at" => now()]);'

  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/account-reporting.mjs
  ```

  It creates and deletes its own reports and leaves branding on the portal
  defaults, so it is safe to re-run.

- **`security-settings.mjs`** — Account settings → Security, after the panels
  that only *rendered* were wired to the server: the phone number, the four
  Security notifications switches, and the empty column beside every session.

  `SecuritySettingsTest` covers the endpoints; only a browser can show a panel
  is actually connected to one. So each check goes through the UI and reads the
  result back from `/security-settings/data` rather than from the markup. Two
  things the script had to learn: the portal's tel inputs re-format as you type
  (compare digits, not strings), and a hand-seeded `sessions` row older than
  the session lifetime is garbage-collected before the page loads — so step 6
  signs the same account in from a **second browser context** to have something
  real to sign out, then confirms that browser is bounced to the login page.
  That last check is the one that matters: deleting the session row alone left
  a "stay signed in" browser able to walk back in on its remember-me cookie.

  Step 7 needs the account flipped to `password_auto` (the state a Google/
  Microsoft or administrator-created account arrives in, where "Change
  password" can never work), so it only runs when `TMA_DB` points at the sqlite
  file. It restores the harness password afterwards.

  Needs `SESSION_DRIVER=database` — with any other driver the sessions table is
  empty and step 6 has nothing to work with:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= SESSION_DRIVER=database \
    MAIL_MAILER=log php artisan serve --host=127.0.0.1 --port=8899 --no-reload &

  TMA_DB="$DB" TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/security-settings.mjs
  ```

- **`clienthub-access.mjs`** — Settings → Client hub management → Client hub
  access, which used to be two localStorage toggles and is now the firm's real
  client-hub capability grid.

  `ClientHubSettingsTest` covers the API and the matrix; what only a browser
  can show is that a saved toggle *travels*. The script revokes "Open the
  client hub" as the administrator, then opens a second context as the
  employee and checks the Clients row has actually left their sidebar and the
  page 404s — then puts it back and watches the row return. It also checks the
  four dependent permissions disable themselves when reach is off, since a
  granted permission on a page nobody can open is a lie.

  The switch input sits under its own track, so toggles need `{ force: true }`.

  Needs the administrator and employee accounts. Step 1 reads the matrix
  defaults, so re-seed (`DELETE FROM portal_settings WHERE key =
  'clienthub.access'`) if a run ever aborts part-way:

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/clienthub-access.mjs
  ```

- **`calendar-sync.mjs`** — Phase 4 (Google/Microsoft). Real providers can't be
  reached from a test, so the seed supplies a `google`-source calendar carrying
  one conflicted event (its `conflict_snapshot` holds the overwritten local
  version). The script drives the sidebar's provider menu, opens the conflict
  resolver and checks **both** versions are shown side by side before restoring
  the local one, flips the sync direction through the settings panel, and reads
  the audit history back. Needs the Phase 4 seed — a ConnectedAccount (google,
  with a `calendar.events` scope) plus that calendar and event; see the seed
  block at the top of the script's git history. Use a viewport wider than
  1500px or the sidebar hides behind the open panel.

- **`calendar-ics.mjs`** — recurrence and ICS. Creates a weekly series through
  the form and checks it *expands* rather than being stored per instance
  (composite `<master-uuid>@<instant>` ids, one row), that editing one instance
  raises the this/following/all prompt and renames exactly one occurrence, that
  export writes the series as a single VEVENT with its RRULE instead of dozens
  of copies, and that the import wizard round-trips a file. Ends by checking a
  subscription URL pointed at `169.254.169.254` is refused — the SSRF guard.

  Needs a fresh database: it asserts on absolute occurrence counts.

- **`calendar-sharing.mjs`** — Phase 2, and it needs **three** staff accounts
  (`e2e@example.com` as administrator, plus `bea@example.com` and one more).
  Creates a real group on the People screen, shares a private calendar with
  that group, and checks a member reaches the calendar *through the group
  alone* — before sharing they must not see it, after revoking it must drop off
  their list. Then invites the group to an event, replies as the member, and
  confirms the organizer sees the acceptance. The check worth keeping is that
  no event title appears anywhere in an availability response.

  One setup note it was written around: the staff picker is ordered by name, so
  members are selected by email rather than index. (It also reaches the Groups
  screen through `TMADashboard.navigate` because `/people/*` used to 404 on a
  cold load; those URLs are served now — see `people.mjs`.)

- **`calendar.mjs`** — the Calendar page is server-backed, not the old
  localStorage prototype: a fresh account is provisioned one Personal calendar
  and shows *no* invented events (the old build seeded eleven), an event
  created through the panel survives a reload, and unticking a calendar clears
  its events from the grid while the calendar itself — and its events — stay on
  the server. Also checks that switching views never reloads the page (a
  sentinel set on `window` has to survive) and that the view the user left in
  comes back. Needs a staff account.
- **`file-library.mjs`** — the client/organization folder wiring: an assigned
  client folder and an all-staff organization folder appear as labelled groups
  ("Assigned Clients", "Organization Folders") in the Folder Shortcuts tab, and
  the client profile's "Open folder" action lands in the File Library. Needs an
  administrator account.
- **`workflows-hub.mjs`** — the Workflows section, which was two empty-state
  stubs. `WorkflowHubTest` covers the queries and every access rule; what only
  a browser proves is that the page is usable *away from the file*. Two
  contexts: the admin sends an approval and names Bea in a comment, then Bea
  answers the approval and replies to the thread from the Workflows page
  without ever opening the file. It also checks the two things that quietly
  rot — the tab count moving to and from zero as the request is answered, and
  a reply not being counted as an open thread — and that Bea is **not** offered
  Resolve on somebody else's question, which is the rule rather than a gap.

  Two things it was written around. `artisan serve` runs a single PHP worker
  and every action here is two round trips (the write, then the reload it
  triggers), so the script waits for the list to *say* something rather than
  for a number of milliseconds. And the desktop sidebar can be set to Hover
  Overlay, which expands over the cards — the pointer is parked on the right
  before every click.

  Needs `e2e@example.com` (Administrator) and `bea@example.com` (Employee).
  It leaves its file and thread behind, so re-runs stack up; the checks are
  scoped to a per-run stamp, but a fresh database reads more clearly.

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/workflows-hub.mjs
  ```
- **`sync-notice-dismiss.mjs`** — closing the File Library's "…synced 1d ago"
  line, permanently. It had no close button at all, so a library synced
  yesterday said so above the file list for ever. The assertion that carries
  this test is the **second browser context**: empty localStorage, same account,
  and the line must still be hidden — a browser-only dismissal passes every
  other check here and fails that one. Only the quiet line is dismissible; a
  sync in progress, a sync error and an unresolved conflict all still show.
  Needs a connected library whose last sync succeeded.
- **`home-library-actions.mjs`** — bulk actions and the row menu on the
  dashboard's Recent Files / Shared-with-me tables. Those tables rendered
  checkboxes, a select-all header and a three-dot button with **nothing wired to
  any of it**. The test drives the real controls and insists on consequences,
  not appearances: the toolbar reveals on selection, the selection survives the
  re-render each click triggers, a partial selection leaves the header box
  *indeterminate* (a DOM property no markup can express), delete asks before
  acting, and — the two that matter — a row-menu action and a bulk delete are
  each followed back to the server. Opening the menu proved nothing on its own:
  the actions come from the File Library and several re-look the row up by id,
  which found nothing when driven from the dashboard, so every item was
  clickable and did absolutely nothing. Needs a few files in Recent Files
  (it deletes one, so re-seed between runs).
- **`dashboard-stability.mjs`** — the Dashboard staying put. Leaving the board
  and coming back re-fetched six endpoints, re-rendered on each answer, and
  force-refreshed the Default Folders strip — which replaced every card's
  contents with an empty list until the previews came back. PHPUnit cannot see
  any of that, and neither can a check on the rendered HTML: a re-render that
  happens to produce identical markup still destroys images and scroll
  position. So the script **stamps the live DOM nodes** (`el.__stableMark`)
  before navigating away and looks for the stamps afterwards — a rebuilt tile
  fails even when it looks the same. It also counts the network calls on the
  way back (none, inside the freshness window) and confirms that *re-selecting*
  the page still refetches, so the windows never swallow an explicit refresh.

  Its second half is the Employees card, and it reads **computed colour**
  rather than class names: the bug was an offline colleague wearing the online
  green because their work plan said "in office", which a class-name assertion
  would have passed. It also checks the "Last seen 12 minutes ago" phrasing.

  How much of the card the list uses is checked by **measuring the rows**, not
  by asserting `max-height` and `overflow-y` — both of those passed a build in
  which the list was visibly broken. A flex column shrinks its children by
  default, so the moment the list gained a max-height thirteen rows were
  squeezed into six rows' worth of space, every name sitting on the line
  beneath it, instead of scrolling. So it asserts no row overlaps the one
  below, every row keeps its full height, nothing spills past the card, and
  `scrollHeight` genuinely exceeds `clientHeight`.

  It then **sets the card's height to 760px** and re-counts, rather than
  waiting for the board to stretch it. The masonry stretches the bottom card in
  each column so the columns end level, and whether *this* card is the one
  stretched depends on what else is on the board — a fixture that happens not
  to stretch it would quietly assert nothing. A taller card has to show more
  people, not the same six over a third of empty space.

  Seed **more than six** colleagues or the whole overflow half is skipped.

  Then the hover actions: message / voice / video appear on hover, are real
  28px targets, do not change the row's height (this list scrolls — a row that
  grows under the pointer moves the board out from under it), and your own row
  has none. Clicking Message opens the direct conversation and rings nobody;
  clicking Video opens it **and starts a call**, which is the whole chain worth
  proving — the board knows a person, a call needs a conversation. Headless
  Chromium has no camera, so the call lands in its error state and its scrim
  covers the shell; hang up with `TMAMessagingCalls.end()` rather than clicking
  through it.

  The seed needs an Administrator (`presence.view` is admin-only — an employee
  gets `{staff: false}` and no board at all), colleagues who are **offline**
  with an "in office" work plan for today, and some default folders with files
  in them, or steps 9–11 assert nothing:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute='
    use App\Models\{Folder, FileItem, User, UserPresence, WorkDay};
    use Illuminate\Support\Str;
    $u = User::where("email", "e2e@example.com")->first();
    // More than six, so the scroll assertion has something to measure. One of
    // them must be called Bea Adams — the script addresses her by name.
    $names = ["Bea Adams", "Cindy Emmanuel-McLean", "Dincel Baptiste",
              "Dominique Dantes", "Francesca St. Clair", "Krysnna Monrose",
              "Lea Promesse", "Mayella Dupres"];
    foreach ($names as $i => $n) {
      $s = User::create(["name" => $n, "email" => Str::slug($n).".e2e@example.com",
        "password" => Hash::make("password12345")]);
      $s->forceFill(["email_verified_at" => now(), "profile_completed_at" => now(),
        "onboarding_completed_at" => now(), "status" => "approved",
        "account_type" => "Employee"])->save();
      UserPresence::create(["user_id" => $s->id, "last_seen_at" => now()->subMinutes(7 + $i),
        "online_until" => now()->subMinutes(6)]);
      WorkDay::create(["user_id" => $s->id, "work_date" => now()->toDateString(),
        "status" => "in_office"]);
    }
    foreach (["Firm Policies", "Client Intake", "Templates"] as $name) {
      $f = Folder::create(["uuid" => (string) Str::uuid(), "name" => $name,
        "owner_id" => $u->id, "created_by" => $u->id,
        "folder_type" => Folder::TYPE_ORGANIZATION, "org_wide" => true,
        "audience" => "all_staff", "audience_role" => "viewer"]);
      for ($i = 1; $i <= 3; $i++) {
        FileItem::create(["uuid" => (string) Str::uuid(), "folder_id" => $f->id,
          "name" => "$name doc $i.pdf", "extension" => "pdf", "size" => 1024,
          "disk" => "local", "storage_path" => "vault/2026/08/".Str::random(8).".pdf",
          "owner_id" => $u->id, "uploaded_by" => $u->id]);
      }
    }'

  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/dashboard-stability.mjs
  ```

  Note `work_date`, not `date` — the column has bitten this seed before.
- **`file-requests.mjs`** — Request Files, dialog to stranger. `FileRequestTest`
  covers the rules; what only a browser shows is the half that was missing
  entirely, because the Dashboard shortcut and the File Box each opened their
  own one-field dialog that logged a line locally, said "File request sent",
  and sent nothing — no request, no link, no destination. The script fills in
  the real dialog (title, instructions, destination picker, allowed types,
  size, expiry, password), creates the link, then opens it in a **separate
  browser context with no portal session** and uploads a file. That separate
  context is the point: it is the only way to prove the recipient needs no
  account, and that the page leaks neither the destination folder's contents
  nor any portal navigation.

  Three harness rules it was written around. The documented toggle switch draws
  its track over the real `<input>`, so every `.check()` here needs
  `{ force: true }` or Playwright waits forever on an intercepted click.
  `[data-portal-modal-close]` also matches the modal *backdrop*, which the
  dialog itself covers — scope it to `.tma-portal-modal__head`. And the File
  Library's URL is `/folders/all`; a bare `/folders` is not in `SPA_PAGES` and
  404s on a direct visit.

  Needs the standard `e2e@example.com` account and at least one folder it can
  upload into. Leaves a request and an uploaded file behind, so re-seed between
  runs if the counts matter to you.

  ```sh
  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/file-requests.mjs
  ```
- **`library-sync-panel.mjs`** — where the SharePoint sync indicator actually
  lands. It stubs `/sync-status` with a library mid-import, then *measures the
  rendered box*: the panel must sit within 20px of the bottom-right corner, stay
  there across a navigation, and stack with the upload panel rather than
  overlap it. Geometry rather than CSS assertions, because the bug it exists for
  was a hand-measured `bottom: calc(... + 92px)` that read as correct in the
  stylesheet while putting the panel 108px up the right-hand edge whenever no
  upload was running. It also covers minimising: the panel collapses to a
  single line, keeps the title so progress is still readable, survives the
  five-second repaint without springing back open, stays collapsed across a
  navigation, and expands again on a second click. Needs only the standard
  `e2e@example.com` account.
- **`settings-personal-prefs.mjs`** — Settings Phase 1: Theme, Privacy and
  Plugins save to the account rather than to one browser. It drives the real
  panels (plus the header's own dark-mode toggle, which used to write
  localStorage and stop there) and reads `/me/preferences` back, then opens a
  **second browser context** — empty localStorage, same account — on the
  *dashboard*, not Settings, and checks the saved theme is actually applied
  there. It also pins two things a unit test can't reach: a plain page load
  must not rewrite the preferences it just hydrated, and a removed plugin must
  stay removed across a reload. Resets the account to shipped defaults first,
  so it is safe to re-run. Needs the standard `e2e@example.com` account.

  Two gotchas it was written around: Settings mounts **twice** (desktop and
  mobile), so every selector here is `:visible`-scoped or the counts double;
  and the switch `<input>` sits under its own track/thumb spans, so a real
  click never lands — activate the wrapping `<label>` instead.
- **`overview-profile.mjs`** — everything the Admin Overview borrows from
  elsewhere: the profile cards from the account page, the desktop download
  promo they carry, and the Recent sign-ins card. The profile cards are one
  component rendered in two places, so this checks the borrowed copy
  *hydrates* (a stale one sits on "Loading…" forever) and that its flex rows
  span the two-column grid instead of landing in one column. The download
  buttons must say what is really published — macOS enabled with its version
  in the tooltip, Windows inert because nothing builds it yet.

  The sign-ins card is the shared activity row component over a different
  feed, so the checks are: no skeleton rows left behind, every row carrying
  text *and* a time, an avatar box that stays a small circle, no sign-outs,
  and — the property the card exists for — somebody other than the viewer in
  the feed. That last one is asserted against `/portal/sign-ins` rather than
  the visible rows, because the viewer's own logins pile up at the top across
  runs. It also confirms the feed never carries `ip`/`device`, and that "See
  all activity" switches tabs in place. Ends on `/account` to confirm the
  original profile panel still works.

  Profile Details is checked field by field, because every row on it is a real
  column now (`company` included) served through `/me` — a dash there means the
  payload dropped a field, not that the person left it blank. It then clicks
  Edit Profile and asserts the real editor opened *in place*, with the account's
  values already in the form.

  Needs the standard `e2e@example.com` account with its profile filled in, a
  colleague with a sign-in, and a manifest on the files disk for the download
  buttons:

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= FILES_DISK=local \
    php artisan tinker --execute="
      Storage::disk(config('filesystems.files_disk'))->put('desktop/latest-mac.yml',
        \"version: 0.8.0\nfiles:\n  - url: TM ANTOINE Portal-0.8.0-arm64.dmg\n    size: 2\n\");
      \\\$b = App\Models\User::firstOrCreate(['email' => 'bea@example.com'],
        ['name' => 'Bea Adams', 'password' => Hash::make('password12345')]);
      \\\$b->forceFill(['email_verified_at' => now(), 'profile_completed_at' => now(),
        'onboarding_completed_at' => now(), 'status' => 'approved',
        'account_type' => 'Employee'])->save();
      App\Models\AuthEvent::create(['user_id' => \\\$b->id, 'event' => 'login',
        'ip' => '41.13.8.2', 'user_agent' => 'Safari', 'created_at' => now()->subHour()]);
      App\Models\User::where('email', 'e2e@example.com')->first()->forceFill([
        'phone' => '+1 555 123 4567', 'job_title' => 'Managing Attorney',
        'company' => 'TM ANTOINE Advisory',
        'linkedin_url' => 'https://linkedin.com/in/vernon-francis'])->save();"

  TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/overview-profile.mjs
  ```

- **`sidebar-access.mjs`** — role gating and the Folder Shortcuts icon box, the
  two sidebar things PHPUnit can't see. A shortcut with no custom stamp renders
  the folder as a bare `<img>` carrying *both* `.tma-folder-icon__base`
  (`width:100%`) and `.tma-dash__nav-icon` (a fixed box); portal-files.css loads
  after dashboard.css, so at equal specificity the 100% won and the folder grew
  to ~189px — the full width of the sidebar. Only a *computed* box catches that,
  so the script measures every shortcut icon expanded and in the collapsed rail.
  It then checks a Client is not offered Clients/Users/Email/Feed/Overview while
  keeping their own nav, and — the regression that bit once already — that the
  prune leaves the sidebar's own tab row, shortcuts list and profile block
  alone. Needs three accounts: `e2e@example.com` (Administrator),
  `emp@example.com` (Employee) and `client@example.com` (Client).

  ```sh
  DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute='
    foreach ([["Test Admin","e2e@example.com","Administrator"],
              ["Emp Loyee","emp@example.com","Employee"],
              ["Cli Ent","client@example.com","Client"]] as [$n, $e, $t]) {
      $u = App\Models\User::create(["name" => $n, "email" => $e,
        "password" => Hash::make("password12345")]);
      $u->forceFill(["email_verified_at" => now(), "profile_completed_at" => now(),
        "onboarding_completed_at" => now(), "status" => "approved",
        "account_type" => $t])->save();
    }'
  ```

  Two things it was written around: the desktop sidebar opens on the collapsed
  72px rail with `[data-action="toggle-sidebar"]` *hidden*, so the script hovers
  the sidebar to expand it (and moves the pointer away to measure the rail); and
  "Stay signed in?" sits in front of the whole portal, redirecting even the JSON
  APIs until it is answered — an unanswered gate shows up as HTML where JSON was
  expected.
- **`mailbox-conversations.mjs`** — the message list: one row per
  conversation, the dropdown arrow that only appears where there really is more
  than one message, and what expanding it must *not* do (open the reading pane,
  and so mark something read just for being looked at). Then selection — the
  sender's picture is the checkbox, appearing on hover, and ticking a
  conversation ticks its replies — the toolbar's select-all over everything on
  screen, the right-click menu, the categories strip as real server listings,
  and the double-click that opens a conversation in its own window.

  It also measures what the words "smaller, plain black text" and "no hover
  shadow" actually mean once rendered: computed background, radius, font size
  and weight on the folder counts, and the compose button's `box-shadow` while
  hovered. And it pins the loading behaviour — a cold load must show skeleton
  rows and never the sentence "Loading messages…", re-opening Email must not go
  back to a loading state, and a full page reload must paint real mail on the
  first frame from the warm cache.

  Three things it was written around. Clicking a row's *content*, not its
  centre: in a narrow split list the picture-checkbox sits close enough to the
  middle that a centred click selects instead of opens. The double-click check
  runs early, before anything else has moved a row — a repaint landing between
  the two clicks lands the second one on the row above. And the reading pane
  keeps its scroll position after the composer closes, which tucks the message
  head under the sticky subject bar, so the pane is scrolled back to the top
  before its three-dot menu is clicked.

  Needs a conversation to expand, so its fixture is the `mail-thread.mjs` seed
  below plus a few single-message ones (one unread, one starred, one pinned) to
  give the categories something to list.

- **`mailbox.mjs`** — the email page is server-backed, not the old hard-coded
  `INBOX` array: the list loads from `/portal/mail`, opening a message marks it
  read, starring round-trips, folder badges come from the server, and Email
  settings opens *over* the page instead of navigating to `/settings`. It also
  pins the failure case that matters — a dead OAuth grant degrades to a
  reconnect banner over an intact list rather than blanking the mailbox. Needs
  a user with a connected account row (see the mailbox fixture below).
- **`mail-sync-progress.mjs`** — the mailbox sync progress panel and the
  mailbox-only sign-out. Seeds a running `mail_sync_progress` row and then
  mutates it via sqlite the way the queue jobs would (importing → stalled →
  retried → failed → completed), asserting the panel shows the stage, real
  counts with the `~` estimate marker, a measured time estimate, the stall
  notice with a working Retry, the actual failure reason, and that it clears
  itself on completion. Ends by signing the mailbox out and checking the
  provider account (and the imported mail) survive it. Needs the microsoft
  fixture below plus `TMA_E2E_DB` pointing at the sqlite file:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$a = App\Models\ConnectedAccount::create(['user_id' => \$u->id, 'provider' => 'microsoft',
    'provider_id' => 'ms-e2e', 'email' => 'e2e@example.com', 'name' => 'Test User',
    'token' => 'refresh', 'scopes' => ['Mail.ReadWrite'], 'sync_email' => true]);
  \$a->forceFill(['mail_cursor' => 'ts:'.now()->toIso8601ZuluString(), 'mail_synced_at' => now()])->save();
  foreach (range(1, 12) as \$i) {
    App\Models\MailMessage::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
      'connected_account_id' => \$a->id, 'remote_id' => 'm'.\$i, 'thread_id' => 't'.(\$i % 5),
      'folder' => 'inbox', 'subject' => 'Seeded message '.\$i, 'snippet' => 'Preview '.\$i,
      'from_name' => 'Dana Reed', 'from_email' => 'dana@example.com', 'is_read' => \$i % 2 === 0,
      'has_attachments' => \$i % 3 === 0, 'sent_at' => now()->subMinutes(\$i * 9)]);
  }
  App\Models\MailSyncProgress::create(['user_id' => \$u->id, 'connected_account_id' => \$a->id,
    'provider' => 'microsoft', 'status' => 'running', 'current_stage' => 'importing',
    'current_folder' => 'inbox', 'totals_estimated' => true, 'total_messages' => 8420,
    'processed_messages' => 1250, 'total_conversations' => 3180, 'total_attachments' => 1245,
    'processed_attachments' => 310, 'total_images' => 680, 'total_documents' => 565,
    'percentage' => 15, 'started_at' => now()->subMinutes(2), 'last_progress_at' => now()]);
"

TMA_E2E_DB="$DB" node tests/Browser/mail-sync-progress.mjs
```

  Serve with `QUEUE_CONNECTION=database` and no worker, so jobs the page
  dispatches queue up instead of running inline against a token that cannot
  work. Re-seed between runs — the script ends signed out with the progress
  row completed.

- **`mail-labels.mjs`** — label management and live counts. Every inbox row
  carries a tag button that opens the "Label as" picker; the sidebar's `+` and
  per-label pencil drive the create/rename/recolour/delete editor (deleting
  takes a second, armed click); a portal-only label applies with no provider
  round trip; an org-member sender shows their portal avatar; and the folder
  badges — sidebar and dashboard nav — follow the poll's folder counts without
  a reload (the poll is stubbed with fresh numbers to prove the wiring). Needs
  the seed below: the mailbox fixture's messages plus a provider label, a
  portal-only label, and a `dana@example.com` portal user with an avatar:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$dana = App\Models\User::create(['name' => 'Dana Reed', 'email' => 'dana@example.com',
    'password' => Hash::make('password12345')]);
  \$dana->forceFill(['email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => 'Employee',
    'avatar_url' => '/images/avatars/Avatar3d01.png'])->save();
  \$a = App\Models\ConnectedAccount::where('user_id', \$u->id)->first();
  App\Models\MailLabel::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
    'connected_account_id' => \$a->id, 'remote_id' => 'local:'.Str::uuid(),
    'name' => 'Personal', 'tone' => 'green']);
"

node tests/Browser/mail-labels.mjs
```

  It ends with labels renamed and one deleted — re-seed between runs.

- **`mail-pins.mjs`** — pinning and the Important view. Every inbox row's
  hover bar leads with a pin button (next to archive / delete, which used to
  be dead chrome); pinning floats the row to the top of the folder, shows a
  marker beside the timestamp, and *survives a reload* because the ordering
  is the server's (`is_pinned` desc, then `sent_at`); unpinning drops it back
  exactly where the next fetch would put it. The sidebar's Important item is
  checked for position (under Inbox), its unread badge, and that the view
  lists important mail only. The move route is stubbed (fake token), so the
  archive check reads the immediate effect — the poll would put the row back.
  Needs the mailbox fixture with one message seeded `is_important` — reset
  pins between runs:

```sh
sqlite3 "$DB" "UPDATE mail_messages SET is_pinned = 0, folder = 'inbox' WHERE folder != 'sent';"

node tests/Browser/mail-pins.mjs
```

- **`mail-suggest.mjs`** — Phase-1 compose recipient typeahead. Typing in To
  surfaces organization staff, clients, and prior-mail addresses from
  `/portal/mail/suggest`; clicking or pressing Enter inserts
  `Name <email>` without wiping the caret. Needs a staff user, a colleague
  (`dana@example.com`), a client (`Acme` / `hello@acme.test`), a connected
  mailbox, and at least one prior message from `pat.partner@example.com`.

```sh
node tests/Browser/mail-suggest.mjs
```

- **`mail-snooze.mjs`** — snooze as a working reminder. The hover clock opens
  a "Snooze until…" picker (In 15 minutes / In 1 hour / Later today /
  Tomorrow / Next week + custom datetime); picking a preset hides the row
  from Inbox into the Snoozed view with a clock marker; unsnoozing puts it
  back. With `TMA_DB` set, the script forces the snooze due, runs
  `php artisan mail:wake-snoozed`, and asserts the `email.snooze_due`
  reminder notification (plus the toast that surfaces it). Needs the
  mailbox fixture; reset snoozes between runs:

```sh
sqlite3 "$DB" "UPDATE mail_messages SET snoozed_until = NULL;"

TMA_DB="$DB" node tests/Browser/mail-snooze.mjs
```

- **`notify-toasts.mjs`** — notification toasts and the live right-rail
  panels. A notification arriving while the user is in the portal (realtime
  or the poll fallback) pops a card top-right that carries the title and
  message, closes on its own after 10 seconds, is held open for as long as
  the pointer hovers it, and closes 5 seconds after the pointer leaves. The
  X dismisses immediately, and a notification id never toasts twice even if
  both delivery paths report it. Also pins that Activities lists the sign-in
  the test itself just performed (the login listener writes the audit row)
  and that Notifications shows a seeded server row. The run spends real
  wall-clock time on the timers (~45s). Seed a fresh DB with the base user
  plus one notification:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::create(['name' => 'Test User', 'email' => 'e2e@example.com',
    'password' => Hash::make('password12345')]);
  \$u->forceFill(['email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved',
    'account_type' => 'Administrator'])->save();
  App\Support\Notifications\Notifier::send(['user' => \$u, 'type' => 'email.received',
    'title' => 'New email from Dana Reed', 'message' => 'Quarterly review attached',
    'action_url' => '/email']);
"

node tests/Browser/notify-toasts.mjs
```

- **`mail-thread.mjs`** — the reading pane as a *conversation*. It used to
  render only the message that was clicked, so a reply arrived with none of the
  thread it belonged to and the quoted history it carried was dumped inline
  underneath it. This opens a seeded three-message thread and checks each
  message is its own card, older ones start collapsed, expanding one loads its
  body, and the quoted history is hidden behind a toggle that still reveals it
  in full. It also pins the compose window opening *blank* — it used to arrive
  pre-filled with a stand-in invoice — and the formatting toolbar acting on the
  selection. Needs the mailbox fixture plus a thread; see below.
- **`client-folder-tab.mjs`** — the client profile's Folders tab as a live file
  area: it lists the client folder's real subfolders, the "New folder" button
  creates one, and "Upload" adds a file that appears in the list. Needs an
  administrator account. **Serve with several workers**
  (`PHP_CLI_SERVER_WORKERS=12 php artisan serve`) — the single-threaded dev
  server drops API calls while the asset-heavy SPA is still loading, which reads
  as a hang, not a bug.
- **`dashboard-kpis.mjs`** — the portal home KPI row, which used to be four
  hard-coded strings (`3h 24m`, `128`, …). It signs in, waits out the skeletons,
  and reads back the four rendered cards: each must carry a value the server
  actually measured, and none may be left at the em-dash the client falls back
  to when the metrics request fails. Needs the KPI fixture below — with an empty
  database the cards are *correctly* empty and the run proves nothing.
- **`dashboard-messages.mjs`** — the home dashboard's Messages tile: the five
  rows it shows have to be the *first five* the conversations API returns
  (checked against the API in the same session, not against a fixture), each
  carrying a name, an avatar — an initials tile where there is no photo, never a
  stock face — and no row wider than the tile it sits in. It then turns the tile
  off through Edit Dashboard, confirms it leaves the board, turns it back on,
  and clicks a row: the Messages view must open *on that conversation*, which is
  the whole point of the tile. Needs a staff account with a few conversations —
  the messaging seed at the end of this file provides them.
- **`sidebar-logo.mjs`** — which logo the sidebar shows. The rule is one
  sentence (open = wordmark, collapsed rail = mark) but there are four states
  across two sidebar styles, and the hover overlay was showing the mark while
  fully expanded. Reads *computed* display in each state, so a rule overridden
  later in the cascade fails here instead of in someone's eyes. Also pins that
  mobile hides the logo block entirely in favour of the mobile head. Any
  signed-in account will do.
- **`sidebar-nav-refresh.mjs`** — the navigation rules that only exist as
  geometry and network traffic. It measures row-to-row spacing in the rail with
  no submenu open, one open and two open (the menu used to pay for an open
  group by squeezing every other row), clicks a group icon in the collapsed
  rail and checks it lands on the section's first page, and counts requests to
  prove that re-selecting the page you are already on refetches it — for a
  live-backed list, for Overview, and for the Dashboard, which reload three
  different ways. Then it drives pull-to-refresh through CDP
  (`Input.dispatchTouchEvent`; Playwright's mouse API cannot produce touch
  events) and asserts a short drag does *not* refresh. Finishes in a mobile
  context, because the drawer is a different sidebar and must keep toggling its
  groups. Any signed-in account will do.
- **`clients-split-view.mjs`** — the Client hub's side-by-side layout, which is
  the page toggle's *grid* mode (`[data-view-mode="grid"]`), not a separate
  screen. Measures the gutter between the two panes and the list's default
  width, drags the handle to prove the list still goes below that default, and
  checks the drag target is wider than the gutter it draws. Then the letter
  headings: exactly one pinned at a time, and it must be the group on screen —
  flat sticky siblings all pin to the same line and stack there, which reads
  correctly by accident while every heading scrolled past sits in the layer
  underneath. Finally the Documents / Assigned tab counts, in both layouts,
  before either tab has been opened, and unchanged by drilling into a
  subfolder. Needs a client called "Amara Okafor" with 5 documents (3 in the
  root, 2 in a subfolder) and 2 assigned staff.

`fixtures/contract.pdf` is a hand-built two-page PDF (no library, no
dependency) with distinct text on each page, so a wrong page or a blank canvas
is visible rather than plausible.

Both scripts have earned their keep — between them they caught a mail template
that threw on every send (`Mail::fake()` never renders a view, so the PHPUnit
suite was blind to it), a fields panel that couldn't scroll to its own
controls, and a spurious error toast after a successful send.

## Running

Playwright isn't a project dependency — install it wherever you like:

```sh
npm install playwright && npx playwright install chromium
```

Then set up a throwaway database and a signable file:

```sh
DB=$(mktemp -d)/e2e.sqlite && touch "$DB"

DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan migrate --force

# A user who is past verification, profile setup, and approval, plus a
# library file pointing at the fixture.
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::create([
    'name' => 'Test User', 'email' => 'e2e@example.com',
    'password' => Hash::make('password12345'),
  ]);
  // These columns aren't mass-assignable — set them directly or the login
  // lands on the email-verification screen.
  \$u->forceFill([
    'email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved',
    'account_type' => 'Administrator',
  ])->save();
  @mkdir(storage_path('app/private/vault'), 0775, true);
  copy(base_path('tests/Browser/fixtures/contract.pdf'), storage_path('app/private/vault/contract.pdf'));
  App\Models\FileItem::create([
    'uuid' => (string) Str::uuid(), 'name' => 'TMA Contract.pdf', 'extension' => 'pdf',
    'mime_type' => 'application/pdf', 'size' => 876, 'disk' => 'local',
    'storage_path' => 'vault/contract.pdf', 'owner_id' => \$u->id, 'uploaded_by' => \$u->id,
  ]);
"

DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= FILES_DISK=local MAIL_MAILER=log \
  php artisan serve --host=127.0.0.1 --port=8899 --no-reload &

node tests/Browser/signature-editor.mjs
node tests/Browser/signing-flow.mjs     # expects a fresh database
node tests/Browser/stamped-output.mjs   # expects a fresh database
node tests/Browser/folder-shortcuts.mjs # needs the folder fixtures below
```

`folder-shortcuts.mjs` wants a second user and a folder tree — it deletes a
folder as its last step, so re-seed between runs:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  DB::table('folder_shortcuts')->delete();
  DB::table('shares')->delete();
  DB::table('folders')->delete();
  \$a = App\Models\User::where('email', 'e2e@example.com')->first();
  \$b = App\Models\User::firstOrCreate(['email' => 'other@example.com'],
    ['name' => 'Other User', 'password' => Hash::make('password12345')]);
  \$b->forceFill(['email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved'])->save();
  \$f = fn (\$n, \$o, \$p = null) => App\Models\Folder::create(['uuid' => (string) Str::uuid(),
    'name' => \$n, 'parent_id' => \$p?->id, 'owner_id' => \$o->id, 'created_by' => \$o->id]);
  \$c = \$f('Contracts', \$a); \$f('Signed 2026', \$a, \$c); \$f('Invoices', \$a);
  \$t = \$f('Shared Docs', \$b);
  App\Models\Share::create(['uuid' => (string) Str::uuid(), 'token' => Str::random(40),
    'item_type' => 'folder', 'item_id' => \$t->id, 'shared_by' => \$b->id,
    'kind' => 'user', 'target_user_id' => \$a->id, 'role' => 'viewer']);
"
```

Neither user may be an `Administrator` — admins can see every folder, so the
per-user permission checks would pass for the wrong reason.

`dashboard-kpis.mjs` wants clients, conversations, mail, shares and signature
requests — its fixture is a file rather than a one-liner, and it builds the
staff account itself, so run it against a **fresh** database instead of the
seed above:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= \
  php artisan tinker tests/Browser/fixtures/kpi-seed.php
```

Only `/` serves the portal shell; deep paths like `/folders/all` exist purely
as pushState URLs and 404 on a hard load. Reach the file library by clicking
through the sidebar, as `openLibrary()` in the script does.

These send real mail, so keep `MAIL_MAILER=log`. Each assumes an empty
signatures list — re-seed between runs.

Use `php artisan serve` rather than a bare `php -S`: the built-in server hands
every request to `index.php` without Laravel's dev router, so `/js/vendor/*`
never gets served and pdf.js fails to import.

**`--no-reload` is not optional.** When a `.env` file exists, `artisan serve`
strips almost the whole environment from its worker processes so they re-read
`.env` on every change — including the `DB_*` overrides above. Without the
flag the harness starts, answers 200, logs you in… against whatever database
`.env` points at, which in this repo is the production Postgres. The tell is a
user you didn't seed (a greeting for a name that isn't in your throwaway DB)
or a login failing for an account you just created.

The script prints each step, writes `editor-fields.png` / `editor.png` beside
itself, and exits non-zero on failure.

`mailbox.mjs` needs a connected mailbox to read. The OAuth token is deliberately
fake — the script stubs the mutating routes and *expects* the body fetch to fail,
which is how it verifies the reconnect banner:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$a = App\Models\ConnectedAccount::create(['user_id' => \$u->id, 'provider' => 'google',
    'provider_id' => 'g1', 'email' => 'e2e@example.com', 'name' => 'Test User',
    'token' => 'refresh', 'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
    'sync_email' => true]);
  // A cursor stops the page seeding a full sync against a token that cannot work.
  \$a->forceFill(['mail_cursor' => '100', 'mail_synced_at' => now()])->save();
  \$l = App\Models\MailLabel::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
    'connected_account_id' => \$a->id, 'remote_id' => 'Label_1', 'name' => 'Clients', 'tone' => 'blue']);
  foreach ([['m1','Quarterly review','Dana Reed','dana@example.com',false],
            ['m2','Invoice #1042','Ana Ruiz','ana@example.com',false],
            ['m3','Re: onboarding','Sam Lee','sam@example.com',true]] as \$i => \$m) {
    \$msg = App\Models\MailMessage::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
      'connected_account_id' => \$a->id, 'remote_id' => \$m[0], 'thread_id' => 't'.\$i,
      'folder' => 'inbox', 'subject' => \$m[1], 'snippet' => 'Preview for '.\$m[1],
      'from_name' => \$m[2], 'from_email' => \$m[3], 'is_read' => \$m[4],
      'sent_at' => now()->subMinutes(\$i * 30)]);
    if (\$i === 0) \$msg->labels()->attach(\$l->id);
  }
  App\Models\MailMessage::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
    'connected_account_id' => \$a->id, 'remote_id' => 's1', 'folder' => 'sent',
    'subject' => 'Sent thing', 'snippet' => 'x', 'from_name' => 'Test User',
    'from_email' => 'e2e@example.com', 'is_read' => true, 'sent_at' => now()]);
"

node tests/Browser/mailbox.mjs
```

`mail-thread.mjs` needs a *conversation* rather than the loose messages above —
three messages sharing one `thread_id`, the middle one carrying quoted history
in the shape Outlook appends it (a `#divRplyFwdMsg` header followed by a
blockquote). That middle message is what the quoted-text toggle is checked
against, so its markup matters more than its wording:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$a = App\Models\ConnectedAccount::where('user_id', \$u->id)->first();
  \$quoted = '<div>Thanks, that works for me.</div>'
    . '<div id=\"divRplyFwdMsg\"><hr><b>From:</b> Dana Reed<br><b>Sent:</b> Monday<br></div>'
    . '<blockquote>Original message text here</blockquote>';
  foreach ([
    ['m1','Dana Reed','dana@example.com','Quarterly review','<p>Here is the quarterly review.</p>', now()->subDays(3)],
    ['m2','Test User','e2e@example.com','Re: Quarterly review', \$quoted, now()->subDays(2)],
    ['m3','Dana Reed','dana@example.com','Re: Quarterly review','<p>Perfect, see you then.</p>', now()->subDay()],
  ] as [\$rid,\$fn,\$fe,\$sub,\$html,\$when]) {
    App\Models\MailMessage::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
      'connected_account_id' => \$a->id, 'remote_id' => \$rid, 'thread_id' => 'conv-1',
      'folder' => 'inbox', 'subject' => \$sub, 'snippet' => strip_tags(\$html),
      'body_html' => \$html, 'from_name' => \$fn, 'from_email' => \$fe,
      'to' => [['name' => 'Test User', 'email' => 'e2e@example.com'],
               ['name' => 'Rae Fox', 'email' => 'rae@example.com']],
      'cc' => [['name' => 'Sam Cole', 'email' => 'sam@example.com']],
      'bcc' => [['name' => 'Quiet One', 'email' => 'quiet@example.com']],
      'is_read' => true, 'sent_at' => \$when]);
  }
"

node tests/Browser/mail-thread.mjs
```

The second To, the Cc and the Bcc are there for `mailbox-conversations.mjs`,
which reads the recipient panel back — a message addressed to one person could
not tell a working panel from the old one, which only ever printed "me".

`mailbox-conversations.mjs` also wants three single-message conversations
beside that thread, so the category tabs have something to list:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$a = App\Models\ConnectedAccount::where('user_id', \$u->id)->first();
  foreach ([
    ['s1','solo-1','Invoice #1042','Ana Ruiz','ana@example.com', ['is_read' => false]],
    ['s2','solo-2','Welcome aboard','Sam Lee','sam@example.com', ['is_read' => false, 'is_starred' => true]],
    ['s3','solo-3','Pinned notice','Ops Bot','ops@example.com', ['is_pinned' => true]],
  ] as \$i => [\$rid,\$tid,\$sub,\$fn,\$fe,\$flags]) {
    App\Models\MailMessage::create(array_merge(['uuid' => (string) Str::uuid(),
      'user_id' => \$u->id, 'connected_account_id' => \$a->id, 'remote_id' => \$rid,
      'thread_id' => \$tid, 'folder' => 'inbox', 'subject' => \$sub,
      'snippet' => \$sub, 'body_html' => '<p>'.\$sub.'</p>',
      'from_name' => \$fn, 'from_email' => \$fe,
      'to' => [['name' => 'Test User', 'email' => 'e2e@example.com'],
               ['name' => 'Rae Fox', 'email' => 'rae@example.com']],
      'cc' => [['name' => 'Sam Cole', 'email' => 'sam@example.com']],
      'bcc' => [['name' => 'Quiet One', 'email' => 'quiet@example.com']],
      'is_read' => true, 'sent_at' => now()->subMinutes(10 - \$i * 4)], \$flags));
  }
"

TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/mailbox-conversations.mjs
```

It also wants one message carrying attachments, including an inline one, since
attachments hang off a single message rather than the thread:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::where('email', 'e2e@example.com')->first();
  \$a = App\Models\ConnectedAccount::where('user_id', \$u->id)->first();
  \$m = App\Models\MailMessage::create(['uuid' => (string) Str::uuid(), 'user_id' => \$u->id,
    'connected_account_id' => \$a->id, 'remote_id' => 'att-msg', 'thread_id' => 'conv-att',
    'folder' => 'inbox', 'subject' => 'With attachments', 'snippet' => 'see attached',
    'body_html' => '<p>See attached.</p>', 'from_name' => 'Dana Reed',
    'from_email' => 'dana@example.com', 'is_read' => true, 'has_attachments' => true,
    'sent_at' => now()->subHour()]);
  foreach ([['contract.pdf','application/pdf',204800,false],
            ['photo.png','image/png',51200,false],
            ['logo.png','image/png',2048,true]] as [\$fn,\$mime,\$sz,\$inl]) {
    App\Models\MailAttachment::create(['uuid' => (string) Str::uuid(),
      'mail_message_id' => \$m->id, 'remote_id' => 'att-'.\$fn, 'filename' => \$fn,
      'mime_type' => \$mime, 'size' => \$sz, 'is_inline' => \$inl,
      'content_id' => \$inl ? 'logo001' : null]);
  }
"
```

Seeding a body on every message matters: the thread endpoint only fetches the
message being opened, and a fake token cannot fetch the rest — without cached
bodies the expand checks would be measuring a failed provider call. Expect 502s
in the console for the attachment thumbnails for the same reason; the checks
are about the tiles being *listed*, which does not need the bytes.

**Give the connected account a `provider_id` unlike the real one.** The access
token is cached under a hash of provider + provider id, and `CACHE_STORE=file`
is shared across databases on the same machine — an earlier version keyed it on
the account's row id, so a throwaway database whose first account got id 1
picked up the live mailbox's token and synced a real account into itself.

## Messaging

The Messages page was a pure mock — a hard-coded `THREADS` array with a
scripted ByeWind conversation and no network calls at all. It is now backed by
`/portal/messaging`, so these nine scripts exist to keep it that way.

- **`messaging.mjs`** — the page against a real server: the list comes from the
  API (and contains none of the old mock names), messages load and send and
  survive a reload, replies carry a quoted original, drafts stay with their own
  conversation and come back after a reload, and older history pages in.

  Its most important check is the **chat-list scroll**. Every action used to
  re-render the whole subtree, which reset the list to the top — so scrolling
  down and opening a conversation near the bottom threw you back to the start.
  The script deliberately seeds more conversations than fit on screen, asserts
  the list actually overflows, then pins the scroll offset across opening a
  conversation *and* sending a message. A run where the list doesn't overflow
  proves nothing, which is why that precondition is asserted rather than assumed.

- **`messaging-realtime.mjs`** — two users in two browser contexts. One sends,
  the other must see it with no reload; read receipts turn the sender's tick
  over; edits and deletes propagate. It also checks `/broadcasting/auth`
  refuses a channel for a conversation the caller is not in, which is the
  websocket half of the membership rule the HTTP routes enforce.

- **`messaging-toolbar.mjs`** — the three controls in the chat-list header,
  which were all dead chrome: the "search" was a `<span>` with no input behind
  it, the compose button had no handler, and the gear did nothing. It checks
  search filters conversations *and* reaches people you have no conversation
  with, that typing doesn't lose focus or reset the caret (a full re-render
  replaces the field on every keystroke — see `captureFocus`), the `/`
  shortcut, that compose opens a real conversation you can send in, and that
  the gear's Messages Settings round-trip to the server. It also pins that
  there is exactly **one** settings control in the header, since the spec asks
  for a single entry point rather than a second one.

  Its seed needs one user with **no** conversation — "Zoe Winters" above —
  otherwise the people half of search has nothing to find and the check passes
  vacuously:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$u = App\Models\User::firstOrCreate(['email' => 'zoe@example.com'],
    ['name' => 'Zoe Winters', 'password' => Hash::make('password12345')]);
  \$u->forceFill(['name' => 'Zoe Winters', 'email_verified_at' => now(),
    'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
    'status' => 'approved', 'account_type' => 'Employee'])->save();
"

node tests/Browser/messaging-toolbar.mjs
```

- **`messaging-phase1.mjs`** — the Phase 1 rework: three-state delivery,
  message tool placement, the right-click menu, closing a chat, the
  repositioned inbox toolbar, and the conversation menu. Runs **two contexts**,
  because the states are only meaningful between two people — a message is
  *delivered* when the other client acknowledges it and *seen* when they open
  it.

  It asserts the delivery **state machine** (`sent` → `delivered` → `read`) and
  re-reads deliberately rather than waiting on a transport; live propagation of
  the same change belongs to `messaging-realtime.mjs`, which runs against real
  Reverb. The states are words rather than ticks, so it reads the labels: "Sent"
  and "Delivered" inside the bubble, and a single "Seen" line with the eye icon
  *below* it — one per thread, on the newest read message. It also pins that
  delivery state never appears on incoming messages, that the hover tools sit
  over the message's top edge, and that closing a chat holds the inbox scroll
  position.

  Reset delivery state between runs, or every message is already `read` and the
  first two states can't be observed:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  App\Models\ConversationParticipant::query()->update([
    'last_read_message_id' => null, 'last_delivered_message_id' => null,
    'cleared_before_message_id' => null, 'marked_unread_at' => null,
    'pinned_at' => null, 'archived_at' => null,
  ]);
"

node tests/Browser/messaging-phase1.mjs
```

**The page no longer auto-opens a conversation on load.** It used to select the
newest one on desktop, which marked it read on the user's behalf — a false read
receipt for a message nobody had looked at, and a wiped unread badge. Scripts
must open a conversation by name before touching `[data-messages-chat-body]`.

- **`messaging-phase2.mjs`** — the emoji picker and reactions. The picker used
  to draw 21 SVG assets, **18 of which were malformed XML** (unclosed `<g>`
  groups): they returned HTTP 200 but failed to parse, so they rendered as
  broken-image placeholders — the "question marks". Emoji are native Unicode
  text now, which is also the only way categories, search and recents work at
  all. `public/js/emoji-data.js` is generated by
  `tools/generate-emoji-data.py` from Python's Unicode database, so the names
  that drive search are the real Unicode names and cannot carry typos.

  The script asserts the dataset has no replacement characters or duplicates,
  that the picker contains **no `<img>` at all**, that search and categories
  work, that reactions round-trip and can be removed, and that a non-emoji
  reaction is refused with a 422.

  Clear reactions between runs so the assertions are unambiguous:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  App\Models\MessageReaction::query()->delete();
"

node tests/Browser/messaging-phase2.mjs
```

**`X-Socket-ID` matters.** `broadcast(...)->toOthers()` can only exclude the
sender if the request carries that header. Without it every client processes
its own echoes — which made a sender mark its *own* message delivered off its
own acknowledgement, showing two grey ticks when nobody had received it. The
API client sends it whenever a socket is connected; if you add a new write path
that bypasses `messaging-api.js`, it needs the header too.

Also note the phase-1 tick script closes B's **browser context** rather than
just navigating away: with the websocket up, an open page acknowledges receipt
instantly, so "sent" is only observable when the other client is genuinely gone.

- **`messaging-phase3.mjs`** — message attachments. Files are uploaded and
  *staged* the moment they are chosen, then claimed by a message on send. That
  ordering is what makes a pre-send preview, a progress bar, a remove button and
  a retry possible, and it is why **a failed upload cannot take the typed message
  with it** — which the script pins directly by uploading a blocked `.php` while
  text sits in the composer.

  It also checks that an image renders inline *and actually decodes*
  (`naturalWidth > 0`, not merely that an `<img>` exists), that space is
  reserved from the stored dimensions, that a zip gets an honest "no preview"
  card with a download rather than a broken viewer, and that replying to a photo
  quotes it with a thumbnail.

  Fixtures live in `fixtures/message-*`. **`message-photo.png` is generated by
  hand with zlib/struct and must stay a genuinely decodable PNG** — an earlier
  version had a valid header but corrupt pixel data, so `getimagesize()` read
  40×24 on the server while every browser failed to decode it. Assert on
  `naturalWidth`, never on the element existing.

  Clear attachments between runs:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  App\Models\MessageAttachment::query()->delete();
  App\Models\Message::where('type', 'attachment')->forceDelete();
"

node tests/Browser/messaging-phase3.mjs
```

**`upload_max_filesize` is 2 MB by default** and PHP rejects anything larger
before Laravel sees it, so `fixtures/message-large.png` is deliberately ~1.8 MB:
big enough to trigger thumbnailing (>100 KB, >640px), small enough to upload.
A fixture over the ini cap fails with no useful error.

Two traps worth knowing when extending this: **Escape closes the conversation**,
so a lightbox must be dismissed with its own control or the composer disappears
underneath the next step; and `Vault::store()` **unlinks the file it is given**,
so anything needing to read the original (dimensions, checksums) must do it
before storing, and any fixture must be copied per upload.

- **`messaging-phase4.mjs`** — voice notes, recorded **for real**. Chromium is
  launched with a fake audio device, so MediaRecorder, the Web Audio analyser,
  the blob and the upload all actually run rather than being stubbed:

```
--use-fake-device-for-media-capture   synthesises a microphone
--use-fake-ui-for-media-stream        auto-grants permission
--autoplay-policy=no-user-gesture-required
```

  It checks the timer runs and *holds while paused*, that stopping produces a
  reviewable recording rather than sending, that discarding leaves nothing
  behind, and that a sent note stores real audio with a duration and waveform.
  The blocked-microphone path is the one thing the fake device cannot produce,
  so it is exercised by overriding `getUserMedia` to reject.

  Two traps live here. **Playback speed is a persisted preference**, so a run
  that leaves it at 2× makes the next run's short note finish before any
  assertion can see the progress bar — the script pins it back to 1× and polls
  rather than sampling once. And **a message with `type = voice` must be purged
  between runs** alongside attachments:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  App\Models\MessageAttachment::query()->delete();
  App\Models\Message::whereIn('type', ['attachment', 'voice'])->forceDelete();
"

node tests/Browser/messaging-phase4.mjs
```

- **`messaging-phase6.mjs`** — search mode, the in-column conversation profile,
  and the shared media/documents/links gallery.

  The behaviours that matter: search results are **grouped** (people,
  conversations, messages, files, links) rather than one ranked list; clicking a
  message result opens that conversation *at that message* via the `around=`
  cursor, which loads a window either side rather than the newest page; and
  opening a profile replaces **only the chat column** — the script scrolls the
  inbox first and asserts the offset is unchanged through opening the profile,
  browsing the gallery and coming back.

  It also pins the security property directly: every search hit must belong to a
  conversation the caller is a member of, checked against their own conversation
  list rather than trusting the endpoint.

  **Search is a mode now, not a filter.** Focusing the field takes over the
  column, so `.tma-dash__messages-row` counts go to zero while searching — the
  old expectation in `messaging-toolbar.mjs` had to be rewritten. The clear
  control is `data-messages-search-exit` (it was `-search-clear`).

  Seeded users have no avatar, so the profile shows an initials tile; the script
  handles both branches and asserts a missing photo is **not** clickable rather
  than opening a broken image.

- **`messaging-phase7.mjs`** — group conversations and the firm-wide chat.
  Creates a group through the composer, checks the system messages that record
  its own history (created / promoted / renamed / removed), and pins the
  *ownership* rules that make the organization chat different: administrator-only
  to change, **impossible to leave** (the server returns 422), and membership
  that follows the staff list rather than being curated.

  The org chat must exist before running it:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan messaging:org-chat

node tests/Browser/messaging-phase7.mjs
```

  Membership is **not** seeded by that command — `OrganizationChat::syncMembership`
  runs when a user loads their conversations, so each account joins on its next
  visit. The script proves that by signing in a second account and watching the
  member count grow without re-seeding.

  Groups created by a run are named `Falcon …`; purge them between runs or the
  conversation list fills up:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  App\Models\Conversation::where('type', 'group')->where('is_default', false)
    ->where('name', 'like', 'Falcon%')->forceDelete();
"
```

  **The shared reset blanks `pinned_at` for every participant, which strips the
  org chat's default pin** — after which this script fails on "it is pinned by
  default" with nothing actually broken. Re-pin it as part of the reset:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$c = App\Models\Conversation::where('is_default', true)->first();
  if (\$c) \$c->participants()->update(['pinned_at' => now()]);
"
```

  Two assertions had to be *loosened* rather than fixed, and the reasons matter:
  the org chat is pinned but not necessarily at index 0 (other conversations can
  be pinned, and pinned rows still sort by recency), and its member count starts
  at 1 because membership grows as accounts sign in.

- **`messaging-phase8.mjs`** — typing indicators, presence transitions, and
  unread counts that move without a reload. Two live sessions **and Reverb**,
  same setup as `messaging-realtime.mjs`.

  **A types, B watches, and B must be `e2e@example.com`** — several checks need
  B sitting in a conversation other than the one A is typing in, which Ana Ruiz
  (one seeded conversation) cannot do. The roles are deliberately the reverse of
  the other scripts; an earlier draft had them the usual way round and failed at
  "typing shows in the chat list" for that reason alone.

  Three checks are worth keeping honest, because each was a real bug first:

  - *A lost stop event expires on its own* severs A's socket mid-type so the
    retraction can never arrive. Without the receiver's own TTL the indicator
    sticks forever.
  - *Going offline and coming back* signs out through **`/auth/logout`** — not
    `/logout`, which silently does nothing and made the check pass against a
    session that had never ended. Sign-out is the only moment the server knows
    somebody left; closing a tab just lets presence lapse.
  - *Scroll stability* parks B mid-thread and sends into a **different**
    conversation, which is what fires an inbox update. The point is that a
    background arrival must not move the thread you are reading.

  Typing persists a draft, so the script clears its composer server-side before
  moving on. An earlier version cleared only the DOM and left `"about to
  vanish"` in the database, which failed the *next* run on a `Draft:` preview.

```sh
node tests/Browser/messaging-phase8.mjs
```

Seed all nine with several conversations, one of them deep enough to page:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$mk = function (\$name, \$email, \$type = 'Employee') {
    \$u = App\Models\User::firstOrCreate(['email' => \$email],
      ['name' => \$name, 'password' => Hash::make('password12345')]);
    \$u->forceFill(['name' => \$name, 'email_verified_at' => now(),
      'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
      'status' => 'approved', 'account_type' => \$type])->save();
    return \$u;
  };
  \$me = \$mk('Test User', 'e2e@example.com', 'Administrator');
  \$names = ['Ana Ruiz','Ben Carter','Chloe Diaz','Dan Meyer','Ella Novak','Femi Adeyemi',
             'Grace Lin','Hugo Marsh','Iris Vance','Jonas Peel','Kira Osei','Liam Duarte',
             'Mona Farid','Nils Bergman','Opal Reyes'];
  foreach (\$names as \$i => \$n) {
    \$o = \$mk(\$n, 'user'.\$i.'@example.com');
    \$c = App\Models\Conversation::create(['type' => 'direct', 'created_by' => \$me->id,
      'last_message_at' => now()->subMinutes(\$i * 7)]);
    foreach ([\$me, \$o] as \$m) {
      \$c->participants()->create(['user_id' => \$m->id, 'role' => 'member', 'joined_at' => now()]);
    }
    // The last thread gets deep history so 'load earlier' has something to do.
    \$count = \$i === count(\$names) - 1 ? 45 : 3;
    for (\$n2 = 0; \$n2 < \$count; \$n2++) {
      \$msg = \$c->messages()->create(['user_id' => \$n2 % 2 ? \$me->id : \$o->id,
        'type' => 'text', 'body' => \$n2 % 2 ? 'Reply '.(\$n2+1).' from me' : 'Message '.(\$n2+1).' from '.\$o->name]);
      // created_at isn't mass-assignable — backdate it explicitly.
      \$msg->forceFill(['created_at' => now()->subMinutes((\$count - \$n2) * 3 + \$i * 7)])->save();
    }
  }
  // A CLIENT account with a conversation — calls-recording.mjs needs one,
  // since only a staff↔client call exercises the recording rule.
  \$cl = \$mk('Paula Client', 'paula@example.com', 'Client');
  \$cc = App\Models\Conversation::create(['type' => 'direct', 'created_by' => \$me->id,
    'last_message_at' => now()->subMinutes(2)]);
  foreach ([\$me, \$cl] as \$m) {
    \$cc->participants()->create(['user_id' => \$m->id, 'role' => 'member', 'joined_at' => now()]);
  }
  \$cc->messages()->create(['user_id' => \$cl->id, 'type' => 'text', 'body' => 'Hello, checking in about my case.']);
"

node tests/Browser/messaging.mjs
```

`messaging-realtime.mjs` additionally needs Reverb up, and the app server has to
point at it:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan reverb:start --host=127.0.0.1 --port=8080 &

DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= FILES_DISK=local MAIL_MAILER=log \
  REVERB_HOST=127.0.0.1 REVERB_PORT=8080 REVERB_SCHEME=http PHP_CLI_SERVER_WORKERS=12 \
  php artisan serve --host=127.0.0.1 --port=8899 --no-reload &

node tests/Browser/messaging-realtime.mjs
```

Without Reverb running the realtime script fails at the "socket is connected"
check — which is the point, it's testing the socket, not a fallback. The app
itself degrades quietly in that case: sends still succeed and are stored, they
just don't arrive until the next load (see `App\Support\Messaging\Broadcaster`).

Address conversations **by name, not by list position**. Sending reorders the
list, so `.first()` is not a stable handle on a conversation — an earlier
version of the draft checks failed for exactly that reason.

## Notifications: bulk actions, the call log, and messages in the bell

- **`notifications-bulk-calls.mjs`** — three things that only exist together in
  a browser: the Overview → Notifications toolbar (no count badge on the filter,
  a live header count, select-all going indeterminate on a partial pick, and
  each bulk action moving the count the right way), the Messages call log (a
  person row per call with an arrow for the outcome and buttons that place a
  call without opening the chat first), and the round trip of a message from
  another account arriving as a notification whose link opens that conversation.

  Two things about it are worth knowing before changing it:

  - **The recipient has to be away from the thread when the message lands.**
    Reading a conversation marks its notifications read (`MessageNotifier::
    clearForConversation`), so a check run with the chat open measures nothing.
    The script navigates to Overview first for exactly that reason.
  - **The call-log check stubs `TMAMessagingCalls.start`.** WebRTC needs a peer
    and a microphone; what is being tested is that the button places the right
    call for the right person, which the stub records.

  Its seed needs two users, one conversation between them, three call system
  lines (answered, missed, outgoing-no-answer) and a few notifications:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
  \$me = App\Models\User::where('email', 'e2e@example.com')->first();
  \$tom = App\Models\User::firstOrCreate(['email' => 'tom@example.com'],
    ['name' => 'Tom Ashley', 'password' => Hash::make('password12345')]);
  \$tom->forceFill(['email_verified_at' => now(), 'profile_completed_at' => now(),
    'onboarding_completed_at' => now(), 'status' => 'approved',
    'account_type' => 'Administrator'])->save();
  \$c = App\Models\Conversation::create(['type' => 'direct',
    'created_by' => \$me->id, 'last_message_at' => now()]);
  foreach ([\$me, \$tom] as \$u) {
    \$c->participants()->create(['user_id' => \$u->id, 'role' => 'member', 'joined_at' => now()]);
  }
  \$c->messages()->create(['user_id' => \$tom->id, 'type' => 'text', 'body' => 'Morning — did the filing go out?']);
  foreach ([['call_ended','Voice call','audio',true,\$tom->id],
            ['call_missed','Video call','video',false,\$tom->id],
            ['call_missed','Voice call','audio',false,\$me->id]] as [\$e,\$l,\$m,\$a,\$who]) {
    \$c->messages()->create(['user_id' => null, 'type' => 'system',
      'system_event' => ['event' => \$e, 'label' => \$l, 'media' => \$m,
        'answered' => \$a, 'initiatorId' => \$who, 'actorName' => 'Tom Ashley']]);
  }
  foreach (['Contract.pdf','Accounts 2025.xlsx','Receipts.zip','Notes.txt','Payroll.csv'] as \$i => \$f) {
    App\Support\Notifications\Notifier::send(['user' => \$me, 'actor' => \$tom,
      'type' => 'file.shared', 'title' => 'Tom Ashley shared '.\$f,
      'message' => 'Shared with you in the File Library',
      'action_url' => '/portal/files', 'dedupe_key' => 'seed-file-'.\$i]);
  }
"

TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/notifications-bulk-calls.mjs
```

  It asserts absolute counts, so re-seed a fresh database between runs — it
  reads, unreads and deletes rows as it goes.

## Calls

- **`calls.mjs`** — the whole calling experience, driven between two real
  users: one places a WebRTC call, the other answers it, and every check after
  that runs against a **live peer connection**. That is the point. Most of what
  this feature promises is only true or false against a real connection —
  that changing layout does not restart the call, that mute survives a mode
  change, that voice→video does not renegotiate — and a mocked call would
  report all three as working no matter what the code did.

  It covers, in order: the incoming video pop-up and its pre-answer self-view;
  the pre-answer camera/microphone toggles and device pickers; answering; the
  large modal and its controls; camera-off showing a face on **both** ends;
  swapping and dragging the small video; compact and Dynamic Island modes;
  minimize returning to the previous mode; Escape minimizing rather than
  hanging up; video→voice and the confirmed voice→video upgrade; ending; an
  incoming voice call and declining it; and the call log the whole run wrote.

  Three things it is built around:

  - **Chromium needs fake devices.** `--use-fake-device-for-media-stream` gives
    a synthetic camera and microphone, and `--use-fake-ui-for-media-stream`
    auto-answers the permission prompt. Without both, `getUserMedia` rejects
    and there is no call to test. (To test the *denied* path instead, drop the
    fake-ui flag, or stub `navigator.mediaDevices.getUserMedia` to reject with
    a `NotAllowedError` via `addInitScript` — a headless browser cannot show
    the real prompt.)
  - **Reverb has to be running**, and the app has to point at it. Signalling is
    the whole call; with no socket the ring never arrives and every check below
    it fails for one reason.
  - **It pins the callee's `callDisplay` preference before calling.** Where an
    answered call lands is a per-account setting, so leaving it to whatever the
    account happens to hold makes the run pass or fail on unrelated state.

  Scope the selectors. Several actions (`swap`, `minimize`, `mute`, `camera`)
  exist in more than one place at once — the scrim carries `minimize`, the small
  video carries its own `swap` — so click `.tma-call__controls [data-call-action="…"]`
  rather than the bare attribute.

  Its last step covers the **nav-bar badges**: a call the caller gives up on
  badges the Calls tab for the person it rang for, opening the tab clears it,
  and it stays cleared across a reload because the marker is server-side. The
  caller's own badge is checked for *movement* rather than for being empty —
  the seed gives that account missed calls of its own.

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= \
  REVERB_HOST=127.0.0.1 REVERB_PORT=8080 REVERB_SCHEME=http \
  php artisan reverb:start --host=127.0.0.1 --port=8080 &

DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= FILES_DISK=local MAIL_MAILER=log \
  BROADCAST_CONNECTION=reverb REVERB_HOST=127.0.0.1 REVERB_PORT=8080 REVERB_SCHEME=http \
  php artisan serve --host=127.0.0.1 --port=8899 --no-reload &

# Two users with one conversation between them — the notifications seed above
# provides exactly that.
TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/calls.mjs
```

Every call now starts through the **"Call &lt;name&gt;?" chooser** — the header
buttons open it and the kind is picked there — so anything that places a call
must click `[data-messages-call="…"]` and then `[data-callask-start="…"]`
(see `startCall()` in `calls.mjs`).

- **`calls-recording.mjs`** — screen sharing and client-call recording against
  a live call, which is the only place either is true or false. A staff↔client
  voice call must arrange a recording server-side, show the consent sentence
  and the REC chip on **both** ends before capture, and — after hangup — land
  in `/call-recordings` as a ready row whose bytes actually stream back. A
  screen share mid-call must arrive at the far end as a live video track
  (replaceTrack on the negotiated sender, no renegotiation), display in the
  video layout with a "sharing screen" label, and stop cleanly. It closes by
  proving the negative spaces: the client account cannot reach the area at
  all, an uninvolved employee sees an empty list, and a staff↔staff call
  records nothing and shows no chip.

  Needs the `calls.mjs` environment (Reverb + fake devices) **plus a Client
  account with a conversation to the staff user** — the messaging seed's
  'Paula Client' — and one extra Chromium flag,
  `--auto-select-desktop-capture-source=Entire screen`, without which
  `getDisplayMedia` waits forever for a picker no headless browser can show:

```sh
TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/calls-recording.mjs
```
