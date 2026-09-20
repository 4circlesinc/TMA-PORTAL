# Security hardening pass — September 2026

What changed, why, and what is still open. This is a record of one pass over
an application that already had most of its controls in place; it is not a
statement that the portal is secure. See `security-pentest-brief.md` for the
independent test that still has to happen.

## What was already there

Worth writing down, because the temptation on a pass like this is to rebuild
what exists. Found working and left alone:

- **Auth**: Fortify, bcrypt, authenticator MFA, email login codes, Turnstile
  on every unauthenticated session-creating POST, `throttle:5,1` on login
  keyed by email+IP, absolute session expiry, trusted-device cookies.
- **Authorization**: one capability matrix (`Role::MATRIX`), route-level
  `capability:` middleware, and row-level scoping (`ApplicationScope`,
  `FileAccess`, `ContactScope`) that the AI tools reuse rather than bypass.
- **Headers**: CSP, HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`.
- **Audit**: `auth_events` (user, event, IP, user agent, country) plus an
  append-only `storage/logs/security.log` the in-app UI cannot edit.
- **Anomaly detection**: `Detectors` — impossible travel, IP-count change,
  one address against many accounts, download bursts — flagging for review
  rather than auto-locking accounts.
- **Vault**: UUID storage paths on R2 (outside the web root), envelope
  encryption, `nosniff` on every byte-serving response, SVG excluded from
  inline preview and from signed-URL redirects, filename cleaning that
  strips path separators and control characters.
- **Secrets**: nothing sensitive is committed, and no secret has a hard-coded
  fallback in `config/`. `APP_DEBUG` defaults to `false`, so an unset
  production env cannot turn on stack traces.
- **No uploaded file can execute.** Only `^/index\.php(/|$)` is passed to
  PHP-FPM in `docker/nginx/templates/app.conf.template`, so nothing under a
  storage or upload path is ever interpreted, whatever it is named. `.bak`
  and dotfiles are denied, and directory listing is off.

## What was fixed

### 1. Infected files were served to signed-in readers (High)

`ScanUploadedFile` marks a file `infected` and revokes its public links, and
`PublicShareController` refuses it. The signed-in doors did not check at all,
so an infected upload in a shared client folder was downloadable by every
colleague who could open the folder — the people most likely to open it.

`BaseFilesController::assertNotInfected()` now gates `download` and `preview`
on both `FileController` and `FileVersionController`, records
`file.blocked_infected`, and returns 403. `pending` still serves: the scan is
queued, and a worker that is behind must not make the vault look broken.

### 2. A renamed Linux/macOS binary passed upload inspection (High)

Found by testing rather than by reading. `FileType::inspect()` rejected a
Windows `.exe` (`application/x-dosexec`) and a shell script
(`text/x-shellscript`) by MIME, but an ELF or Mach-O binary sniffs as plain
`application/octet-stream` — so `malware.bin` renamed `document.pdf` was
accepted, stored, and offered for download.

`FileType::looksExecutable()` now reads the first bytes and rejects ELF,
Mach-O (all four orderings), PE/DOS, Java class, and any `#!` shebang,
whatever finfo concluded. Verified against real PDFs, PNGs, JPEGs, text,
CSV and DOCX to confirm it refuses none of them.

### 3. Untrusted content shared a channel with instructions (High)

The AI's tool authorization was already correct — every tool re-checks in PHP
against the session user, and the two state-changing actions are proposed by
the model but executed only after the reader confirms and the server
re-authorizes. That is the layer that does not depend on the model's
judgement, and it was not weakened.

The prompt layer was weaker. Document text was concatenated onto the end of
the reader's own turn, fenced with `---` — which a document closes by
containing a `---` line — so text in an uploaded PDF could read to the model
as the user speaking. Filenames, the browser-supplied page title, and scraped
form labels went into the *system* message unfenced.

`App\Support\Bespoke\Untrusted` now wraps all of it in a fence tagged with a
per-call random nonce, so content cannot write its own closing marker, and
`Untrusted::RULE` states in the system prompt that fenced text is data and
never an instruction. Applied to attachment text, `read_attachment` output,
filenames, the page title, and form labels.

### 4. The model chose email recipients with no check (Medium)

`propose_email` was the one tool where the model, not PHP, decided who gets
contacted — the natural sink for #3 ("summarise this and send it to …").

Recipients are not blocked, because emailing someone outside the firm is
ordinary and the reader still sends it from the Email page. Instead any
address that appears in neither the reader's own words nor the directory is
returned as `unvouchedRecipients`, and the model is instructed to name it and
ask before the reader opens the draft. Addresses the reader typed are not
flagged: a warning on every draft is a warning nobody reads.

### 5. Sign-in history grew without limit (Low)

`auth_events` holds IP, country, and device for every sign-in by every member
of the firm, and nothing ever deleted it. `security:prune-auth-events`
(daily, 03:50) drops rows past two years in 1000-row batches — one unbounded
`DELETE` over that table would lock it long enough to stall sign-in. The
append-only log copy is governed separately by log rotation.

## Testing

- `BespokePromptInjectionTest` (5) — fence cannot be closed by its content,
  nonce is per call, system prompt carries the rule and fences the title,
  unvouched vs. reader-supplied addresses.
- `BespokeAttachmentsTest::test_a_hostile_document_reaches_the_model_fenced_as_data`
  — end to end, a PDF whose text and filename both carry escape attempts.
- `FileManagerTest::test_an_infected_file_is_refused_on_download_and_preview`
  — including that clean and pending files still serve.
- `InjectionBypassTest` (6) — direct API requests, not the UI: renamed ELF /
  PE / Mach-O / shebang uploads, blocked extensions, SQL-injection strings,
  an XSS filename, IDOR against another account's file, and signed-out access.

## Still open

Honest list. None of these were introduced by this pass; all of them need
something outside the codebase.

- **Malware scanning is not running.** `MALWARE_SCANNER` defaults to `none`,
  which marks everything clean. The gate added in #1 only bites once ClamAV
  is actually deployed. **This is the single most important production
  configuration item on this list.**
- **Client-supplied chat history is replayed unverified.** The browser sends
  the transcript back, so a crafted request can forge prior *assistant*
  turns. Server-side transcripts already exist in `BespokeMessage`;
  rebuilding history from them is the fix. Not attempted here because it
  changes how conversations resume and needs its own testing pass.
- **No global AI spend cap.** Throttles are per user, with no token
  accounting or app-wide budget.
- **PDF structure is not validated.** A PDF is accepted on magic bytes and
  MIME; embedded JavaScript and actions are not stripped. Readers open
  documents in pdf.js, which does not execute them, but the bytes are served
  as uploaded.
- **`trustProxies(at: '*')`** is correct behind Laravel Cloud's load
  balancer, but means `X-Forwarded-For` is trusted from anywhere — so if the
  app is ever reachable directly, logged IPs become spoofable.
- **Housekeeping**: 51 tracked `.bak` files and
  `public/_preview-mail-window.html` sit in the docroot. Nginx denies `.bak`
  and none of them contain secrets, so this is tidiness rather than exposure
  — but it depends on that one nginx rule, and a deploy behind a different
  server would not have it.
- **Geo-blocking** is detection-only: country is recorded and unusual
  movement is flagged, but nothing blocks by country. Building configurable
  geographic restrictions is a product decision, not a bug fix, and was not
  in this pass.
- **Cloudflare WAF, DDoS, bot and rate-limit rules** are dashboard
  configuration, not code. Turnstile is wired; the rest is not verifiable
  from here.
