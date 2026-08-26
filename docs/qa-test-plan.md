# Full application QA / UAT — phase plan

Built 26 Aug 2026 from an audit of the running application, not from a generic
QA template. Every page, route, component, workflow and role below was read out
of the codebase; nothing here is assumed.

**What the audit found**

| | |
|---|---|
| Routes | 584 |
| SPA pages (real URLs, hard-refreshable) | 37 |
| Standalone pages (own layout) | 5 |
| Public / token-addressed surfaces | ~20 |
| Registered SPA views | 12 |
| Account-settings sections | 27 |
| Account types | 5 (+3 external shapes) |
| Capabilities in `Role::MATRIX` | 43 |
| Real-time broadcast events | 17 |

Weight, by shipped JS: Clients 472K · Email 455K · Messages 333K · Files 316K ·
Settings 213K · Admin 195K · Calendar 168K · Feed 165K. The phases are sized
against that, which is why Files and CIP get four phases each and Feed gets one.

---

## How the phases were grouped

Three rules decided the boundaries, in this order.

**1. Dependency before feature.** You cannot test a client's files until the
accounts exist, and you cannot test permissions until you have one account per
role. So identity comes first (Phase 1), the shell that every page hangs off
comes second (Phase 2), and the cross-cutting sweeps that need *everything*
working — permissions, real-time, responsive, performance — come last.

**2. Group what breaks together, not what looks alike.** The File Library is
four phases because browsing, writing, viewing and collaborating fail for
completely different reasons: a listing bug is a query, an upload bug is a
disk, a viewer bug is a codec, a comment bug is a permission. Splitting them by
cause means a failure tells you where to look. Conversely Feed is one phase
even though it has posts, comments and reactions — they share one controller
and one failure mode.

**3. A phase ends where the setup changes.** Anything needing two browser
sessions is in Phase 20. Anything needing a second device is in Phase 21.
Pulling those out keeps the other phases at one window and one login.

---

## The standing checks

Sections 4–17 of the brief apply to **every** phase. Rather than repeat forty
bullets twenty-three times, they are stated once here. Each phase below then
lists only what is *particular* to it.

In every phase, for every page you open:

- **Load** — loading state, flicker, layout shift, missing content or assets,
  console errors, failed or duplicated network requests, correct render after a
  hard refresh, browser back/forward.
- **Top to bottom** — header → breadcrumbs → title → actions → filters → cards
  → tables → widgets → forms → footer. In that order, no jumping.
- **Visual** — typography, colour, spacing, borders, radius, shadow, icon size
  and alignment, component dimensions, and whether it looks like the same
  application as the page before it. Check against `DESIGN_SYSTEM.md`.
- **Every interactive element** — buttons (action, destination, hover, active,
  disabled, loading, label, icon), links (destination, URL, state preserved,
  back button), dropdowns (open, close, click-outside, every option selectable,
  selection actually changes the data, positioning, viewport overflow, keyboard),
  modals (open, content, close, Cancel, Confirm, click-outside, Escape, the
  action actually happening, validation).
- **Every form** — valid, invalid, empty, missing required, wrong format,
  very long values, special characters, duplicates. Then submit and verify what
  was *saved*, not what was displayed.
- **Every table** — columns, alignment, data accuracy, sorting, filtering,
  search, pagination, page size, row actions and every item in every row menu,
  empty state, loading state, error state, long content, large datasets.
- **Every state** — loading, empty, success, error. An error must stay usable
  and offer a retry.

**Severity** for anything found: Critical / High / Medium / Low / Cosmetic.
**Status** per phase: PASS / FAIL / PARTIAL / BLOCKED.

---

## Environment notes that will otherwise cost you an hour

These are real traps in this codebase, learned the hard way. Read before Phase 1.

- **`php artisan serve` runs one PHP worker.** With a remote Postgres, a page
  that makes two requests deadlocks and looks like a JavaScript bug. Use
  `PHP_CLI_SERVER_WORKERS=8`.
- **Always pass `--no-reload`.** Without it the workers drop env overrides and
  silently serve the *production* database.
- **"Stay signed in?" is two forms.** Automation and muscle memory both trip on
  it; click the affirmative one.
