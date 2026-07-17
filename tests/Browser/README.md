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
- **`file-library.mjs`** — the client/organization folder wiring: an assigned
  client folder and an all-staff organization folder appear as labelled groups
  ("Assigned Clients", "Organization Folders") in the Folder Shortcuts tab, and
  the client profile's "Open folder" action lands in the File Library. Needs an
  administrator account.
- **`client-folder-tab.mjs`** — the client profile's Folders tab as a live file
  area: it lists the client folder's real subfolders, the "New folder" button
  creates one, and "Upload" adds a file that appears in the list. Needs an
  administrator account. **Serve with several workers**
  (`PHP_CLI_SERVER_WORKERS=12 php artisan serve`) — the single-threaded dev
  server drops API calls while the asset-heavy SPA is still loading, which reads
  as a hang, not a bug.

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
  php artisan serve --host=127.0.0.1 --port=8899 &

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

Only `/` serves the portal shell; deep paths like `/folders/all` exist purely
as pushState URLs and 404 on a hard load. Reach the file library by clicking
through the sidebar, as `openLibrary()` in the script does.

These send real mail, so keep `MAIL_MAILER=log`. Each assumes an empty
signatures list — re-seed between runs.

Use `php artisan serve` rather than a bare `php -S`: the built-in server hands
every request to `index.php` without Laravel's dev router, so `/js/vendor/*`
never gets served and pdf.js fails to import.

The script prints each step, writes `editor-fields.png` / `editor.png` beside
itself, and exits non-zero on failure.
