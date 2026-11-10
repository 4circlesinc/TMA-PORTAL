# Offline portal — phase plan

Decided 16 Aug 2026 with the firm:

- **Full offline read and write.** Browse, edit, upload and change status with
  no network; changes queue and sync on reconnect.
- **Everything the account can see** is downloaded, not just what was opened.
- **Cached client data lives on the desktop app only.** Browsers get an
  in-memory cache for speed, cleared on sign-out — the firm's client book does
  not get written to the disk of a shared or personal browser.

That last decision splits the work in two. Every phase below has a *speed* half
that ships everywhere and an *offline* half that is desktop-only.

## Where the two seconds went

Nothing is cached. Opening a folder in a client's Documents tab issues a fresh
`GET /portal/files/?folder=…` and paints nothing until it answers. Locally that
is 60ms; against Cloud Postgres through one PHP worker it is the two seconds the
firm sees. Every screen in the portal works this way, so this is not a folder
problem.

## Phases

**1. The store, and painting from it.** ✅ *Shipped.* A read-through cache with
a memory tier everywhere and an IndexedDB tier on the desktop, scoped to the
signed-in account. Screens paint from cache immediately and revalidate behind
the paint, so a second visit is instant and a first visit is no slower. Wired
into the client directory, the profile, the application, the client
Documents tab — and (16 Aug) the whole File Library: `load()` in
portal-files.js runs plain listings through `swr`, and every write
invalidates through the one seam all File Library writes share,
`TMAFilesNet.fetchJSON` (uploads included — completion posts there too).
Searches and filtered views are deliberately not cached. The client
directory and companies follow the same pattern (`clients:directory` /
`clients:companies`, invalidated at the clientsFetch seam, refreshed into the
store by the Live handler — a colleague's write invalidates nothing in this
tab, so the signal's answer must be written back). The store adopts entries
written before /me answers (`claimAnonymous`): the directory is exactly the
kind of fetch that beats the account, and an orphaned `anon::` entry is a
miss that costs the biggest first paint. *Delivers the "open instantly" ask
on its own.* `public/js/portal-store.js`;
`tests/Browser/files-cached-listing.mjs` and
`tests/Browser/clients-cached-directory.mjs` prove the offline paint by
cutting the network.

**2. Sync cursors.** ✅ *Shipped: applications, folders, files and clients.* `GET /portal/cip/applications/sync?since=&after=` returns what has moved
since a cursor, in pages of 50. The cursor is `updated_at` **and** the row id,
so two records saved in the same second cannot straddle a page boundary and
lose one — `CipApplicationSyncTest` pins exactly that case. `CipPerson` and
`CipDocument` carry `$touches = ['application']`, because most edits change a
person and not the application row, and a cursor that missed those would leave
a laptop quietly wrong. The File Library's cursor
(`GET /portal/files/sync`, `FilesSyncTest`) extends the shape: folders and
files page side by side on independent cursors, `SyncScope` answers
"everything the account may see" — the containment closure the FileAccess id
lists alone never gave (a file inside a shared folder's subtree) — and both
models soft-delete, so a deletion arrives as a tombstone row, never an
absence. Both cursors use an INCLUSIVE id tie-break: the boundary row is
re-delivered so a second change inside the same instant (delete then
restore) can never be skipped for ever; an upsert absorbs the repeat. Two
honest limits, settled by a fresh full walk: a purged bin row leaves no
tombstone, and a revoked share moves no row. The clients cursor
(`GET /portal/clients/sync`, `ClientsSyncTest`) completes the set, carrying
FULL records (`toRecord`) rather than the directory's lean rows — the replica
exists so a profile can open offline for a client nobody clicked before.

**3. First-run download (desktop).** ✅ *Shipped.* One walker
(`portal-replica.js` — the walk written once, configured three times) pulls
all three cursors into the store on sign-in, reconnect, and after a queued
write lands; cursors save per page, so a closed lid costs the pages that were
left, never the ones that landed. What makes the replica *usable*:
`portal-files.js` assembles offline listings from the records
(`TMAStore.list`) when the network cannot answer — folder browsing, All
Files and Personal; Shared/Recent/Favourites encode questions the rows alone
cannot answer, and a wrong listing offline is worse than a plain refusal.
The client hub falls back to `clients:record:<uid>` for a profile the server
never answered. Progress is the sync pill: every page announces
`tma:replica-progress`, and portal-sync-status shows "Syncing for offline —
N records" with a neutral dot (activity, not a warning). Desktop only
throughout; `tests/Browser/files-replica.mjs` drives all of it — walk,
assembly offline, client profile, progress — against a real IndexedDB store.

**4. The offline shell.** ◐ *The desktop boots offline — and (16 Aug,
evening) boots WARM: the dashboard's five tiles snapshot themselves into the
store after every load (`home:*` keys) and hydrate at script boot, /me
paints from its remembered copy before the network answers, and avatars
joined the desktop byte cache — so a quit-and-reopen shows the board exactly
as it was, data refreshing silently behind, no skeletons
(`tests/Browser/warm-home.mjs` proves it by killing every data endpoint).
Browsers still get the error page on a no-network reload. Warm boot then
went portal-wide (16 Aug, late): Messages' conversation list, the Feed's
first page, Overview's panels (road and work plan only onto the day they
were kept for), the Calendar grid, every People feed at its one load() seam,
and the mailbox — whose existing sessionStorage warm start now writes
through the store and re-seeds itself across a quit. Every screen keys its
hydration on "the server answered" (`real`), never on "something finished":
a dead network marks tiles loaded-empty to bring the skeleton down, and a
guard on loaded throws the snapshot away — the race warm-screens.mjs exists
to catch. And everywhere, stale rows beat an error card.* Three pieces (16 Aug 2026): `desktop/shell-cache.js` keeps
the last served shell — capabilities inlined — and answers navigations from
disk before the network has said a word, gated on a session cookie, the
deploy build, and `/me` watchdogs for a dead session or a changed account.
The asset cache serves the bundle *unverified* when the portal is
unreachable — offline there is no API to be stale against. And `/me` itself
is remembered (`tma.me` in localStorage, desktop only, cleared by sign-out
and by a server refusal) so the boot knows who it is. (21 Aug) The arrival case is finished. Three things
were wrong and are now right. A navigation whose first segment had never been
captured fell through to the network even with a perfectly good shell on disk;
offline it now answers from that shell and lets the SPA router take the path,
while the prefixes that are not the SPA (`/auth/*`, `/r/*`, `/design/*`) stay
refused with or without a network. The handler's stand-in for "no answer at
all" was an anonymous 502, indistinguishable from the portal itself returning
one, so a reader in a tunnel was told the server was restarting; it now carries
`x-tma-offline` and the two cases have separate screens. And the screen itself
is no longer an error: no URL, no `net::ERR` code, no red — one sentence saying
the portal will come back on its own, which it does, on the `online` event and
a five-second poll. `desktop/test-offline-boot.js` drives the serve path with
`net.fetch` stubbed to fail the way a dead network fails;
`desktop/test-offline-screen.js` renders the real screen and asserts a reader
never sees a URL or an error code. Still to do: the browser story, if the firm
ever wants one.

**5. The write queue.** ✅ *Shipped, for applications.*
`public/js/portal-queue.js`. A save that cannot be *delivered* — a rejected
fetch, not a status code — is recorded as an intent with its files as Blobs,
applied optimistically, and replayed oldest-first when the connection returns.
On disk in a browser as well as the desktop, unlike the read cache: the store
holds a copy of something the server already has, this holds the only copy of
work a person did. Anything the server refuses on its merits is parked as
`failed` and shown in the sync indicator (`portal-sync-status.js`) with Try
again / Discard — the queue never throws work away by itself. Still to do:
conflict detection by version (see the open question below), and the other
modules' writes.

**6. Document contents (desktop).** ✅ *Shipped.* `desktop/file-cache.js`,
wired into the protocol handler — the one place every `<img src>` /
`<iframe src>` / `<video src>` load passes through, so no portal change was
needed and browser disks stay clean. Previews and thumbs are kept on view
(cache-on-access, which is what LRU means), bounded (512 MB placeholder —
the budget open question below still stands), least-recently-USED evicted.
Network first always: the cache answers only when the network could not; a
real answer, a 404 included, stands. Cleared on sign-out/account change,
kept across deploys. What it deliberately is not: a proactive download of
every byte the account may see — that is a different decision with a real
disk bill, and the firm has not made it.

**7. Messages (all four apps).** ✅ *Shipped 8 Nov 2026.* An opened
conversation's newest 100 messages are kept in TMAStore (`messages:thread:*`:
on disk in the apps, in the tab in a browser), so it opens at once and with
no connection, and only what is new is fetched behind it. A conversation
opened by its link with no answer from the server (a notification, a reopened
app) opens from its kept row and messages. A message written with no
connection goes into the write queue with its nonce, says "Waiting to send",
and is redrawn from the queue across a restart; it sends on its own when the
connection is back, and the server's nonce makes a replay land once (the
lost-answer case included). Unlike a filing, a message is never parked for
failing to reach the server: it keeps trying, further apart each time, until
delivered or refused on its merits. `tests/Browser/messaging-offline.mjs`
drives all of it, as an installed app and (`TMA_AS_BROWSER=1`) as a browser.