- **The sidebar may be in Hover Overlay mode.** It expands over the left strip
  of the page — park the pointer on the right before clicking a toolbar.
- **`Employee` is parked.** An approved account typed `Employee` is redirected
  to `/auth/role-pending` on every portal route. Staff test accounts must be
  `CRO / Reviewing officer`, `Compliance Officer` or `Administrator`.
- **`ImportPause::TARGET_SMARTSHEET` is TRUE and must stay true.** Unpausing
  re-imports ~11k mirror applications over the test dataset.
- **`FEATURE_CIP`** gates the whole CIP module; confirm which way it is set in
  the environment you are testing.

---

## Phase 1 — Authentication and the account lifecycle

*Why first:* every later phase needs accounts, and this phase produces them.

**Covers** `/sign-in`, `/sign-up`, `/forgot-password`, `/setup-new-password`,
`/two-step-verification`, `/auth/stay-signed-in`, `/auth/role-pending`,
`/choose-account-type`, `/onboarding/*`, `/account-info`, `/invite/{token}`,
`/client-invite/{token}`, sign-out, session expiry. 49 `auth/*` routes.

**Particular to this phase**

- Sign in by email, Google and Microsoft. A provider that says "not configured"
  means a missing CLIENT_ID in *that* environment, not a bug.
- Two-step verification: enable, disable, recovery codes, trusted device.
- The approval wall, the verification wall, the profile-completion wall and the
  role-pending wall — each should stop the right account and no other.
- Onboarding wizard end to end, including the calendar-connect step and the
  final "Your account" step.
- Invitation links: fresh, already-used, expired, cancelled, and one issued to
  an email that already has an account. Every resend must rotate the link.
- Sign out from the desktop app and from a second tab.

**Produces:** one test account per role — Administrator, CRO / Reviewing
officer, Compliance Officer, Service Provider Contact, Private Client — kept
for every later phase. Record the credentials somewhere shared.

**~75 minutes.**

---

## Phase 2 — The shell: navigation, header, search, rails

*Why second:* it is on every page. A bug here is 37 bugs.

**Covers** the sidebar (Standard and Hover Overlay), collapse and expand,
every nav item and submenu, badge counts, the mobile menu and bottom tab bar,
the header (search, theme toggle, presence pill, notifications bell, activity,
right-rail toggle), global search, breadcrumbs, page titles, and a hard refresh
of all 37 SPA URLs.

**Particular to this phase**

- Hard-refresh **every** SPA URL. A page missing from `SPA_PAGES` 404s on
  refresh while working fine when clicked.
- Submenu counts: Workflows collapsed shows the tally, expanded shows each
  child. Messages, Email, Calendar and Users carry their own.
- Collapsed rail: labels hidden, tooltips correct, a group icon acts as a link
  to its first page.
- The right rail: Notifications, Activities and Clients sections, each with
  loading, empty, error and forbidden states.
- Global search across people, conversations, messages, files, links.

**~60 minutes.**

---

## Phase 3 — Dashboard and home widgets

**Covers** `/` — KPI tiles, CIP cards, the work tiles (Requests, Comments),
Recent Files, the library widget, notifications and activities panels, the
clients panel, and first paint.

**Particular to this phase**

- First paint: the boot skeleton must not flash, and the dashboard must not
  blank-and-redraw on navigation.
- Each tile against the truth: a KPI that says 12 must match a list of 12.
- Widget vs table agreement — Recent Files in the widget must match
  `/folders/recent`.
- Polling: watch the network panel for a minute and count repeats.

**~45 minutes.**

---

## Phase 4 — File Library: browsing, sections, listings

**Covers** `/folders/all`, `/clients`, `/personal`, `/shared`,
`/shared-with-me`, `/favorites`, `/recent`, `/filebox`, `/recycle` — table and
grid, sort, type and owner facets, pagination, search, breadcrumbs, folder
colours and icons, and the Folder Shortcuts sidebar tab.

**Particular to this phase**

- Each section answers a different question — confirm each shows what its name
  claims and nothing else.
- Recent is ordered by *recency* and mixes folders and files.
- Deep links: `?folder=` and `?file=` must survive a refresh.
- The Clients root is view-only; files belong in a client folder beneath it.

**~60 minutes.**

---

