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

**2. Sync cursors.** ✅ *Shipped for applications, folders and files.* `GET /portal/cip/applications/sync?since=&after=` returns what has moved
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
tombstone, and a revoked share moves no row. Still to do: clients.

**3. First-run download (desktop).** ◐ *Applications and the File Library.*
`public/js/cip-sync.js` and `public/js/files-sync.js` walk their cursors into
the store on sign-in, on reconnect, and after a queued write lands —
resumable, because cursors are saved per page rather than per run. The
library lands as records (`files:folder:<uuid>` / `files:item:<uuid>`, the
Presenter's own row shape); the listing caches stay the screens' own, and
assembling offline listings from the record layer is what this phase still
owes, along with progress the reader can see. Desktop only: in a browser the
store is memory, so the download would cost the firm's bandwidth to warm
something a reload empties. `tests/Browser/files-replica.mjs` runs the whole
walk against a real store by declaring TMADesktop before boot.

**4. The offline shell.** ◐ *The desktop boots offline; browsers still get
the error page.* Three pieces (16 Aug 2026): `desktop/shell-cache.js` keeps
the last served shell — capabilities inlined — and answers navigations from
disk before the network has said a word, gated on a session cookie, the
deploy build, and `/me` watchdogs for a dead session or a changed account.
The asset cache serves the bundle *unverified* when the portal is
unreachable — offline there is no API to be stale against. And `/me` itself
is remembered (`tma.me` in localStorage, desktop only, cleared by sign-out
and by a server refusal) so the boot knows who it is. Still to do: an honest
offline banner on arrival, and the browser story if the firm ever wants one.

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

**6. Document contents (desktop).** ✗ *Not started.* File blobs for offline
viewing, bounded by a disk budget and evicted least-recently-used.

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
- Disk budget for phase 6.
- Whether a signed-out desktop should retain its cache for the next sign-in by
  the same account, or wipe it. (The write queue already keeps its entries
  across sign-out, scoped to the account that made them: unsent work belongs to
  the person who did it.)
