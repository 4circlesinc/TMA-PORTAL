# CIP Portal — Phased Development Plan

> **Status, 17 August 2026.** Phases 1, 2, 3, 4 and 6 are built: an
> application can be created, documented, found, assigned, reviewed and driven
> to Ready to submit, and a colleague's write now reaches every screen without
> a reload. Phase 7 has its number switch and nothing else.
>
> Two pieces of phase 3 are deliberately deferred and are the next work: the
> admin form for the requirement templates (they are seeded, not editable in
> the portal), and the comment thread on a document — the endpoints exist and
> a reviewer's "request changes" note is stored, but there is nowhere to read
> it, so the reason for a send-back is currently invisible to the provider.
>
> Two things wait on the firm: the official document standards per applicant
> type (question 9 — no longer blocking, since the list will be editable in
> the portal), and a running queue worker, without which phase 5 will appear
> to work and deliver nothing.
>
> Live checklist: https://claude.ai/code/artifact/c67a908c-0650-469f-a01e-3ccc4f8a2c40

Derived from "CIP Portal Development Brief v1" (final functional requirements), cross-checked against the existing TMA-PORTAL codebase, then adversarially verified (coverage / ordering / codebase-claims critics). The brief's section numbers are requirement groupings, not build order; this plan re-sequences them into dependency-ordered phases. Every brief section maps to its owning phase in the traceability table at the end.