## Phase 5 — File Library: file and folder operations

*Why separate from Phase 4:* reading is a query, writing is a disk, a lock and
a permission. They fail independently.

**Covers** upload (single, multiple, drag-and-drop, chunked, large), new
folder, inline rename, move, copy, delete, restore, purge, download, folder
ZIP, favourites, the global upload panel, conflict handling (replace, keep
both, rename), and the offline write queue.

**Particular to this phase**

- Upload into every destination the account is allowed, and confirm the ones it
  is not are refused by the **server**, not merely hidden.
- Interrupt an upload. Resume it. Reload mid-upload.
- Drag a file onto a folder row, and onto the window.
- Recycle bin: restore returns it to the right parent; purge is final.

**~60 minutes.**

---

## Phase 6 — File Library: the viewer

**Covers** the lightbox and the collaboration viewer for every category —
image, PDF, video, audio, text, Office, and the no-preview card — plus zoom,
the page rail, the PDF toolbar, the filmstrip, prev/next, download, print.

**Particular to this phase**

- One file of each type. PDFs specifically: multi-page, large (20 MB+), and
  one that is not really a PDF.
- Test in the **desktop app** as well as the browser. The two have diverged
  before over the engine version.
- Video seeking, audio scrubbing, image zoom.
- Close and reopen: no leaked workers, no stuck scroll position.

**~60 minutes.**

---

## Phase 7 — File collaboration: comments, versions, review, sharing

**Covers** comments and @mentions, resolve and reopen, read/unread state,
versions (upload new, restore, download old), review status, approval requests
(send, respond, cancel, delegate), the access panel, presence, share links,
file requests `/r/{token}`, public shares `/s/{token}`.

**Particular to this phase**

- A mention must not reach someone who cannot open the file.
- Read state: unread indicators clear when read and come back on a new reply.
- Approvals pin to the version they were sent on.
- `/r/{token}` and `/s/{token}` in a **logged-out** browser, plus expired,
  used, password-protected and revoked variants.

**~75 minutes.**

---

## Phase 8 — Workflows hub

**Covers** `/workflows` (Requests) and `/workflows/feedback` (Feedback and
Comments) — tabs and scopes, counts, read/unread cards, respond, cancel,
delegate, reply, resolve, search, filters, paging, and the links back to files.

**Particular to this phase**

- The sidebar badge must agree with the tabs, and both must fall as you read.
- Opening a card, replying and resolving each mark it read; merely listing does
  not.
- The firm-wide tab is staff-only and the server must refuse the scope.

**~45 minutes.**

---

## Phase 9 — CIP: applications table and intake

**Covers** `/clients` (CIP Applications) — the table, its columns, sorting,
Status / Assigned to / Service provider filters, search, pagination, the count,
bucket tabs, row menus — and the Create New Application wizard end to end.

**Particular to this phase**

- Intake: main applicant, sponsor (including sponsor-is-applicant), dependants,
  the three intake uploads, and the numbering that comes out (`GAL26-00001`).
- Offline: fill the wizard with the network cut, then restore it.
- As a **Service Provider Contact**: no provider filter, no dropdown on the
  create button, and only their own firm's applications.

**~60 minutes.**

---

## Phase 10 — CIP: the application profile and document checklists

**Covers** the profile tabs — Overview, Main applicant, Documents, Assigned,
Messages, Portal access, Activity — the milestone card, per-person document
checklists, slot statuses, uploads into slots, and the Client documents panel.

**Particular to this phase**

- Every checklist line: filed vs pending, optional vs required, the open-file
  link, and the status chip's colour matching its meaning.
- Re-upload against a filled slot, and the back-edge it triggers.
- The document indicators — dot on the tab, chip on the folder, chip on the file
  — must agree with each other and with the file's own viewer.

**~75 minutes.**

---

## Phase 11 — CIP: lifecycle, decisions and notices

*Why separate:* it is a state machine, and it is tested by driving it, not by
looking at a page.

**Covers** every transition across the twelve statuses — `draft`, `new`,
`review_application`, `assessment_feedback`, `update_required`,
`ready_to_submit`, `pending_review`, `non_compliant`, `background_check`,
`delayed`, `granted`, `denied` — plus locking on submission, the CIP-number
switch, decision letters, notices and the emails each transition fires.