**8. Reopen like WhatsApp (all four apps).** ✅ *Shipped 10 Nov 2026.*
Closed and opened again with no connection, the app shows every section as
it was left, in one go: no skeleton, no "Could not load". What stood in the
way was not missing data, it was on disk, but four ways of not finding it:
the store did not know the account in the apps until /me answered (it now
knows from the shell or the remembered /me at once); `swr`, and Messages,
the rail and the Calendar, threw the kept copy away when a dead network
failed before the disk answered (they now wait for it); the rail, Settings
and a client's profile were never kept at all (now `notify:*`,
`rail:applications`, `settings:get:*` (never the two-factor secrets),
`clients:profile:*`); and a thread was kept only after its second message
arrived. In the apps the store now reads every screen's copy into memory as
it starts (not the first-run download's per-record rows), the first screen
waits for that (300 ms at most) so it paints whole, the shell's boot
skeleton is hidden when somebody is remembered, and a list skeleton shows
only for a wait of a quarter of a second or more. Messages also keeps the
newest page of the fifteen most recent chats, so a chat never opened while
connected is there too. No connection is said in words, never "Failed to
fetch". `tests/Browser/warm-app.mjs` proves it section by section.

**9. Everything a person reads, on the device (all four apps).** ✅ *Shipped
10 Nov 2026.* Not only what was opened: `offline-download.js` keeps, a
little after the app opens and every half hour, the conversation list and
the newest page of the 50 most recent chats, the inbox's first pages and
its 40 newest conversations with their bodies (`email-api.js` keeps every
message, conversation and folder page the mailbox answers, and answers from
that copy when nothing else does), and the profile and security settings.
The first copy on a device, and one after a week away, shows as a card
beside the email sync ("Downloading for offline…", "Ready offline"); every
other run is silent. People's pictures are kept as they load
(`offline-pictures.js`, the Cache API, 600 at most) and put back offline in
place of initials. The CIP tab counts are kept apart from any one page, so
an offline table never shows empty badges. A profile picture chosen offline
waits in the write queue and shows at once. Files stay as before: kept when
opened. Bounded throughout, so a phone is not filled; apps only, by the
firm's disk decision.

**10. Everything, once, and the files on every device.** ✅ *Shipped 10 Nov
2026.* `offline-fetch.js` sits under every screen in the apps: each JSON
answer the firm gives is kept (`http:<path?query>`), and a read that gets no
answer at all is given the kept one, so the Feed, Calendar, Signatures,
Reporting, every Settings page and every tab work offline once seen, with no
per-screen code. `offline-download.js` now fetches every conversation, the
newest 500 emails with their bodies, every Settings page, everything already
kept (refreshed), and the newest documents' bytes up to 2.2 GB. Its progress
is the dashboard's first section, above the greeting. Kept data is good for
30 days. Files, by platform: the desktop's `file-cache.js` (budget raised to
2.5 GB, the firm's answer to the phase 6 question); the iPhone's
`FileStore.swift` (Application Support, encrypted by the phone, out of iCloud
backups, served to the page as `tma-file://kept/<path>`); Android's
`FileStore.kt` (the app's private files, answered in shouldInterceptRequest
like the desktop). All three wiped at sign-out.

## What offline applications do and do not do today

Works: opening an application that has been opened before, editing it with no
network, seeing the edit on the profile immediately marked "Saved on this
device", and having it sync on its own when the connection returns.
`tests/Browser/cip-offline.mjs` drives the whole round trip.

Does not work yet, and each is a phase above rather than a bug:

- **Filing a *new* application offline** queues the write, but the hub cannot
  show the applicant until it lands — there is no client record to show, and
  inventing one means merging it into every listing and deduplicating it after
  the sync (phase 3).
- **Reloading with no connection** works on the desktop now (phase 4's shell
  cache); in a browser it is still the error page, by the firm's own
  disk-residue decision.
- **An application never opened while online** cannot be edited offline in a
  browser, only on the desktop. That is the firm's decision about whose disk
  holds a client's details, not an oversight.
- **A document uploaded offline** is queued with the rest of the form, but the
  checklist does not tick until it is on the server — telling a reader a
  requirement is answered while the firm cannot see the scan would be worse
  than making them wait.

## Open questions

- Conflict resolution for two staff editing one applicant. The queue replays
  last-writer-wins today, which is the honest state of it — finishing phase 5
  needs the firm's answer on who should win.
- ~~Disk budget for phase 6.~~ 2.5 GB per device (10 Nov 2026).
- Whether a signed-out desktop should retain its cache for the next sign-in by
  the same account, or wipe it. (The write queue already keeps its entries
  across sign-out, scoped to the account that made them: unsent work belongs to
  the person who did it.)
