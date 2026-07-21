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
- **`mailbox.mjs`** — the email page is server-backed, not the old hard-coded
  `INBOX` array: the list loads from `/portal/mail`, opening a message marks it
  read, starring round-trips, folder badges come from the server, and Email
  settings opens *over* the page instead of navigating to `/settings`. It also
  pins the failure case that matters — a dead OAuth grant degrades to a
  reconnect banner over an intact list rather than blanking the mailbox. Needs
  a user with a connected account row (see the mailbox fixture below).
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
      'to' => [['name' => 'Test User', 'email' => 'e2e@example.com']],
      'is_read' => true, 'sent_at' => \$when]);
  }
"

node tests/Browser/mail-thread.mjs
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
`/portal/messaging`, so these three scripts exist to keep it that way.

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

Seed all three with several conversations, one of them deep enough to page:

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
"

node tests/Browser/messaging.mjs
```

`messaging-realtime.mjs` additionally needs Reverb up, and the app server has to
point at it:

```sh
DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan reverb:start --host=127.0.0.1 --port=8080 &

DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= FILES_DISK=local MAIL_MAILER=log \
  REVERB_HOST=127.0.0.1 REVERB_PORT=8080 REVERB_SCHEME=http PHP_CLI_SERVER_WORKERS=12 \
  php artisan serve --host=127.0.0.1 --port=8899 &

node tests/Browser/messaging-realtime.mjs
```

Without Reverb running the realtime script fails at the "socket is connected"
check — which is the point, it's testing the socket, not a fallback. The app
itself degrades quietly in that case: sends still succeed and are stored, they
just don't arrive until the next load (see `App\Support\Messaging\Broadcaster`).

Address conversations **by name, not by list position**. Sending reorders the
list, so `.first()` is not a stable handle on a conversation — an earlier
version of the draft checks failed for exactly that reason.