**Particular to this phase**

- Drive one application the whole way through, then a second down the
  non-compliant path and a third to denied.
- Locking: after submission the file is immutable — confirm the server refuses,
  not just that buttons vanish. Pre-lock upload links must stop working.
- The number-switch rule: internal number before submission, CIP number after.
- Each email: does it send, to whom, with what subject, and does it look right.

**~75 minutes.**

---

## Phase 12 — Client hub, companies and People

**Covers** the clients directory at scale, client profiles, companies /
service providers, company contacts and members, staff assignments, and all
eight People screens — employees, clients, prospects, shared and personal
address books, distribution groups, resend welcome emails.

**Particular to this phase**

- The directory holds ~11k rows: paging, the stated total, facet counts, select-all
  across a page turn, and sideways scrolling inside its own container.
- Assignment: assign, reassign, end. An ended assignment is not a deleted one.
- Company-level access and what a contact inherits from it.

**~60 minutes.**

---

## Phase 13 — Mailbox

**Covers** `/email` — connect Gmail and Microsoft, folder list, conversation
list, thread rendering, compose, reply, reply-all, forward, attachments,
inline images, signatures, templates, search, labels, archive, spam, delete,
sync status. 29 `portal/mail` routes.

**Particular to this phase**

- Send a real message to yourself and read it back. Inline images must survive.
- A mailbox with thousands of messages: paging, the backfill cursor, warm start.
- Disconnect and reconnect; a restricted-scope grant must say so honestly.

**~60 minutes.**

---

## Phase 14 — Messages and calls

**Covers** `/social/messages` — direct and group conversations, attachments,
reactions, stars, replies, typing indicators, read receipts, search, and the
call stack: audio, video, screen share, the floating window, and recordings.

**Particular to this phase**

- Two accounts, two windows. Send, react, delete, edit; both sides update.
- A call end to end, including declining, missing, and recording.
- Swipe and in-bubble clicks on touch.

**~60 minutes.**

---

## Phase 15 — Calendar

**Covers** `/calendar` — month, week and day views, event create/edit/delete,
recurrence, invitations and responses, sharing, calendar members vs
subscriptions, Google and Microsoft sync, availability and work plan, ICS.
41 `portal/calendar` routes.

**Particular to this phase**

- A recurring series: edit one occurrence, then the series.
- Sync in both directions, and what a sync failure looks like to the user.
- Times in the reader's own zone.

**~60 minutes.**

---

## Phase 16 — Feed

**Covers** `/social/feed` — channels, create/archive, posts, attachments,
comments, replies, reactions, moderation, analytics. 49 `portal/feed` routes.

**~45 minutes.**

---

## Phase 17 — Signatures

**Covers** `/signatures` — request creation, recipients, field placement on the
rendered PDF, sending, reminders, expiry, the public signing page
`/sign/{token}`, and the stamped output.

**Particular to this phase**

- Sign as a recipient in a **separate browser context** with no portal session.
- A used link must be dead, and the portal unreachable from that session.
- Verify the stored signed PDF actually carries the signature where it was
  placed.

**~60 minutes.**

---

## Phase 18 — Users, invitations and account settings

**Covers** `/users`, `/users/new`, the invitations surface, and all 27
account-settings sections: profile, theme, time, notifications, alerts,
privacy, account and device security, sign-in policy, security policy and
insights, connectors, OneDrive, email, storage usage, default folders, folder
templates, branding, permissions, background operations, notification history,
client-hub access, service teams, custom fields, CIP documents, CIP letters.

**Particular to this phase**

- Every settings toggle: change it, reload, confirm it stuck, and confirm it
  actually changes behaviour.
- Users: invite, approve, deny, suspend, retype an account, resend, cancel.
- The settings rail itself is capability-gated — check it as each role.

**~75 minutes.** Split into 18a (Users and invitations) and 18b (Settings) if
that runs long.

---

## Phase 19 — Reporting and storage

**Covers** `/reporting`, report filters and exports, and Storage Usage.

**Particular to this phase**

- Export and open the file. The numbers in it must match the screen.
- Storage figures come from five tables — spot-check one against reality.

**~45 minutes.**

---

## Phase 20 — Permissions and data isolation