**Ordering logic in one paragraph:** nothing can exist before the **data model, roles and numbering** (Phase 1). Applications must be **creatable** (Phase 2) before documents can hang off them (Phase 3). People need a **way to find and open applications** (Phase 4) before any workflow is usable. The **notification engine** (Phase 5) must exist before the first workflow phase, because the very first lifecycle transition — submission, DRAFT → NEW — already sends formatted email (§22's worked NEW APPLICATION subject). Then the lifecycle is built in the order an application actually travels: **review** (Phase 6), **submission to the Unit + locking + CIP number** (Phase 7), **post-submission compliance/decision** (Phase 8). Communication (Phase 9), reporting (Phase 10), and the admin console + Smartsheet cutover (Phase 11) sit on top of a working lifecycle.

**Standing decision (from codebase recon):** the existing `/cbi` module is a one-way Smartsheet mirror whose 10-minute sync bulk-upserts ~60 columns — any portal-authored edit to `cbi_applications` is clobbered on the next tick. The CIP portal therefore gets its **own native `cip_*` tables** under a new `/cip` section and `FEATURE_CIP` flag; the mirror keeps running untouched until the Phase 11 cutover, when its ~11,000 historical applications migrate in as the opening caseload. The 64 referral-source companies the CBI importer already registered are the Service Provider firms.

**Merged surface (from the meeting):** "we don't need our Client Service and CBI — we just need one table that pools that information in." For staff there is **one** application-centric main table (the CBI table's shape is explicitly the model: "the CBI thingy is exactly what our main table will be"), and clicking into it opens the **client profile extended with application tabs** — not a separate detail page. The CBI detail page merges into the client detail page piece by piece: the milestone-dates card (Received / Submitted / Decision …) on top below the tabs, the Overview tab, and new Comments and Activity tabs — Documents already exists on the client profile and stays as-is (mapping detailed in 4d). The Phase 2c auto-created client record per applicant is the join that makes this work: application → client → one profile. The Clients hub remains the firm-wide directory underneath (companies, assignments, non-CIP clients), and Service Providers get their own scoped external view (external users can never see the staff hub) — but staff work from one table and land on one profile. `/cbi` and the duplicated CIP listing retire at cutover (Phase 11c).

**Interim-config convention:** `FEATURE_CIP` keeps the whole module dark (for admins too) until launch, so early phases may run on DB-seeded configuration where noted — but any config an earlier phase's *behaviour* depends on gets a minimal admin form in that phase (providers in 1b, document templates in 3a, distribution group in 5b), with the polished console landing in Phase 11.

**Testing convention:** exit criteria run against a seeded test-fixture harness (the browser-test pattern already used portal-wide). The "no dummy data" rule bans mock data in product UI; it does not ban test fixtures. Each phase's exit criteria are limited to what is honestly reachable through product paths *or* explicitly fixture-seeded state by that phase.

**Transcript reconciliation (Aug 2026 meeting):** the raw meeting transcript was checked word-for-word against the brief. It confirms the brief on nearly everything, adds a handful of details the brief dropped (folded into the phases below and collected under "Beyond the brief"), and contradicts it exactly once — dependent numbering (client question 13).

---

## Phase 1 — Foundations: data model, user types, provider registry, numbering
*Brief sections: 1 (user types), 7 (internal numbering), 26 (admin authority groundwork)*

**Goal:** every later phase writes to tables and checks capabilities defined here. Nothing user-visible yet beyond role scaffolding.

### 1a. User types and access model
- The portal has exactly three account types (Client / Employee / Administrator) and no per-user capability grants — so CIP roles are expressed as **grants, not new account types**:
  - **Administrator** — holds everything via the existing admin short-circuit; no ownership restrictions (§26).
  - **CRO / Reviewing Officer** and **Compliance Officer** — stay `Employee`; officer-ness lives in a new per-user grant store (a `cip_officer_roles` table read by a `CipAccess` authority class, patterned on the existing `CompanyAccess`). Capabilities added to `Role::MATRIX`: `cip.view`, `cip.create`, `cip.review`, `cip.compliance`, `cip.assign`, `cip.decide`, `cip.configure`, `cip.report` — one capability per separable thing (documented past pain: a capability gating two things can never be closed for one of them).
  - A **minimal officer-grant form** ships in this phase (grant/revoke CRO / Compliance roles per user) — Phase 6 needs officers to assign; the polished management screen is Phase 11a.
  - **Service Provider contacts** — external accounts (`account_type = Client`) whose identity is a membership row on their provider firm, reusing the company-members machinery (membership-before-login, invitation-activated, per-member ability flags).
  - **Private Clients** — exactly today's client accounts; a CIP application points at their `client_id`/`user_id`.
- **Row scoping is the critical new work**: an `ApplicationScope` cloned from the existing `ClientScope` — officers/admins see all, provider contacts see their firm's applications (`whereIn` on membership subquery), private clients see their own. `findOrFail` answers **404, not 403** (portal-wide convention: existence never leaks).
- `FEATURE_CIP` flag checked *before* the admin short-circuit in `Role::can()` (the proven FEATURE_CBI pattern) so the module stays dark for everyone — including admins — until launch. Push-to-deploy is on; this is what makes building in main safe.
- Invitations: extend the existing invitation system (token hashing, resend rotation, expiry, acceptance screens all come free) with provider-contact and CIP-client payloads.

### 1b. Service Provider registry
- `cip_providers` table: firm name, **provider code** (GAL, PRI, …), contact person, contact email, notification settings, and a nullable link to the existing `companies` row where one exists (the CBI importer already registered ~64 provider firms — Galaxy alone has 8,210 historical applications). PRI is the reserved code for Private Clients.
- Keeping CIP config in `cip_providers` (rather than widening `companies`) avoids leaking provider firms into the client-hub directory listings.
- Ships with a **minimal admin form**: register a provider, set its code, invite a contact — Phase 2 needs real providers with real contacts to create anything.

### 1c. Core data model
- `cip_applications` — provider, created_by, investment type (+ `investment_type_other` free text), status, internal number, CIP number, and the workflow date fields the brief names explicitly: submission date, query received date, accepted-for-processing date, decision date, decision type. Plus `assigned_officer_id` — a **denormalized cache written only by the engine**; see next bullet. Also a nullable **Unit officer/contact** field — the meeting: "internally it would be Dominic, externally Kevin" — who at the government Unit handles the file; the brief dropped it, but the legacy mirror tracks it and staff use it daily.
- `cip_application_assignments` — **the authority on assignment**, modeled on the existing client-assignment shape: officer, role, **ends-rather-than-deletes**, `live()` window. Defined here (Phases 4 and 5 read assignment through one accessor); the assign/reassign *actions* arrive in Phase 6. The existing suspend/archive settlement (`AccessSync`) is extended so suspending an officer ends their live CIP assignments.
- `cip_people` — one row per individual, `role` = main_applicant | sponsor | dependent, with the shared field set (first/last name, gender, DOB, country of birth, country of residence, occupation, passport number) plus dependent-only fields (relationship = spouse | qualified_dependent, computed qualified-dependent ordinal).
- `cip_events` — **append-only** per-application audit (actor, action, from/to, detail, meta, IP), modeled on the existing `file_workflow_events`/`signature_events` tables. This is the durable compliance record. It must be CIP-owned because the portal-wide `activity_logs` table is **hard-pruned by a daily retention job (default 30 days)** — a CIP audit kept only there would silently evaporate. CIP actions are *also* mirrored into `ActivityLogger` (with a `cip` module mapping added) so they appear in the portal-wide activity surfaces.
- Application status enum defined **now, in full** — including the pre-workflow state: **DRAFT**, NEW, REVIEW APPLICATION, ASSESSMENT FEEDBACK, UPDATE REQUIRED, READY TO SUBMIT, PENDING REVIEW, NON-COMPLIANT, BACKGROUND CHECK, DELAYED, GRANTED, DENIED. DRAFT's visibility rules are part of the definition: visible only to the creating provider firm / private client, excluded from every admin/CRO bucket and count. Status class copies the existing file-workflow `Status` shape (consts, TERMINAL set, label(), tone()) — the 5-tone chip vocabulary already maps the whole list (GRANTED→success, DENIED/NON-COMPLIANT→danger, PENDING/DELAYED/BACKGROUND CHECK→pending, NEW/READY→action).
- **The transition engine skeleton (`CipEngine`) is stubbed here too**: FROM→TO map + per-role permission checks + transactional `cip_events` write. No FROM→TO engine exists anywhere in the codebase (existing Status classes are vocabulary only), and both Phase 3 (document-slot edges) and Phase 6 (application edges) route through this one engine — building it once, here, prevents Phase 3 growing throwaway enforcement that Phase 6 rebuilds.

### 1d. Numbering service + display rule
- Internal number format `[Provider Code][YY]-[Sequence]` (GAL26-00001), generated **immediately on creation** (§7) — inside the same transaction as the application insert. No sequence generator exists in the codebase (everything is ULIDs/UUIDs), so this is new: a counters table keyed (provider, year) locked with `SELECT … FOR UPDATE`, never max()+1.
- The internal number is permanent: internal workflows, drafts, invoicing, reviews, assessment feedback — retained forever for audit/invoice tracking even after the CIP number takes over display (§7).
- **`displayNumber()` is defined here, once**: returns the CIP number when set, else the internal number. Every consumer — Phase 4 tables and dashboards, Phase 5 email subjects, Phase 7 status screens, Phase 10 reports, search results — reads this one accessor, so §7's switching rule is a data change, not a UI hunt.

**Exit criteria:** migrations deployed; capabilities resolve per role; officer grant form works; `ApplicationScope` proven by test (provider A cannot fetch provider B's row — 404); parallel-insert test yields gapless GAL26-0000N numbers; `displayNumber()` unit-tested for both regimes.

---

## Phase 2 — Application creation and intake
*Brief sections: 2, 3, 4, 5, 6*

**Goal:** Service Providers and Private Clients create a complete DRAFT application: main applicant, optional sponsor, dependents, auto-created folder tree, internal number visible.

### 2a. Create Application wizard
- All main-applicant fields **required** (§2): first name, last name, gender (Male/Female), date of birth, country of birth, country of residence, occupation, passport number, passport-sized photo, passport bio page upload, birth certificate upload, investment type, sponsored yes/no.
- Investment type (§3): single-select — Real Estate Project / National Action Bonds / National Economic Fund (Donation) / Enterprise Project / Other; choosing **Other reveals a required "Specify Investment Type" free-text field**.
- **The form mirrors the government CIP application form** (meeting: "we wanted to mimic the form they use on CIP so we're getting the exact information we need to submit") — field labels and order follow it; no "type of application" field.
- **Region is derived, never asked** (meeting): the region input is removed — country of residence auto-derives the region from a lookup table (small research task: the country→region mapping).
- Build: fuse the two existing wizard precedents — the signatures wizard stepper (in-SPA step rail, working-copy editing) for chrome, and the onboarding `ClientFlow` pattern (one STEPS definition drives order/validation/conditional steps; answers accumulate in a progress row and commit to real records only on completion) for the engine. The sponsor step `applies()` only when Sponsored = Yes; resumable-draft behaviour comes from the `onboarding_progress` pattern.

### 2b. Sponsor and dependents
- Sponsored = Yes (§4) auto-generates the **sponsor record, sponsor folder, and sponsor document repository** in the same save — not a follow-up step the user can skip. Sponsor form duplicates the main-applicant mandatory field set (no investment-type/sponsored fields).
- Dependents (§5): "Add Dependent" appends a record and **triggers a fresh per-dependent form** (meeting) — first name, last name, DOB, relationship (Spouse | Qualified Dependent). **Qualified Dependent numbering is computed, never typed: sort qualified dependents by age ascending — youngest = Qualified Dependent 1** (§5's worked example). Recompute ordinals on every add/edit/remove; spouses sit outside the numbering. ⚠ The transcript contradicts this once — "the oldest person is always one"; the plan follows the brief's worked example (client question 13).
- The wizard may open family information with a married / has-spouse prompt (meeting), but a spouse is stored as a dependent with relationship Spouse either way.

### 2c. Auto folder structure (§6) — and where it anchors
- On creation, build the tree: `Application → Main Applicant / Sponsor (if applicable) / Dependent 1 / … / Additional Documents` — one dedicated repository per individual. Adding a dependent later adds their folder; the structure is system-managed (no rename/delete by users).
- **Anchor decision:** every application's main applicant gets a lightweight **client record auto-created at application creation** (the same move the CBI importer already makes — one client per applicant via `cbi_applications.client_id`), and the application tree is provisioned under that client's TYPE_CLIENT folder. This covers the majority Service-Provider path (the applicant is not a portal user) and the Private-Client path identically, and it means the firm-wide default org access (every staff member = downloader) never reaches application documents — the TYPE_CLIENT carve-out already excludes them.
- Build on the real file library, not a parallel store — `FolderProvisioner::applySubfolders()` is idempotent and public, the exact primitive needed. Details that matter:
  - Link folders by **new columns/mapping (application_id, person_id), never by name** — client folders auto-rename to follow the client's name; name-keying is a documented trap.
  - Folder ownership goes to the **firm service account** (`FolderProvisioner::systemOwnerId`), not the uploader — `files.owner_id` is cascade-on-delete, and owners hold irrevocable `full` rights that Phase 7's lock must not fight.
  - External visibility is explicit: client accounts get **nothing** automatically in the file library — CIP maintains share grants (or a new FileAccess rule) for the applicant and provider contacts on their application tree.

### 2d. Intake uploads land in document slots from day one
- A **minimal `cip_documents` slot table ships in this phase** (person + document type → file_id) seeded with the three intake requirements — passport-sized photo, passport bio page, birth certificate — so the §2 mandatory uploads are slot-addressed from the first save. Phase 3 generalises slots into the full requirement-template engine; nothing gets re-homed later.
- Bytes go through the existing `Vault` + `Versions` services (see Phase 3b), never a side path.

**Exit criteria:** an SP account creates a sponsored DRAFT with 3 dependents; sponsor repo auto-exists; dependents auto-number youngest-first; folder trees verified for **both** a provider-created and a private-client-created application, each under the auto-created/existing client folder; all 13 mandatory fields enforced server-side; intake uploads addressable as slots; a second provider's account cannot see any of it; internal number visible on the draft.

---

## Phase 3 — Document management engine
*Brief sections: 11, 12, 13 (structure — reviewer interactions go live in Phase 6)*

**Goal:** per-person checklists driven by admin-configurable requirements, uploads with version history, per-document status, comment threads, direct upload links.

### 3a. Configurable requirement templates (§11)
- `cip_document_requirements`: document name, applicant type, mandatory flag, sort order. Applicant types exactly as briefed: **Principal Applicant, Spouse, Dependent Under 16, Dependent 16 and Over, Sponsor**.
- **Content task, not just schema:** obtain the official CIP document standards per applicant type from the client and ship them as the seeded default templates (§11's example names Police Certificate, Medical Certificate, Proof of Address). Empty templates make every checklist meaningless — this is a Phase 3 deliverable and client question #9.
- Each person materialises a checklist from the template matching their type (dependents pick Under-16 vs 16-and-over from DOB — cutoff date is client question #4). Admin-editable via a minimal form here (full console Phase 11). Whether template edits re-materialise checklists on in-flight applications is client question #10 — the brief's "dynamic requirements" doesn't say.

### 3b. Uploads, versions, statuses
- Phase 2's minimal slot table grows into the general engine: `cip_documents` joins (application, person, requirement) → `file_id`. The library has files; the checklist semantics are the genuinely new concept.
- **Version history comes free**: bytes through the existing `Vault` + `Versions` service (`Versions::addStored` appends to the `file_versions` chain; per-version download/preview/restore routes already exist; chunked upload supports "this is version N of file X"). One rule: re-uploads must go through the version endpoints — the library's name-conflict "replace" path soft-deletes and recreates, silently forking the chain.
- Checklist UI shows ✓/☐ with **mandatory indicators** and **upload status** exactly like §11's example.
- **At-a-glance state colours** (meeting): a document with open review comments reads as needs-action (danger tone); a clean/approved one reads settled (success/neutral) — providers must never have to click through documents to find what needs work. Review actions live inline on the application detail page (with an "open in library" affordance), never requiring a trip to the File Library.
- Per-document status machine (§12) held on the slot row, **routed through the Phase 1 `CipEngine`** (not ad-hoc checks): PENDING UPLOAD → APPLICATION REVIEW → UPDATE REQUIRED → READY FOR SUBMISSION, **plus the re-upload back-edge UPDATE REQUIRED → APPLICATION REVIEW** that Phase 6's revision loop requires. The library's existing `review_status` is deliberately any-to-any — wrong vocabulary, wrong rules; not reused. In this phase only the upload-driven edges are exercisable (PENDING UPLOAD → APPLICATION REVIEW, and re-upload back-edges); reviewer verbs arrive in Phase 6.

### 3c. Document comments and direct upload links
- `cip_document_comments`: multiple comments per document (§13), reply-threaded, provider-visible, retained forever — modeled on the existing `file_comments` shape (parent/root threading).
- **Direct upload links** (§11): the tokenized public `/r/{token}` file-request flow already handles expiry, passwords, extension allow-lists, and uploader identity capture — but it targets a *folder* and always creates a *new* file. Extend it with a request→document-slot link and a version-aware landing path so a link upload arrives as the slot's next version. First consumers are the Phase 6–8 notification emails; the lock interaction is defined in Phase 7c.

**Exit criteria:** admin edits a template through the minimal form; a new application materialises correct per-person checklists against the seeded CIP-standard defaults (age split verified); uploading twice produces v1/v2 in one chain; upload-driven slot transitions run through the engine, write `cip_events`, and reject undefined edges; a direct link uploads into exactly one slot as a new version.

---

## Phase 4 — Application directory, search, and role dashboards
*Brief sections: 8, 9, plus §7's search rules*

**Goal:** the working surface. Everyone sees exactly their slice; dashboards are action-driven buckets built once against the complete Phase 1 status enum (DRAFT included), so no rework as later phases light statuses up.

### 4a. Stand up the `/cip` section
- Follow the proven 8-step shell recipe (the CBI module is the model): capability + page slug in `Role`, `SPA_PAGES` entry, sidebar row + hidden view container + script/css tags in the shell, `APPROVED_PRIMARY_NAV` + `NAV_SHELL_VERSION` bump in dashboard.js, `NAV_CAPABILITIES` in **both** copies of portal-access.js (web + desktop), masked nav icon rule, `cip.js` registering its mount, `Route::prefix('portal/cip')` API group.
- `cip.js` copies the `cbi.js` architecture (state object, fetch wrapper with XSRF + monotonic request tokens, TMAMorph rendering, unwired/on wiring) — cbi.js is a pattern donor, not a base to extend.
- **Real paths, not hash routes**: notification emails must carry direct portal links (§10), so `/cip/applications/{uuid}` needs the `clients.deep`-style deep route + explicit routeFromPath entries from day one.
- **This section hosts the merged main table** (standing decision above): it is the successor to *both* the `/cbi` table and the Clients-hub listing as the staff working surface for CIP — not a third sibling. `/cbi`'s nav entry retires at cutover.

### 4b. Main application table (§8)
- Columns exactly as briefed: Application Number (via `displayNumber()`), Applicant Name, Service Provider, Contact Person, Contact Email, Investment Type, Family Size, Status, Assigned To (via the Phase 1 assignment accessor). Toolbar/filters/pagination reuse the documented Users/CBI table recipe; assignee cells reuse the shared person-card component.
- **Assigned To is an inline dropdown** for authorized staff (meeting) — assignment happens right in the table, not only on the detail page (the transition itself is Phase 6's engine edge).
- **Family Size is computed** — main applicant + sponsor (if any) + dependents, displayed "F6" (§8's worked example: 1+1+4=6). One computer, reused by the email subject builder (Phase 5).
- Search (§7): one box matching **Internal Number, CIP Number, or Applicant Name** — all three always hit regardless of which number is displayed.
- Live refresh: register a `cip` resource on both sides of the existing signal-not-payload Live layer (each viewer refetches through their own scoped endpoint, so row scoping survives fan-out for free).

### 4c. Action-driven dashboards (§9)
- **Administrator:** New Applications / Review Applications / Assessment Feedback / Updates Required / Ready to Submit / Pending Review / Background Check / Delayed / Approved / Denied. **CRO:** Assigned Reviews / Reviews Pending / Assessment Feedback Tasks / Additional Information Requests. **Service Provider:** Updates Required / Ready to Submit / Pending Review / Delayed / Approved / Denied.
- Every bucket is a server-measured count clicking through to the pre-filtered table. Pattern: the dashboard-metrics controller pair (role decides scope in the constructor; honest empty states; non-staff gets a soft "not for you" payload, not 403) — but **skip its 5-minute cache** for officer queues; a work queue lagging status changes by 5 minutes reads as broken.
- ⚠ Client question #1: dashboards say "Approved", the decision workflow says "GRANTED" — one bucket, confirm the label.

### 4d. Application detail = the client profile, absorbing the CBI detail page (the merge, part 2)
- Clicking a row does **not** open a new parallel detail page — it lands on the **client profile** (the Phase 2c auto-created client record makes every application resolvable to a profile). The CBI detail page's contents move into it piece by piece — the confirmed mapping:
  - **Dates card** — the card that sits on top, below the tabs, with the milestone dates (Received, Submitted, Decision, …) comes over as-is. For native applications it reads the Phase 1c workflow date fields (submission, query received, accepted for processing, decision); migrated applications carry their legacy timeline.
  - **Overview tab** — the CBI overview moves into the client profile wholesale (applicant summary, investment, people).
  - **Documents tab** — the client profile **already has one; it stays as-is**, gaining the per-person checklists (Phase 3), with dependents listed like company members — each with their folder and an upload/review affordance.
  - **Comments tab** — added from the CBI detail page (migrated `cbi_comments` history included at cutover); Phase 9's thread model becomes its backend.
  - **Activity tab** — added from the CBI detail page, reading `cip_events` (plus migrated `cbi_application_events`).
  - Plus the workflow header (display number, status chip, F-number, assigned officer).
- One detail surface serves Clients-hub navigation and the CIP table alike: "I want to be able to do it from within the person's profile — I don't want to have to go out to another place to assess" (meeting). Everything later phases add hangs off this profile.

**Exit criteria (structural — status reachability arrives with Phases 6–8):** each role sees only their slice; row scoping holds on every list/detail endpoint; internal-number and applicant-name search verified through product data, CIP-number search against a fixture-set number; bucket queries verified against fixture-seeded statuses; detail page renders a Phase 2 application with its intake checklist and event timeline; hard refresh on `/cip/applications/{uuid}` serves the shell (no 404). Bucket/timeline verification through *product paths* is re-asserted in the Phase 6, 7 and 8 exit criteria as each status becomes reachable.

---

## Phase 5 — Notification engine and email standards
*Brief sections: 22, plus the email-content rules embedded in §10, §14, §15, §18, §20*

**Goal:** one notification service every workflow phase calls. Built *before* the workflows because the first transition (submission → NEW, Phase 6) already emails.

### 5a. Subject format builder (§22)
- `[OFFICER INITIALS] - [STATUS] - [APPLICATION NUMBER] - [MAIN APPLICANT NAME] (F[Family Size]) - [DD.MM.YYYY]` — e.g. `KM - NEW APPLICATION - GAL26-00001 - JOHN SMITH (F4) - 12.08.2026`.
- The application number is `displayNumber()` from Phase 1d — the switching rule is already centralised there (the brief's own examples switch at PENDING REVIEW). Family size from the Phase 4 computer; date as DD.MM.YYYY.
- Delivery path: the existing `Postcard` mailable takes an arbitrary subject line — add `Postcards::cipStatus…()` factory methods and send through `Deliveries::send()` with the application as the related record, giving a **per-application email audit trail** (status/error/retry per recipient) in `email_deliveries` for free.
- **Do not route status mail through the Notifier's automatic email twin** — it forces subject = notification title and suppresses email while the recipient is online; both wrong for compliance mail. Raise the bell notification separately with its email channel off.
- **Notification wording comes from the client** (meeting: Krishna pens each scenario's copy) — templates ship as placeholder scaffolds ready to take her text; the NEW APPLICATION body carries applicant name, submission date/time, application number, and the direct portal link (the meeting's suggested content).
- ⚠ Client question #2: NEW APPLICATION fires before an officer is assigned — whose initials lead that subject?

### 5b. Recipient resolution (§22)
- §22 is a blanket rule: **every notification goes to all four classes — CIP Distribution Group + Assigned Officer + Administrators + Service Provider Contact.** One resolver used everywhere. Where later sections name recipients (§20 DELAYED, §18 NON-COMPLIANT), the plan reads them as emphasis on top of §22, **not** narrowing — whether any status should actually trim the list is client question #12, not a silent decision.
- No group-email concept exists in the portal — the distribution group is a stored recipient list on CIP settings, fanned out **per member** so each send gets its own delivery row. A **minimal editor for that list ships in this phase** (compliance mail must not be DB-only-editable for six phases).
- In-portal bell notifications ride the existing per-user notification store (new `cip.*` types registered with their own preference group); external recipients must hold portal accounts to get bells — email is the universal channel.

### 5c. Delivery infrastructure — the operational gate
- Transport is **Microsoft Graph** (portal@ mailbox, app-only send) — already live for invitations and account emails.
- **Verify on the Laravel Cloud dashboard, in this phase: (1) a queue worker is running, (2) `schedule:run` ticks.** Both live outside the repo and both have historically been off — queued mail sat undelivered for weeks (several existing flows send inline specifically to dodge this). Phase 8's DELAYED automation and Phase 9's unread digests depend on the same two switches. Until verified, CIP status mail sends immediate (inline), like the account-lifecycle emails do today.
- Shared jobs-table trap: any new CIP job class must be **deployed before anything dispatches it**, or the Cloud worker pops the job and silently discards it.

**Exit criteria (service-level — first real transition send is Phase 6's exit):** invoking the notification service directly against a fixture application (stubbed status/assignee) produces correct subjects under both numbering regimes; all four recipient classes resolve, including per-member distribution-group fan-out; `email_deliveries` rows land against the application; the distribution-list editor works; worker + scheduler verified ticking (or inline-send fallback consciously adopted and noted).

---

## Phase 6 — Assignment and review workflow (pre-submission lifecycle)
*Brief sections: 10, 12 (transitions), 13 (interactions), 14*

**Goal:** the pre-submission loop: submit → assign → review documents → comment → request updates → provider revises → assessment feedback.

### 6a. Application-level transitions go live
- The Phase 1 `CipEngine` (already carrying Phase 3's document-slot edges) gains its application-level edges: every transition validated against the FROM→TO map **and** the actor's role, wrapped in a transaction, writing `cip_events`, firing Phase 5 notifications. All later phases only add edges.

### 6b. Submit + assignment (§10)
- Provider (or private client) submits a complete draft → **DRAFT → NEW is an engine transition** — it fires the **NEW APPLICATION notification to all four §22 recipient classes** (the brief's first worked subject) and drops the application into the admin "New Applications" bucket. (Whether private clients may submit for processing themselves is client question #11 — §1 grants "submit for processing" only to Service Providers.)
- Admin assigns an officer → assignment row written through `cip_application_assignments`, cache column updated → **REVIEW APPLICATION** → notification to the assigned officer containing application number, applicant name, service provider, **direct portal link** (the Phase 4 deep route). Reassignment allowed any time (§26).

### 6c. Document review (§12, §13)
- Reviewer works the checklists through the engine's reviewer verbs: approve → **READY FOR SUBMISSION**; request changes → **UPDATE REQUIRED** + comment. Providers view comments, **reply**, and **upload revised versions** (new version in the chain; the Phase 3 back-edge returns the slot to APPLICATION REVIEW for re-review).
- Application-level **UPDATE REQUIRED** feeds the SP "Updates Required" bucket whenever any document needs provider action.

### 6d. Assessment feedback (§14)
- All documents assessed → **ASSESSMENT FEEDBACK**. Updates required → SP notified (UPDATE REQUIRED loop). None → application proceeds toward submission (Phase 7). The all-clear branch carries its own copy (meeting): "assessment feedback complete — your file is ready to submit."
- CRO dashboard buckets become live counts.

**Exit criteria:** full loop through product paths — submit (all four recipient classes actually receive the NEW APPLICATION email), assign (officer emailed with working deep link), reject one document with a comment, provider replies + re-uploads, reviewer approves all, application reaches ASSESSMENT FEEDBACK; every step in `cip_events` with actor and from/to; admin buckets NEW → ASSESSMENT FEEDBACK and all four CRO buckets now verified through product data.

---

## Phase 7 — Ready to submit, confirmation, locking, CIP number
*Brief sections: 15, 16, 17, and §7's switching rule*

**Goal:** the hand-off to the government Unit: auto-ready, provider confirmation, immutable package, dual-number switchover.

### 7a. Ready to Submit (§15)
- The moment **all** documents across **all** people reach READY FOR SUBMISSION → application auto-flips **READY TO SUBMIT** (event-driven on every slot status change, not a cron sweep). The **submitting party** — the SP contact, or the private client on PRI applications — is notified and must click **CONFIRM SUBMISSION**.
- On confirm: the application **locks** — the original submission package can no longer be modified.

### 7b. Submission recording + number switch (§16, §7)
- Staff record **Submission Date** and enter the **CIP Application Number** (e.g. `10T1G12661P`) → status **PENDING REVIEW**.
- Because every surface already reads `displayNumber()` (Phase 1d), entering the CIP number flips dashboards, reports, status screens, email subjects and search results in one move. Internal number stays stored and searchable (audit + invoicing).

### 7c. Locking rules (§17) — the part the file library can't do yet
- Original per-person folders: **view only — no editing, no deletion, no replacement** — for providers *and* staff.
- This needs a **new immutability gate** in the file-access layer: today's workflow lock only blocks *new versions* — rename, move, soft-delete and purge all still pass, and the owner/admin short-circuit grants `full` rights that ignore locks entirely. The CIP lock must be checked in the file/folder/bulk controllers **before** the ownership short-circuit. (Phase 2's system-account ownership narrows the blast radius.)
- **Outstanding direct upload links** (Phase 3c) targeting original-package slots are invalidated on lock — the version-aware landing path re-checks the lock, so a link minted pre-lock cannot write into the frozen package.
- **Additional Documents** stays writable for Queries, Non-Compliance Requests, Supplementary Documents, Unit Requests — versioning still enabled.

**Exit criteria:** approving the last document auto-flips status; confirm locks every original slot — server rejects a forced write from the uploader, an admin, the bulk endpoints, **and a pre-lock direct upload link**; entering the CIP number flips every surface including email subjects (the end-to-end switching-rule test lives here); CIP-number search now verified through product data; Additional Documents still accepts versioned uploads.

---

## Phase 8 — Post-submission lifecycle: compliance, background check, delay automation, decision
*Brief sections: 18, 19, 20, 21, 23*

**Goal:** everything after the Unit has the file — Compliance Officer verbs plus the portal's one piece of time-based automation.

### 8a. Non-compliance (§18)
- Unit requests information → officer records **Query Received Date** → auto **NON-COMPLIANT** → notification (full §22 recipient set; the brief highlights the SP) → response documents through Additional Documents (Phase 7c allows this).
- Response documents run the **same review loop** as everything else — APPLICATION REVIEW → UPDATE REQUIRED → READY FOR SUBMISSION ("every document at every stage goes through the same loop" — meeting); additional-information requests reuse the Phase 3c tokenized upload-link flow.
- ⚠ Client question #5: the brief doesn't say which status follows a resolved non-compliance — assume return to the prior status; confirm.

### 8b. Background check (§19)
- Accepted for processing → record **Accepted for Processing Date** → **BACKGROUND CHECK**.

### 8c. Delayed automation (§20)
- Daily scheduled command cloning the existing workflow-maintenance pattern (query non-terminal rows past threshold → transition → log → notify, `withoutOverlapping`): Accepted-for-Processing Date **180+ days old, no decision** → **DELAYED**, notifying at minimum the brief's named three (Administrator + Reviewing Officer + Service Provider; full §22 set unless client question #12 says otherwise). Idempotent — an already-DELAYED application never re-notifies. Depends on the scheduler verified in Phase 5.

### 8d. Decision (§21, §23)
- Record **Decision Date** + **Decision Type** (GRANTED | DENIED) → terminal status → decision notification.
- UI: **one-click date actions** (meeting) — a "Decision received" button opens a date picker; entering the date flips the status automatically. Same pattern for Query Received (8a) and Accepted for Processing (8b): "most status updates are triggered by dates" — the date is the trigger, statuses are never hand-picked.
- **Ten decision templates** (§23): GRANTED and DENIED per investment type (Real Estate Project, National Action Bonds, National Economic Fund, Enterprise Project, Other), admin-configurable. **No admin-editable email template store exists in the portal** (all copy is hardcoded in the Postcards factory) — this needs a new `cip_email_templates` table + placeholder substitution + admin CRUD (minimal editor here, polished in 11a). Preview copies added to the design-mail gallery must be hand-mirrored in the server-side blade — the gallery and real sends are maintained-in-parallel twins.

**Exit criteria:** compliance loop records dates and flips statuses through product paths; time-travel test (accepted date seeded 181 days back, run the command) flips to DELAYED exactly once with the required notifications; a granted Real-Estate application sends the Real-Estate GRANTED template with correct subject; admin Background Check / Delayed / Approved / Denied and SP Delayed / Approved / Denied buckets now verified through product data.

---

## Phase 9 — Application Messaging Centre
*Brief section: 24*

**Goal:** application-scoped communication replacing the email side-channel.

- **Build a light application-scoped thread model — do not bend the chat system.** Recon verdict: the conversations tables are entangled with "free-standing user container" (participant-row auth, one-direct-thread-per-pair, org-chat, calls baggage, a 9k-line UI). The right template is the per-record comment-thread shape (`file_comments`: record FK, parent/root threading) plus mechanisms lifted piecemeal from messaging:
  - **read/unread**: the per-participant high-water-mark columns;
  - **email alerts for unread** (§24): a reminder command cloning the escalating-tier unread-reminder pattern;
  - **realtime**: a `cip.application.{uuid}` private channel whose auth closure checks application access, events broadcast **signal-not-payload** — load-bearing here, because channel members have *different visibility rights* (next bullet) and the event must never carry message text; X-Socket-ID on writes so senders don't process their own echo.
- Two visibility lanes on the message row: **internal** (staff-only — filtered server-side in the read query, never rendered to SP/client accounts) and **provider** (Service Provider communications). Nothing like per-message visibility exists anywhere in the portal; it's new, and it's why threads get their own tables.
- Thread history retained as part of the application record (§24); message bodies plain text (portal-wide rule — formatting belongs to email templates, not stored markup).
- UI: the messaging tab on the application detail page (the file-detail comment pane is the UI precedent, not the Messages app).

**Exit criteria:** internal note invisible to the SP account at the API level; unread badges correct; an unread SP message triggers exactly one alert email; realtime updates arrive without leaking content into the broadcast payload.

---

## Phase 10 — Reporting and analytics
*Brief section: 25*

**Goal:** the §26 "run reports" authority made real — admin reports filterable by **Status, Service Provider, Investment Type, Applicant, Assigned Officer, Submission Date, Decision Date, Date Range**, with the seven briefed examples as presets: Applications Pending Review / in Background Check / Delayed / Granted / Denied / by Service Provider / by Investment Type.

- Extend the existing reports pipeline (report row = request + stored answer; one compute path for page and scheduler; recurring windows; CSV export streaming already built): add CIP report types + a `filters` payload (the current schema has no filter parameters — a small schema addition) + a CIP report builder emitting the generic metrics-plus-breakdown shape the reporting page already renders.
- Query discipline copied from the existing builder: raw query-builder reads that deliberately bypass soft-delete scopes, so withdrawn/binned applications still count in historical reports.
- Reports show `displayNumber()` (CIP numbers post-submission) while staying searchable by internal number for invoicing. Date filters run against the recorded workflow dates from Phase 1c, not status-change timestamps.
- Gated to administrators (§25).

**Exit criteria:** each preset returns correct rows against the accumulated product data plus fixtures; combined filters (provider × investment type × date range) verified; CSV export matches the on-screen result.

---

## Phase 11 — Administration console, audit, and Smartsheet cutover
*Brief sections: 26 and §1 admin abilities, config surfaces from 1a/1b/3a/5b/8d, Purpose (Smartsheet replacement)*

### 11a. Admin console (§26, §1)
- One place for every §26 verb: **view all applications** and **view all users**; **assign/reassign**; **view all role dashboards**; **manage users** — the officer-role grant store (1a) and provider-contact management get their finished screens here; **manage configurations** — document requirement templates (3a), decision templates (8d), provider registry + codes (1b), distribution group (5b), **manage notifications**; **update statuses manually** (with reason, through the engine so it's logged); **override permissions**; **run reports** links to the Phase 10 surface; **access audit history** is 11b. Settings screens clone the existing admin-overlay pattern (one settings row, managed-capability list, the JS mirror test keeps client and server in sync).
- No ownership restrictions on admin accounts — already structural (admin short-circuit).

### 11b. Audit history (§26)
- Per-application audit view over `cip_events` + document version chains + comments + messages + `email_deliveries` rows — the brief's "significantly improving auditability" made visible. (A per-application activity endpoint is new — the portal-wide activity API can't filter by subject.)

### 11c. Smartsheet / legacy CBI cutover (Purpose)
- Migrate the mirror's ~11,000 applications into native CIP records: field mapping from the ~60 mirrored columns (status vocabulary → new enum, officer names → canonical users, investment options → investment types), provider matching through the 64 registered companies, internal-number backfill for historical rows.
- Migration hygiene from recon: surface rather than trust the mirror's heuristic dedupe merges (`needs_review` rows); the historical caseload carries **no contact data** (emails/phones collected fresh as providers onboard); finish the attachment byte-import **on the Cloud server** (23,646 attachments / ~146 GB — infeasible from a laptop); JSON columns read as strings via raw DB, arrays via models.
- Run mirror and portal in parallel read-only for one verification cycle; the comment-dedupe unique index protects against duplication if a final catch-up sync runs during cutover; then pause the sync permanently (the pause switches exist) and point users at `/cip`.
- **The surface merge completes here**: `/cbi`'s nav entry and the duplicated CIP listing are removed — one table remains ("we don't need Client Service and CBI"), and every historical application resolves to a client profile like a native one — dates card, Overview, Comments (migrated `cbi_comments`), and Activity (migrated `cbi_application_events`) all populated.

**Exit criteria:** every §26 bullet demonstrable from an admin login; officer roles and provider contacts manageable end-to-end; a migrated legacy application shows a coherent history and correct provider/status mapping; Smartsheet sync paused with no data gap.

---

## Cross-cutting build rules (every phase)

- **No dummy data in product UI, ever** — loading/empty/error states only (hard project rule; seeded *test* fixtures are the sanctioned verification path).
- Reuse documented components (Users/CBI table recipe, 5-tone status chips, modal/toast kit); never invent styling; UI copy one short sentence max.
- All rendering through the DOM-morph layer with keyed rows (`data-cip-id`) and idempotent wiring; JS-property wiring guards, not data-attributes.
- English UI strings are the i18n dictionary keys verbatim — new visible strings need entries in the three shipped dictionaries; fan-out payloads carry ISO timestamps, browsers format.
- New/changed JS ships in **both** web and desktop asset copies where duplicated (portal-access.js today), and the serve-time bundle must be rebuilt before browser-testing edits to existing files.
- 404-not-403 for everything a viewer isn't allowed to see.
- Feature work lands behind `FEATURE_CIP` — push-to-deploy is on; the flag keeps main shippable mid-build.
- Browser-test harness rides throwaway SQLite — keep queries portable.

## Infrastructure gates (verify once, in Phase 5)

1. Laravel Cloud **queue worker** running (queued mail, document import).
2. Laravel Cloud **scheduler** ticking (DELAYED automation, unread digests, recurring reports).
3. **Reverb** reachable in production (realtime lists + messaging tab; graceful poll fallback exists).

## Traceability: brief section → phase

| Brief § | Requirement | Phase |
|---|---|---|
| Purpose | Smartsheet replacement, lifecycle platform | All; cutover 11c |
| 1 | User types and abilities | 1a (manage users completed 11a) |
| 2 | Application creation, mandatory fields | 2a · intake slots 2d |
| 3 | Investment types + "Other" free text | 2a |
| 4 | Sponsored applications, auto sponsor profile | 2b |
| 5 | Dependents + auto classification | 2b |
| 6 | Auto folder structure | 2c |
| 7 | Numbering + switching + search | 1d (internal + displayNumber) · 7b (CIP entry) · 4b (search) |
| 8 | Main application table, family size | 4b |
| 9 | Action-driven role dashboards | 4c structural · verified through 6–8 |
| 10 | Assignment workflow NEW → REVIEW APPLICATION | 6b (email via 5) |
| 11 | Document management + configurable requirements | 3a–3c (first slots 2d) |
| 12 | Document status workflow | 3b (reviewer edges 6c) |
| 13 | Review comments, replies, revised versions | 3c structure · 6c interactions |
| 14 | Assessment feedback workflow | 6d |
| 15 | Ready to submit + confirm + lock | 7a |
| 16 | Submission record + PENDING REVIEW | 7b |
| 17 | Document locking + Additional Documents | 7c |
| 18 | Non-compliance workflow | 8a |
| 19 | Background check | 8b |
| 20 | Delayed automation (180 days) | 8c |
| 21 | Decision workflow | 8d |
| 22 | Notification standards + subject format | 5a–5c (first live send 6b) |
| 23 | Granted/denied templates per investment type | 8d (console polish 11a) |
| 24 | Application messaging centre | 9 |
| 25 | Reporting | 10 |
| 26 | Administrator permissions | 1a groundwork · 10 (run reports) · 11a–11b |

## Beyond the brief — what the meeting transcript adds

- **Post-approval pipeline is real but unbriefed.** The meeting: after approval "we go into the next set of documents we need… same cycle", and the report example was "all files pending passport". The legacy mirror already tracks these stages (COR submitted/received, NIC letters, passport pads → passport received → originals delivered). The brief stops at GRANTED/DENIED. Full Smartsheet retirement eventually needs them — scope question 14; if confirmed, they extend Phase 8 with more engine edges and the same document loop, no new architecture.
- **Invoicing interface — explicitly deferred in the meeting** ("I'm not gonna push you there yet"): provider-visible invoices with paid/unpaid status, tied to the internal application number. Out of scope for this build; the internal number's invoice linkage (Phase 1d) keeps the door open.
- **The client is running manually today** — all Smartsheet automations are already switched off ("everything's being done manual here right now"). Schedule pressure favours reaching the Phase 6 review loop quickly.

## Questions to send back to the client

1. Dashboards say **"Approved"**, the decision workflow says **"GRANTED"** — same bucket? Which label should users see?
2. Subject lines lead with **officer initials**, but NEW APPLICATION fires before assignment — whose initials on that email?
3. Provider codes (GAL, …): who issues them? Does each provider's sequence reset yearly? Do all Private Clients share one PRI sequence?
4. Age boundary for Under-16 vs 16-and-over document sets — age at application creation or at submission?
5. After a NON-COMPLIANT query is resolved, what status does the application return to?
6. Confirm one sponsor maximum per application.
7. Spouse document set (§11) vs spouse-as-dependent (§5): confirm spouses take the Spouse document set and sit outside Qualified Dependent numbering.
8. CIP Distribution Group — one mailbox/list of addresses? Who maintains it?
9. Please provide the official **CIP document standards** — the required-document list per applicant type (Principal, Spouse, Dependent Under 16, Dependent 16+, Sponsor) — to seed the default checklists.
10. When an admin edits document requirements, do the changes apply to applications **already in progress**, or only new ones?
11. May **Private Clients** submit and confirm their own applications for processing? (§1 grants "submit for processing" to Service Providers only, yet PRI applications exist.)
12. §22 says **all** notifications go to all four recipient classes, while §20 (Delayed) names only three — should any status use a narrower recipient list?
13. Dependent numbering: the brief's worked example makes the **youngest** dependent Qualified Dependent 1, but the meeting transcript says "the oldest person is always one". The plan follows the brief — confirm which rule is right.
14. Post-approval stages (COR, NIC letter, passport tracking — in Smartsheet today, discussed in the meeting): in scope for this build, or a follow-on phase after GRANTED?
