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

**1. The store, and painting from it.** A read-through cache with a memory tier
everywhere and an IndexedDB tier on the desktop, scoped to the signed-in
account. Screens paint from cache immediately and revalidate behind the paint,
so a second visit is instant and a first visit is no slower. Wired into the
client directory, the profile, the application and the folder listings.
*Delivers the "open instantly" ask on its own.*

**2. Sync cursors.** `GET /portal/sync` returning changed records since a
cursor, in pages, for clients / applications / people / folders / files. Built
on `updated_at` plus a monotonic id so a page boundary cannot drop a row.
Deletions are recorded, not inferred from absence — the SharePoint bin taught
us that.

**3. First-run download (desktop).** Walk the cursors to pull everything the
account may see into IndexedDB, resumable, in the background, with progress.
Eleven thousand clients is a large first sync; it must survive a quit.

**4. The offline shell.** The app boots with no network: assets and the shell
cached by the desktop's asset cache, `/me` and capabilities served from the
store. An honest offline banner, and screens that say what is stale.

**5. The write queue.** Mutations recorded locally as intents, applied
optimistically, replayed in order on reconnect. Conflicts detected by version,
not by last-writer-wins; anything that cannot be replayed is surfaced for a
person to resolve rather than dropped.

**6. Document contents (desktop).** File blobs for offline viewing, bounded by
a disk budget and evicted least-recently-used.

## Open questions

- Conflict resolution for two staff editing one applicant. Phase 5 cannot be
  finished without the firm's answer on who wins.
- Disk budget for phase 6.
- Whether a signed-out desktop should retain its cache for the next sign-in by
  the same account, or wipe it.