*Why late:* it needs every feature working and one account per role.

**For each of the five roles**, walk: dashboard, navigation, every page,
buttons, forms, data visibility, actions, applications, files, reports,
settings, user management, approvals, assignments, editing, deleting,
exporting.

**Then attack it**

- Sign in as A, find a resource owned by B, and try to open, modify and delete
  it by direct URL and by direct API call.
- Type restricted URLs straight into the address bar.
- Confirm the CIP module answers **404, not 403**, outside your scope — a 403
  admits the thing exists.
- A hidden button is not security. Every check must hold at the API.

**~90 minutes.** This is the one phase worth over-running.

---

## Phase 21 — Real-time

**Covers** all 17 broadcast events: messages sent, edited, deleted, reacted,
read, delivered; typing; presence and user status; call signals; feed posts;
file comments, details and presence; notifications; portal data changes.

**Method:** two windows, two accounts. Act in one, watch the other. Nothing
should need a manual refresh unless that is deliberate.

**~45 minutes.**

---

## Phase 22 — Responsive and cross-environment

**Covers** every major page at desktop, laptop, tablet and mobile; Chrome,
Safari, Firefox and Edge; the macOS and Windows desktop apps; and the Docker
stack.

**Look for** horizontal scrolling, overlap, cut-off content, broken tables,
buttons outside the viewport, broken navigation, text wrapping.

**~75 minutes.**

---

## Phase 23 — Performance and console hygiene

**Covers** page load, navigation, API response times, search, filters, table
rendering, file loading, dashboard render, WebSocket behaviour, memory.

**Method:** the network and performance panels, on the ten heaviest pages.
Count duplicate requests. Watch memory across ten minutes of navigation.

**~60 minutes.**

---

## Phase 24 — Final regression

After every phase has passed and every fix has landed: navigation,
authentication, dashboard, users, files, applications, forms, permissions,
notifications, settings, the core workflows, responsive behaviour and
real-time — once more, quickly, looking only for what the fixes broke.

**~60 minutes.**

---

## Coverage check

Every SPA page, standalone page and public surface is assigned:

| Area | Phase |
|---|---|
| `/sign-in` `/sign-up` `/forgot-password` `/setup-new-password` `/two-step-verification` `/auth/*` `/onboarding/*` `/choose-account-type` `/account-info` `/invite/{token}` `/client-invite/{token}` | 1 |
| Shell, all 37 SPA URLs hard-refreshed, global search | 2 |
| `/` | 3 |
| `/folders/*` (9 sections) | 4, 5, 6, 7 |
| `/r/{token}` `/s/{token}` | 7 |
| `/workflows` `/workflows/feedback` | 8 |
| `/clients` (CIP applications), intake wizard | 9, 10, 11 |
| `/people/*` (8), `/portal/companies`, client profiles | 12 |
| `/email` `/email/templates` | 13 |
| `/social/messages`, `/call-recordings` | 14 |
| `/calendar` | 15 |
| `/social/feed` | 16 |
| `/signatures` `/sign/{token}` | 17 |
| `/users` `/users/new` `/settings` `/settings/change-email` `/account-settings` `/account` (27 sections) | 18 |
| `/reporting`, storage usage | 19 |
| `/cbi`, `/classic`, `/templates`, `/projects`, `/billing-details` | see below |
| `/privacy-policy` `/terms-of-service` | 2 (linked from the shell) |

**Not assigned, deliberately — confirm before starting:**

- `/cbi` — the Smartsheet mirror. The CIP module supersedes it and the plan
  records that `/cbi` is removed at cutover. Test it only if it is still live.
- `/classic` — the old design shell.
- `/templates`, `/projects` — being removed from the nav as of this week.
- `/billing-details` — invoicing was explicitly deferred.
- `/design/*`, `/demo/*` — internal previews, not product.

If any of those five *is* in scope, say so and it gets a phase.

---

## Running order

```
Audit (done) → Phase 1 … Phase 19  (feature phases, sequential)
             → Phase 20 … 23       (cross-cutting sweeps)
             → Phase 24            (regression)
```

Within a phase: test → find → document → fix → retest → pass → next. A phase
with a Critical or High open against it does not pass, and the next phase does
not start.
