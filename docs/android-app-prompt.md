# Build the TM ANTOINE Portal native Android app

> **How to use this file.** Open this repository in your AI coding agent (Claude Code, Cursor, or similar) and say: *"Read `docs/android-app-prompt.md` and `docs/android-api-catalogue.md` in full, then build it, phase by phase, starting at phase 0."* Everything below is written to the coding agent in the second person. The firm's decisions are stated as rules; the code is the source of truth for everything else, and this file tells you where to look.

Written 6 September 2026 from the code in this repository. Repository paths are relative to its root.

---

## 0. Read this first: what you are building and the non-negotiables

You are building the **native Android app** for the TM ANTOINE Advisory portal, the Laravel application in this repository. The web portal already exists (a single-page shell at `resources/views/pages/dashboard.html` driven by the modules in `public/js/`), and a desktop app already exists (`desktop/`, an Electron shell over the hosted portal, 0.8.51). The Android app is the third client of the same backend. It lives at **`android/`** in this repository, beside `desktop/`.

The firm decided the following. Treat every line as law.

1. **Native, coded, Kotlin + Jetpack Compose.** Every screen is built natively. The app is **not** a PWA, **not** a WebView that loads the website, **not** Capacitor, Cordova, Ionic, React Native, Flutter, or any other wrapper around HTML. If a plan step would render portal HTML inside a WebView, the step is wrong. The one permitted use of a browser surface is a **Chrome Custom Tab** for sign-in and OAuth consent (section 5), because Google refuses OAuth inside embedded webviews (`desktop/main.js:641-648`). Email bodies are HTML from third parties; render them with a sandboxed, script-less HTML renderer inside a Compose surface (section 11, Email), which is not "the portal in a WebView".
2. **It behaves exactly like the desktop app.** Same preloader feel, same warm boot from a local replica, same full offline **read** of everything the account may see, same queued offline **writes** that replay on reconnect, same realtime updates, same badge and OS notifications, same calls. The desktop achieves this with `desktop/shell-cache.js`, `desktop/file-cache.js` and the portal's own `public/js/portal-store.js`, `portal-replica.js`, `portal-queue.js`. You reproduce the **behaviour** natively (Room, WorkManager, OkHttp), never the mechanism.
3. **It follows the portal's responsive layouts.** The web app already has phone and tablet layouts (breakpoints 1024 / 767 / 560 px in `public/css/dashboard-tma-overrides.css`). Phones get the phone arrangement, tablets and foldables get the tablet/desktop arrangement, selected by window size class.
4. **Same backend, same rules.** No second API. Every endpoint you call already exists and is listed in `docs/android-api-catalogue.md`. Section 14 lists the few backend additions you are allowed to make and how.
5. **Design system compliance.** `DESIGN_SYSTEM.md` and `design/tokens.json` are the visual spec. No new colours, spacing, radii, type sizes or components that are not derived from the tokens.
6. **Toolchain.** Android Studio on the developer's machine for the emulator and profiling; the backend from this repo's `docker compose up`; a Docker image for reproducible Gradle builds and CI (section 3).

What "done" means is in section 16. Work in the phase order of section 15 and do not skip a phase's acceptance checks.

---

## 1. Where the truth lives in this repo (file map)

| Question | Open |
|---|---|
| What does a screen do, exactly? | `public/js/<module>.js` — the web module is the behaviour spec. Sizes: `email.js` 14.5k lines, `clients.js` 14.3k, `messages.js` 9.4k, `portal-files.js` 8.3k, `feed.js` 5k, `settings.js` 4.9k, `portal-admin.js` 4.5k, `calendar.js` 4.3k, `portal-work.js` 3.8k, `portal-home.js` 3.8k, `dashboard.js` 3.5k, `messaging-calls.js` 3.4k, `cbi.js` 2k, `users.js` 1.9k, `cip-intake.js` 1.6k, `global-search.js` 1.5k, `account.js` 1.4k, `portal-people.js` 1.4k, `presence-status.js` 1.2k, `overview*.js`, `notify-*.js`, `sign.js` |
| Which endpoint, which params, which response keys? | `docs/android-api-catalogue.md` (this file's appendix), then `routes/web.php` and the named controller in `app/Http/Controllers/` |
| Who may see what? | `app/Support/Access/Role.php` (`MATRIX`, `PAGE_CAPABILITIES`, settings map), `app/Http/Controllers/LegacyPageController.php` (`SPA_PAGES`) |
| Colours, type, spacing, radii | `design/tokens.json`, `public/css/tokens.css`, `public/css/theme.css`; dark palette in `public/css/dashboard.css` (`.tma-dash[data-theme="dark"]` block) |
| Component specs and variants | `design/common-components.json`, `design/<component>.json` (76 files), `DESIGN_SYSTEM.md` |
| Icons | `public/images/icons/phosphor/` (1,614 SVGs, Phosphor set), `public/images/icons/tma/` (117 firm-specific), `public/images/icons/brands/` |
| Logos and brand art | `public/images/brand/tma/` (`tma-logo-horizontal.png`, `tma-logo-mark.png`, `favicon.png`, `macos_appicon.png`, `chat-wallpaper-pattern.png`); `desktop/assets/` (`logo-full.png`, `logo-mark.png`, `icon-master.png`) |
| Illustrations and empty-state art | `public/images/illustrations/` (28 illustrations, 3 line drawings, `dark/` twins), `public/js/no-data.js`, `public/js/illustration-theme.js` |
| Sounds | `public/audio/` (`message-chime.mp3`, `message-sent.mp3`, `notification-system.mp3`, `ringtone-1.mp3`, `ringtone-2.mp3`) |
| The sidebar and nav order | `resources/views/pages/dashboard.html` lines 97–210 (desktop sidebar) and 499–568 (mobile menu rows) |
| The boot skeleton | `resources/views/pages/dashboard.html` lines 304–338 |
| The desktop splash | `desktop/splash.html`, `desktop/splash.js` |
| Offline design and its decided rules | `docs/offline-plan.md`, `public/js/portal-store.js`, `portal-replica.js`, `portal-queue.js`, `portal-sync-status.js`, `files-sync.js`, `cip-sync.js`, `clients-sync.js` |
| Realtime | `public/js/messaging-realtime.js`, `portal-live.js`, `notify-realtime.js`, `routes/channels.php`, `app/Events/*` |
| Calls | `public/js/messaging-calls.js`, `messaging-recorder.js`, `app/Http/Controllers/CallRecordingController.php` |
| What the desktop shell adds | `desktop/README.md`, `desktop/main.js`, `host-bridge.js`, `badge.js`, `notifications.js`, `call-window.js`, `settings.js`, `updater.js` |
| Auth screens design | `AUTH_DESIGN.md`, `resources/views/auth/` |
| Running the backend | `README.md` (Docker section), `compose.yaml`, `.env.docker.example`, `docker/` |
| Browser test harness and seeded accounts | `tests/Browser/README.md` |
| What the QA team audited (page/route/capability counts) | `docs/qa-test-plan.md` |

When this file and the code disagree, the code wins. Say so in your commit message and fix this file.

---

## 2. Ground rules for working in this repo

- **Read the module before you build the screen.** For every screen in section 11, read the named `public/js/*.js` module end to end first. Copy its states, its copy, its ordering, its optimistic behaviour. Do not guess.
- **Never invent an endpoint, a field, or a string.** If you need something the API does not provide, stop and write it up under section 14's rules.
- **Copy UI text verbatim** from the web module. One short sentence per hint at most; delete a hint rather than shorten it.
- **No dummy data.** Loading, empty and error states only. The seeded Docker account is the test fixture.
- **Reuse before creating.** One Compose component per design-system component (`design/common-components.json`). Build it once in `:core:ui`, use it everywhere. Mirror the Users table patterns for every table.
- **Hover is not a thing on touch,** but the design system's hover restrictions still apply to pointer devices (tablets with a mouse, ChromeOS): only a `rgba(0,0,0,0.04)` background overlay on the listed elements, never elevation, never scaling.
- **Explorer-style selection in file lists**: tap opens, long-press starts multi-select, no checkboxes in file rows (`DESIGN_SYSTEM.md`, and `portal-files.js`'s selection model). Bulk actions live in the selection toolbar.
- **One file viewer everywhere.** Every list that opens a file opens the same viewer (section 11, File Library).
- **Signal, not payload.** Realtime events tell you *what* changed; you refetch through the endpoint you already use. Never trust a payload for rows.
- **Stale rows beat an error card.** Anywhere the replica has data, paint it and refresh silently. Only show an error when there is nothing to paint.
- **Dates**: ISO-8601 with offset on the wire; bare `Y-m-d` strings are calendar dates, not instants. Format in the user's preference timezone (`/me/preferences.timezone`, `autoTimezone`), not blindly in the device zone; pre-formatted `time`/`date`/`lastSeen` labels from the server are already in the user's zone.
- **Commit small, commit often, on `main`,** with a message that says what changed and why. Never `git add -A`; stage the files you touched.
- **Tests**: unit tests for the queue, the replica walker, the CSRF/cookie interceptor and the realtime frame parser; Compose UI tests for the boot sequence and one screen per module; a Maestro flow for the airplane-mode round trip (section 16).

---

## 3. Toolchain and environment

### 3.1 Android project decisions (fixed)

| Decision | Value |
|---|---|
| Location | `android/` (Gradle root), app module `android/app` |
| Application id | `com.tmantoinelaw.portal` (matches the desktop's `appId`, `desktop/package.json`) |
| App name | `TM ANTOINE Portal` |
| Language / UI | Kotlin 2.4, AGP 9.4 with Gradle 9.7 (`android.builtInKotlin=false` keeps the classic Kotlin plugin DSL), Jetpack Compose with Material 3, Compose BOM 2026.08 |
| minSdk / targetSdk / compileSdk | 26 / 37 / 37 (the AndroidX releases current in September 2026 require compileSdk 37 and AGP 9.1+) |
| JDK | 17 or 21 (Android Studio's bundled runtime is 21 and works) |
| Architecture | MVVM + repository, unidirectional data flow, `StateFlow` per screen |
| DI | Hilt 2.60+ (its Gradle plugin requires AGP 9) |
| Navigation | Navigation Compose with typed routes; one `NavHost`; `NavigationSuiteScaffold`/window size classes for phone vs tablet |
| Local data | Room (replica, write queue, notification/activity caches, warm-boot snapshots); Proto DataStore for preferences; `EncryptedSharedPreferences` for the sign-in verifier |
| Network | OkHttp 4.x with a persistent `CookieJar` (see section 5) + Retrofit + `kotlinx.serialization` |
| Background | WorkManager (replica walker, queue replay, mail poll on foreground only), a foreground service for calls |
| Images | Coil, with the shared OkHttp client so avatars and thumbnails carry the session cookie |
| Realtime | OkHttp `WebSocket` speaking Pusher protocol 7 by hand (section 10). `pusher-java-client` is acceptable if you plug in the same OkHttp client and a custom `Authorizer`; do not ship two HTTP stacks. |
| WebRTC | `io.getstream:stream-webrtc-android` (prebuilt `org.webrtc`) |
| PDF | `android.graphics.pdf.PdfRenderer` for previews, thumbnails and the signature editor. No third-party PDF SDKs. |
| HTML email bodies | a script-less HTML renderer inside Compose (e.g. a `TextView` with `HtmlCompat`/a purpose-built renderer). Not a WebView. |
| Fonts | Inter 400/600/700 bundled as font resources (`res/font/inter_*.ttf`), features `ss01`, `cv01` enabled |
| Version | `versionName` starts at `0.1.0`; `versionCode` = build number; bump with every release |
| Signing | debug: the default debug keystore; release: a keystore kept outside the repo, referenced from `android/keystore.properties` (gitignored). Never commit a keystore. |
| Distribution | Internal testing on Google Play, plus a signed APK published on the portal's release feed (section 14, optional addition) |

Add to the repo's `.gitignore` (there are no Android entries yet): `android/.gradle/`, `android/build/`, `android/app/build/`, `android/local.properties`, `android/keystore.properties`, `android/*.jks`, `android/.idea/`.

### 3.2 Run the backend for the emulator

The backend runs from this repository with Docker; nothing else needs to be installed (`README.md`, "Running with Docker").

```sh
docker compose up -d          # Postgres, Redis, app on :8001, queue worker, scheduler, Reverb
docker compose logs -f app    # watch it
```

- Sign-in for the seeded administrator: `admin@localhost` / `password` (`README.md`; `ADMIN_EMAIL` in `.env.docker.example:285`).
- The Android emulator reaches the host at **`10.0.2.2`**, so the portal origin is `http://10.0.2.2:8001`.
- Reverb is proxied by nginx under the same origin at `/app/` (`docker/nginx/templates/app.conf.template:94-97`), so the websocket is `ws://10.0.2.2:8001/app/<key>`. **Gotcha:** `/me.realtime` will say `host: "localhost", port: 8001, scheme: "http"` because the Docker env sets `REVERB_HOST=localhost` (`.env.docker.example:174-176`). Debug builds must rewrite a realtime host of `localhost`/`127.0.0.1` to `10.0.2.2`. Release builds never rewrite.
- Debug builds need `android:usesCleartextTraffic` scoped by a `network_security_config.xml` that permits cleartext **only** for `10.0.2.2`. Release builds are HTTPS only.
- Make the portal origin a `BuildConfig` field: `PORTAL_ORIGIN = "http://10.0.2.2:8001"` for debug, `"https://portal.tmantoinelaw.com"` for release, overridable with `-PportalOrigin=`.
- Social sign-in (Google/Microsoft) against the Docker stack only works if the provider client ids are in `.env.docker` and the redirect URI matches `http://localhost:8001/...` (`README.md`). The password path and the seeded admin need nothing.
- More accounts: `docker compose exec app php artisan tinker` and create users with `account_type` one of `Client`, `CRO / Reviewing officer`, `Administrator` (`app/Support/Access/Role.php:29-52`). The browser harness in `tests/Browser/README.md` shows the tinker one-liners it uses for `e2e@example.com`.
- Never run `migrate:fresh` or any wipe command; they are blocked outside PHPUnit and the production database was once wiped by an agent that tried.

### 3.3 Docker image for Gradle builds and CI

Create `android/docker/Dockerfile` and `android/compose.yaml` (a separate compose project so it cannot interfere with the app stack):

```Dockerfile
FROM eclipse-temurin:17-jdk-jammy
ENV ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk \
    PATH=$PATH:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip git && rm -rf /var/lib/apt/lists/* \
 && mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
 && curl -sSL -o /tmp/ct.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q /tmp/ct.zip -d $ANDROID_SDK_ROOT/cmdline-tools && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0"
RUN useradd -m -u 1000 builder && chown -R builder /opt/android-sdk
USER builder
WORKDIR /workspace/android
CMD ["./gradlew", "assembleDebug", "--no-daemon"]
```

```yaml
# android/compose.yaml
name: tma-portal-android
services:
  build:
    build: { context: ., dockerfile: docker/Dockerfile }
    image: tma-portal-android:build
    volumes:
      - ..:/workspace
      - gradle-cache:/home/builder/.gradle
    environment:
      GRADLE_OPTS: -Dorg.gradle.jvmargs=-Xmx4g
volumes:
  gradle-cache:
```

`docker compose -f android/compose.yaml run --rm build` produces `android/app/build/outputs/apk/debug/app-debug.apk`; `run --rm build ./gradlew assembleRelease` with the signing properties mounted produces the release. The emulator does **not** run in Docker (no KVM on macOS, no GPU); it runs in Android Studio on the host. Use the container for CI and for a build that does not depend on anyone's machine.

### 3.4 Android Studio

Latest stable Android Studio, Android SDK Platform 37.0, Build-Tools 37.0.0, Android Emulator (the command-line tools give you `sdkmanager` and `avdmanager`; the repo's `android/README.md` has the exact commands). Create three AVDs and test on all three before every phase's acceptance: a phone (Pixel 8, API 36), a tablet (Pixel Tablet, API 36), a foldable (Pixel Fold, API 36). Keep a physical phone in the loop for calls, camera and push (section 13).

---

## 4. App architecture (modules, layers, libraries, DI, navigation, deep links)

### 4.1 Gradle modules

```
android/
  app/                       # Application, Hilt root, NavHost, splash, deep links
  core/network/              # OkHttp client, cookie jar, interceptors, Retrofit APIs, realtime socket
  core/database/             # Room: replica tables, write queue, snapshots, cursors
  core/data/                 # repositories: one per backend module, offline-first
  core/ui/                   # theme (tokens), design-system components, icons, skeletons
  core/common/               # result types, time formatting (UserTime), i18n, logging
  feature/auth  feature/home  feature/overview  feature/clients  feature/cip  feature/cbi
  feature/files feature/signatures feature/workflows feature/messages feature/calls
  feature/email feature/calendar feature/feed feature/people feature/notifications
  feature/settings feature/search
```

Each `feature/*` module exposes a `NavGraphBuilder` extension and nothing else. `app` composes them.

### 4.2 Layers

- **Repository** = the only thing a ViewModel talks to. Every read is `Flow<Resource<T>>` that emits the Room copy first (marked stale) and the network answer second, mirroring `TMAStore.swr` (`public/js/portal-store.js`). Every write tries the network first; only a **delivery failure** (no route, DNS, TLS, timeout, connection reset) goes to the write queue; a 4xx/5xx is an answer and is surfaced (`portal-queue.js` header comment).
- **Room** holds: the replica (`files`, `folders`, `clients`, `cip_applications`), cursors, warm-boot snapshots keyed the way the web keys them (`home:*`, `messages:*`, `feed:*`, `calendar:*`, `clients:*`, `files:*`, `cip:*`, `mail:*`, `people:*`, `overview:*`), the notification and activity lists, and the write queue. All rows carry the **account id**; switching accounts never shows the previous account's rows (`portal-store.js`, "scoped to the account").
- **Session** = a small singleton: cookie jar, cached `/me`, socket id, online/reachable flags. Everything reads identity from it.

### 4.3 Navigation and deep links

One `NavHost`. Routes mirror the portal's URL paths (section 8) so a deep link and an in-app navigation are the same thing. Register **App Links** for `https://portal.tmantoinelaw.com/*` (autoVerify, with the `assetlinks.json` addition in section 14) and the custom scheme `tmaportal://auth` for the sign-in return. Unknown paths open the dashboard.

### 4.4 Process lifecycle

- Foreground: socket connected, heartbeat every 30 s, presence live.
- Background (app not visible): socket closed after a grace period (about 60 s), no heartbeat, WorkManager keeps replay and replica walks alive. Nothing is replayed by the server, so on every return to foreground: reconnect, re-auth every channel, refetch every registered surface, `catchUp` notifications, reload conversations (section 10).
- Killed: cold start goes through the boot sequence (section 6) and paints from Room before the network answers.

---

## 5. Auth and session (the handoff flow, headers, error semantics, walls, sign-out)

There is no API-token layer. The backend is session-cookie + CSRF only (`config/auth.php`, `bootstrap/app.php:20-25`; no Sanctum, no `routes/api.php`). The Android app authenticates exactly like the desktop app: a cookie jar and a CSRF header. Full detail with citations: `docs/android-api-catalogue.md`, chapter A1.

### 5.1 Sign-in: reuse the desktop handoff, unchanged

Server: `app/Http/Controllers/DesktopAuthController.php`; routes `/auth/desktop/start|finish|claim` (`routes/web.php:1452-1462`). Client reference: `desktop/signin-handoff.js`, `desktop/main.js:651-762`.

1. Generate `verifier` = base64url of 32 random bytes (43 chars) and `challenge` = base64url(SHA-256(verifier)). Persist the verifier in `EncryptedSharedPreferences` **before** opening the browser, so a cold-start deep link can still claim.
2. Open a **Chrome Custom Tab** at `{origin}/auth/desktop/start?challenge={challenge}` (append `&provider=google` or `microsoft` when the user tapped a provider button). Show the native waiting screen with the desktop's copy: title "Continue in your browser", body "Finish signing in with Google, then return here." (word the provider), buttons "Open in browser" (relaunch the same URL) and "Back to sign in" (forget the verifier). The browser has 900 s.
3. The browser lands on `/auth/desktop/finish`, which navigates to `tmaportal://auth?token=<64 chars>`. Declare `<intent-filter>` scheme `tmaportal`, host `auth`, `android:launchMode="singleTask"`, `autoVerify` not needed. Read `token` in `onNewIntent`/`onCreate`.
4. With the app's own OkHttp client (`followRedirects=false`), `GET /auth/desktop/claim?token=…&verifier=…`. Delete the verifier at once (the token is single-use even on failure). `302 Location: /` with `Set-Cookie` session + `remember_web_*` = success. `302 Location: /auth/login` = failure; the reason only exists as an HTML flash, so show "That sign-in could not be completed. Try again." and offer retry. If the deep link arrives with no stored verifier, show the desktop's dialog copy: "That sign-in could not be completed." / "Start signing in from this app rather than from the browser, and finish in the tab it opens."
5. `GET /me` immediately (section 5.3). Persist the JSON as the offline identity, exactly as the desktop keeps `localStorage['tma.me']` (`public/js/current-user.js:280-298,338-372`): a non-2xx answer **deletes** the cached copy; a network failure keeps it.

Optional native password form: `POST /auth/login {email,password}` with `Accept: application/json` answers `{"two_factor":false|true}` or 422; then `POST /auth/two-factor-challenge {code|recovery_code, trust_device}` answers 204. A JSON login is **not** remembered unless you then `POST /auth/stay-signed-in {stay:"yes"}` (chapter A1 §5). Prefer the handoff; it always remembers and covers every provider and the 2FA challenge in one path.

### 5.2 Every request

| Header | Value |
|---|---|
| `Cookie` | whatever `Set-Cookie` gave you: the session cookie (name `tm-antoine-advisory-session` unless Cloud sets `SESSION_COOKIE`; store what arrives, never hard-code), `remember_web_*`, `XSRF-TOKEN`, `tma_device_trust`, `tma_trusted_device` |
| `Accept` | `application/json` — always, or errors come back as HTML redirects |
| `X-Requested-With` | `XMLHttpRequest` |
| `X-XSRF-TOKEN` | the **URL-decoded** value of the `XSRF-TOKEN` cookie, on every POST/PUT/PATCH/DELETE (including `/broadcasting/auth` and `/auth/logout`) |
| `X-Socket-ID` | the Reverb `socket_id` on every write while the socket is connected (section 10); omit when disconnected |
| `Content-Type` | `application/json` for JSON bodies; multipart for uploads (let OkHttp set the boundary) |
| `User-Agent` | `TMAPortal/<version> (Android <release>; <model>)` — must contain "Android" so Security settings labels the device correctly (`app/Support/DeviceName.php`) |

Implement one OkHttp interceptor that adds all of this. Persist the cookie jar to disk (encrypted), one jar per app, cleared on sign-out.

### 5.3 What the status codes mean

401 → clear cookies and cached `/me`, go to sign-in. 419 → do any GET to refresh `XSRF-TOKEN`, retry once, then 401 handling. 403 with `code:"mfa-required"` → open the `redirect` in a Custom Tab. 403 otherwise → the account lacks the capability; hide the surface. 404 → gone or out of scope; remove locally. 409/422/429/502 → section 14 of the appendix's error table. A `302` from `/me` or any endpoint (the `profile.complete`, `account.approved`, `onboarded` walls have no JSON branch) → open its `Location` in a Custom Tab and re-run `/me` when the tab returns; poll `GET /auth/pending-status` → `{approved,hasRole}` for a pending account.

### 5.4 Sign-out

`POST /auth/logout` (204; retry once on 419 like `public/js/sign-out.js:103-110`), then clear the cookie jar, the cached `/me`, the replica, the snapshots and the notification cache. The **write queue survives sign-out**, scoped to the account that made it (`portal-queue.js`, "what IS honoured is the scope"); the same account signing back in resumes replay. Revoking another session from Security settings rotates `remember_token` server-side, which signs out every other remembered device including this one; handle the resulting 401 gracefully.

### 5.5 App lock (new, native only)

Offer "Require unlock" in Settings › Privacy: biometric or device credential via `BiometricPrompt`, on cold start and after 5 minutes in the background. Default off. This is a device preference (DataStore), not an account preference.

---

## 6. Boot sequence and preloader (splash, warm boot, skeleton, offline and error screens)

### 6.1 What the desktop shows today (copy it)

From `desktop/splash.html` and `desktop/splash.js`:

- A full-window layer, background **`#136da0`** (`--color-primary-dark`), `color-scheme: dark`.
- Centered column, gap 30 px: the full brand lockup (`desktop/assets/logo-full.png`; the web serves `public/images/brand/tma/tma-logo-horizontal.png`) knocked out to **solid white** (`filter: brightness(0) invert(1)`), width 220 px, fading up over 420 ms (`translateY(6px)` → 0, cubic-bezier(0.22, 1, 0.36, 1)); then a **180 × 4 px** track, `rgba(255,255,255,0.22)`, radius 999, holding an indeterminate full-width sweep (`linear-gradient(90deg, rgba(255,255,255,.35) 25%, #fff 50%, rgba(255,255,255,.35) 75%)`, background-size 220 %, 1.3 s linear loop). Reduced motion: no animations, the fill is solid white.
- The layer stays until the page has actually painted, then fades out over **240 ms** (`opacity` transition) so the portal appears to arrive; hard cap 12 s (`MAX_MS`), fade `FADE_MS` 260.

Android equivalent: the Android 12 `SplashScreen` API (icon on `#136da0`) for the first frame, handing off without a cut to a Compose splash that is pixel-faithful to the above, held with `setKeepOnScreenCondition` until the first real screen has composed. Then fade 240 ms. Never show a half-built screen under the fade.

### 6.2 Warm boot

Mirror `docs/offline-plan.md` phase 4 and `public/js/current-user.js`:

1. Read the cached `/me` from Room/DataStore. If absent → sign-in (section 5). If present → the app knows who it is; scope the store to that id.
2. Hydrate the first screen from its snapshot (`home:*` for the dashboard: metrics, the tiles, staff board; each screen's own keys otherwise). The dashboard's five tiles snapshot themselves after every load and hydrate at boot; there are **no skeletons on a warm boot**.
3. Only when no snapshot exists, show the **boot skeleton** the shell ships (`resources/views/pages/dashboard.html:304-338`): a 36 px avatar circle + 150 × 16 text line for the greeting; four KPI cards (two `--blue`, two `--purple`) each with a 55 % title line and a value/delta pair; three one-third-width panels with a 40 % head line and three file rows (icon square, 58 % and 34 % lines); a generic section with a 220 × 14 head and five rows with 32 px avatars. Shimmer per the `.tma-skeleton` styles in `public/css/dashboard.css`.
4. Fire `/me` and the screen's data in parallel behind the paint. Every screen keys "loaded" on **the server having answered** (`real`), never on "something finished"; a dead network marks tiles loaded-empty to drop the skeleton, and stale rows beat an error card (`tests/Browser/warm-home.mjs`, `warm-screens.mjs` are the behaviours to copy).
5. Watchdogs from `desktop/shell-cache.js`: `/me` answering **401/419** after a cached boot → drop the cache, sign-in; `/me` naming a **different account id** than the cache → wipe the account-scoped store and reboot. `identity` on the realtime channel or a changed `capabilities` array → refetch `/me` and re-apply gating (`portal-live.js:243-304`).

### 6.3 Offline and error screens

- **Offline with a replica**: no screen at all; the app opens on the replica. The sync pill (section 9.6) says "You’re offline".
- **Offline with nothing cached** (fresh install, no account): the desktop's offline notice, which is deliberately not an error: no URL, no error code, no red; one sentence saying the portal will come back on its own, retried on the `online` event and a 5-second poll (`desktop/test-offline-screen.js`, `docs/offline-plan.md` phase 4). Use "The portal will come back on its own as soon as you have a connection."
- **Section failure** (a request failed and the replica has nothing): the section-error card, title "Unable to load this section", body "There was a problem loading this section." with a Try again button (`public/js/section-error.js:21-26`). Never a full-screen error for one panel.
- **Server 5xx while online**: same card. Do not retry-loop; retry on tap, on foreground, on `online`.

---

## 7. Design system to Android theme (tokens, type, icons, dark mode, components, responsive rules)

Source of truth: `design/tokens.json` (consolidated from Figma `58ZXC7sZYQsbenzf0foWCH`), `public/css/tokens.css`. Build `:core:ui/theme` from these values, exactly; no Material default colours may leak through.

### 7.1 Colours (light) → Material 3 roles

| Token | Value | M3 role / use |
|---|---|---|
| `brand.primary` | `#03a5e9` | `primary`, links (`text.link`) |
| `brand.primaryDark` | `#136da0` | `primaryContainer`-ish strong brand, the splash surface, hint text (`text.hint`), "purple" calendar colour |
| `brand.tint1` | `#e6f6fd` | `secondaryContainer`, tag background |
| `brand.tint2` | `#e7f0f6` | `tertiaryContainer` |
| `surface.page` | `#f5f5f7` | `background` (window) |
| `surface.card` | `#f9f9fa` | `surface` (cards, panels) |
| `brand.white` | `#ffffff` | `surfaceContainerLowest`, filled-button text |
| `surface.input` | `rgba(255,255,255,0.8)` | text-field background |
| `surface.popup` / `popupGlass` | `rgba(255,255,255,0.9)` / `0.8` | menus, dialogs (backdrop blur 20 / 40 px) |
| `surface.tooltip` | `rgba(0,0,0,0.8)` | tooltip, blur 20 |
| `text.primary` | `#000000` | `onSurface`, `onBackground` |
| `text.secondary` | `rgba(0,0,0,0.40)` | `onSurfaceVariant` |
| `text.placeholder` | `rgba(0,0,0,0.20)` | placeholder |
| `border.soft/medium/strong` | `rgba(0,0,0,0.10/0.20/0.40)` | `outlineVariant`, `outline`, focused outline |
| `interactive.hover/hoverDeep/active/inactive` | `rgba(0,0,0,0.04/0.08/0.12/0.40)` | state layers; `inactive` = disabled alpha 0.40 |
| `accent.*` | indigo `#136da0`, violet `#b899eb`, blue `#7dbbff`, mint `#6be6d3`, cyan `#a0bce8`, green `#71dd8c`, pink `#ff90e8`, orange `#ffb55b`, yellow `#ffcc00`, red `#ff4747` | tags, calendars, charts (`chart.*` is the same set), status badges |
| Danger | `#ff4747` (`accent.red`); the desktop badge red is `#d21c1c` (`desktop/badge.js`) | `error`, unread badge |

There is **no purple** in the design system; the calendar's `purple` key renders as `#136da0` (`app/Support/Calendar/CalendarColours.php`). Folder colours: `default, blue, green, pink, red, teal` (`app/Support/Files/FolderColours.php`). Initials avatars use the seven-colour palette `#136da0 #03a5e9 #0f9d8c #3f9142 #c77d18 #b5497e #3b6fb8`, picked by summing the seed string's char codes mod 997 mod 7; initials are the first letters of the first two words, upper-cased, `?` fallback (`public/js/current-user.js:151-160`).

### 7.2 Dark palette

Light is the default; the device scheme is **ignored** unless the user chose `themeMode: "dark"` in Settings › Theme (`/me/preferences`, default `light`; `system` also exists and must follow the device). Values from `public/css/dashboard.css` `.tma-dash[data-theme="dark"]`:

| Token | Dark value |
|---|---|
| page background | `#161616` (`dashboard-tma-overrides.css:207`) |
| `--color-white` (surfaces) | `#1c1c1c` |
| `--color-black` (ink) | `#ffffff` |
| text primary / secondary / muted / placeholder | `rgba(255,255,255,0.9 / 0.62 / 0.55 / 0.25)` |
| borders soft / medium / strong / heavy | `rgba(255,255,255,0.12 / 0.28 / 0.45 / 0.85)` |
| hover / hoverDeep / active / inactive | `rgba(255,255,255,0.08 / 0.12 / 0.16 / 0.40)` |
| card | `#2a2a2c`; panel `#232325`; input `rgba(255,255,255,0.07)`; popup `rgba(40,40,42,0.92)` |
| accent backgrounds | primary at 16 % / 24 % over `#1c1c1c` |
| dashboard cards / KPIs | `#1e2b38`, `#29243a`; `#0286bd`, `#10557c` |

Every overlay (menus, dialogs, sheets, toasts) needs its dark twin; audit with the dark AVD before each phase ends.

### 7.3 Typography

Inter (bundled), features `ss01`, `cv01`, letter-spacing 0. Scale (`typography.scale`): `text12` 12/16 400, `text14` 14/20 400, `text14sb` 14/20 600, `text18` 18/28 400, `text18sb` 18/28 600, `text24sb` 24/32 600, `text48` 48/56 400/600, `text64sb` 64/72 600, `heading64` 64/72 400. Map: bodySmall = text12, bodyMedium = text14, labelLarge = text14sb, titleMedium = text18sb, headlineSmall = text24sb, displaySmall = text48sb. `fontScale` preference 1–5 (default 3) scales the whole set in steps of 0.9/0.95/1/1.08/1.16; honour the system font scale on top.

### 7.4 Spacing, radius, elevation

Spacing steps: 2 4 6 8 12 14 16 20 24 28 32 40 48 56 64 80 px → dp. Radius steps: 4 6 8 12 14 16 20 24 28 32 48, pill 80. Component sizes sm 24, md 28, lg 32, xl 40, 2xl 48, 3xl 56. Shadows: pill `0 2px 4px rgba(0,0,0,.10)`, popup `0 8px 28px rgba(0,0,0,.10)`. Transitions: fast 120 ms, base 150 ms ease. Popups: 480 / 600 dp wide, radius 24 / 32. Content max width 1200 dp on tablets.

### 7.5 Components (build each once in `:core:ui`)

From `design/tokens.json` `components` and the `design/*.json` specs: **Button** sizes small 24/12×4/r12/12pt, medium 28/12×4/r14/14pt, large 32/16×6/r16/14pt, xlarge 40/20×8/r20/16pt; variants borderless, grey (`rgba(0,0,0,.04)`), outline (0.5 dp `rgba(0,0,0,.2)`), filled (black on white); text-button radius pill. **Card** `#f9f9fa`, r16, gap 8, hover = background change only. **Input** `rgba(255,255,255,.8)`, r16, border `.2` → `.4` on focus. **Tag** `#e6f1fd`, r8. **Tooltip** `rgba(0,0,0,.8)`, blur 20, r12, 8×4, 12/16, title 14/20, max 255, arrow 8. **Tab group** pill (track r20, tab r16, pad 4, gap 4), segmented (r20/r12), solid (r12), filled, icon (r28/r20, pad 8), underline (gap 16, indicator 2). Also: toast (`design/toast.json`, positions bottom-right/top-right/bottom-left, durations 3/5/8/10 s from `toasts` prefs), popover, pagination, status badge, avatar (initials rule above), user chip, date picker, filter-and-sort, function bar, tables A/B/C (mirror the Users table), skeleton, no-data (illustration + one sentence), section error.

### 7.6 Icons

Phosphor, as masked vector drawables tinted with the ink colour (the web uses masked spans because raw `<img>` icons are always black). Convert the SVGs you need from `public/images/icons/phosphor/` and `public/images/icons/tma/` to `VectorDrawable`s with Android Studio's importer; keep the Phosphor names (the API returns icon names such as `EnvelopeSimple`, `ChatCircle`, `PenNib`, `FolderNotch` in notifications and file records, so build an `IconName → drawable` map and fall back to a generic icon). Nav icons: read the `<span class="tma-dash__nav-icon">` art in `resources/views/pages/dashboard.html:97-210`.

### 7.7 Responsive rules (from `DESIGN_SYSTEM.md` rule 9 and the overrides CSS)

- Window size classes: **compact** (< 600 dp) = the web's phone layout (≤ 767 px rules: single column, header bubble, left drawer, reading panes replace lists); **medium** (600–839 dp) = the web's tablet layout (≤ 1024 px: sidebar as a drawer, right bar as a drawer, two columns where the web has them); **expanded** (≥ 840 dp) = the desktop layout (persistent sidebar rail 68 → 240 dp, three panes for Email and Messages).
- Content never sits flush against card edges; always a gap between adjacent content.
- Type and card content scale down with the container (`clamp()` → `BoxWithConstraints`), cards keep their shape until the minimum width, then wrap; keep cards side by side as long as possible (`auto-fit/minmax` → `FlowRow` with min widths).
- Main-content values never ellipsise (`93.8%` must never read `93…`); secondary copy yields first; wide tables scroll horizontally in their own container.
- On phones the page footer scrolls with the content; fixed chrome stays fixed.
- Phone header: 56 dp (`--dash-mobile-header-h` = 44 + 12 + 12 + safe-area), a left "bubble" holding the menu button and the 28 dp logo mark (`dashboard.js:664-690`), the page's actions on the right (search, theme, notifications per page). The left drawer is `min(280dp, 78vw)`; a right drawer holds the right bar. Swipe from the left 24 dp edge opens the drawer, except in mail rows which own that edge.
- The phone **bottom tab bar is retired** in the web pending a redesign; do not add one. Primary navigation on phones is the drawer.
- Use `100dvh`-equivalent sizing: `WindowInsets` + `imePadding()`; the reply bar must never hide behind the keyboard.

---

## 8. Navigation and information architecture (nav tree with capability gates, header, drawer, deep-link table, settings pages)

### 8.1 The nav tree (order is the sidebar's, `resources/views/pages/dashboard.html:97-210`; gates from `app/Support/Access/Role.php` `PAGE_CAPABILITIES`)

| # | Label | Path | Module (`public/js`) | Capability gate | Phone menu |
|---|---|---|---|---|---|
| 1 | Dashboard | `/` | `portal-home.js` | none | yes |
| 2 | Overview | `/overview` | `overview.js` + `overview-*.js` | `overview.view` | yes |
| 3 | CIP Applications | `/citizenship-applications` (legacy `/clients` redirects) | `clients.js`, `cip-intake.js` | `clients.view`, or CIP reach (`me.cipReach`) for provider contacts and private clients | yes |
| 4 | Email | `/email` | `email.js` | `mail.use` | yes |
| 5 | Messages | `/social/messages` | `messages.js` | none | yes |
| 6 | Feed | `/social/feed` | `feed.js` | `feed.view` | yes |
| 7 | Calendar | `/calendar` | `calendar.js` | none | yes |
| 8 | Signature requests | `/signatures` | `sign.js` | none (create needs `signatures.create`) | yes |
| 9 | File Library ▾ | `/folders/all` All Files (`files.viewOrg`), `/folders/personal` Personal Folders, `/folders/shared` Shared Folders (`files.viewOrg`), `/folders/shared-with-me` Shared with me, `/folders/favorites` Favorites, `/folders/recent` Recent, `/folders/filebox` File Box, `/folders/recycle` Recycle Bin, plus `/folders/clients` Client Folders (CIP reach) | `portal-files.js` | as listed | Personal Folders only |
| 10 | Users | `/users`, `/users/new` | `users.js` | `users.view` / `users.manage` | yes |
| 11 | Reporting | `/reporting` | `portal-admin.js` | `settings.reporting` | yes |
| 12 | Templates ▾ | `/templates` System emails, `/templates/email` Email templates, `/templates/letters` Granted and Denied letters, `/templates/documents` Document requirements | `portal-admin.js` | `templates.view` (email templates: `templates.email`) | yes |
| 13 | Workflows ▾ | `/workflows` Requests, `/workflows/feedback` Feedback and Comments, `/workflows/updates` Updates required | `portal-work.js` | `workflows.view` | Requests, Updates |
| 14 | Call Recordings | `/call-recordings` | `call-recordings.js` | `callRecordings.view` | yes |
| 15 | People ▾ | `/people` Manage users, `/people/employees` Browse Employees, `/people/clients` Browse client contacts, `/people/prospects` Browse prospects, `/people/shared-address-book`, `/people/personal-address-book`, `/people/distribution-groups`, `/people/resend-welcome-emails` | `portal-people.js`, `users.js` | `directory.view` (+`clients.view` for clients/prospects, +`groups.view` for groups, `users.manage` for resend) | Manage users |
| 16 | Settings | `/account-settings` | `settings.js`, `account.js`, `portal-admin.js` | none (rail sections gated, 8.3) | yes |

Rules: a page the account may not use **does not exist** (server answers 404, not 403; `LegacyPageController.php:131-140`). Hide it, never grey it. Read the effective capability list from `/me.capabilities` on every boot and on the `identity` signal; the five `clients.*` employee grants and `directory.view` are admin-editable at runtime. CIP (`cip.*`) and CBI are feature-flagged (`FEATURE_CIP`, `FEATURE_CBI`) and absent from `capabilities` when off; CBI has no nav item (admin-only API at `/portal/cbi`, `cbi.js`). The sidebar has two tabs, **Main Menu** and **Folder Shortcuts** (`GET /portal/files/shortcuts`); the collapsed rail shows icons only.

### 8.2 Header

Left: menu button + logo mark on phones; breadcrumb (`data-crumb`) on tablets/desktop. Centre: global search (section 11, Search). Right: notifications bell with unread count (`GET /portal/notifications/count`), availability/presence menu (`/me/availability`, statuses and icons from `app/Support/Presence/AvailabilityStatus.php`), theme toggle, avatar menu (My profile, Settings, Sign out). On phones the right side is a "bubble" whose contents change per page (`dashboard-tma-overrides.css:349`).

### 8.3 Settings hub (`/account-settings`, deep link `?settings-page=<id>`)

Personal (`settings.js`): `profile` My profile, `theme` Theme, `time` Time and language, `notifications` Notifications, `privacy` Privacy, `account-security` Account security. Administrative (`portal-admin.js`, gate in parentheses, from `Role.php` settings map): `background-ops` Background Operations (`settings.operations`), `notification-history` Notification History (`settings.reporting`), `branding` Edit Company Branding (`settings.branding`), `cip-admin` Administrator, `clienthub-access` Access, `service-teams` Service teams, `custom-fields` Custom fields, `cip-documents` Document requirements, `cip-letters` Granted and Denied letters, `cip-distribution` Distribution group (all `settings.clientHub`), `security-insights` Security Insights, `signin-policy` Sign in policy, `security-policy` Security policy, `alert-settings` Security alert settings, `device-security` Configure device security (all `settings.security`), `connectors` Connectors, `storage-usage` Usage (`settings.storage`), `permissions` Permissions (`settings.advanced`), `default-folders` Default Folders, `folder-templates` Folder Templates (`files.settings`). Change email lives at `/settings/change-email`.

### 8.4 Deep links (App Links for `https://portal.tmantoinelaw.com`, from the JS routers)

| Path | Opens |
|---|---|
| `/`, `/overview`, `/calendar`, `/signatures`, `/users`, `/reporting`, `/templates[/…]`, `/workflows[/…]`, `/call-recordings`, `/people[/…]`, `/account-settings[?settings-page=]` | that screen |
| `/citizenship-applications`, `/…/new`, `/…/{uid}`, `/…/{uid}/edit`, `/…/companies/new`, `/…/companies/{uid}[/edit]`, `/…/applications/new[?phase=post_approval]`, `/…/applications/{id}/edit` (`clients.js:1170-1207`); `/clients/*` redirects to the same | Clients hub screens |
| `/email`, `/email?message={uuid}` (switches to Snoozed if the message is resting), `/email/templates`, `/email/compose` | Email |
| `/social/messages`, `/social/messages?conversation={uuid}` | Messages |
| `/social/feed`, feed post links carried by notifications' `actionUrl` | Feed |
| `/folders/{section}`, `/folders/all?folder={uuid}&file={uuid}` (notifications link to `/folders/all?file=`) | File Library, opening the file viewer when `file` is present (read `file` before you clear the URL) |
| `/calendar` with an event id from a notification's `actionUrl` | Calendar event |
| `tmaportal://auth?token=` | sign-in return (section 5) |
| `/auth/*`, `/r/{token}`, `/s/{token}`, `/sign/{token}`, `/invite/{token}`, `/onboarding*`, `/privacy-policy`, `/terms-of-service` | never handled in-app: open in a Custom Tab |

Notifications carry an `actionUrl`; route it through the same table.

---

## 9. Offline architecture (replica walker, sync cursors, Room schema, write queue, sync indicator, conflicts, byte cache)

The firm decided this on 16 Aug 2026 (`docs/offline-plan.md`): full offline read **and** write; everything the account may see is downloaded, not just what was opened; cached client data lives on the installed app, never in a browser. The Android app is an installed app, so it gets the desktop's full behaviour. Every rule below has a citation in chapter A2–A4 of the appendix or in `docs/offline-plan.md`.

### 9.1 Replica: three cursors, one walker

| Record type | Endpoint | Cursor params | Page size | Pages per wake (web) | Store keys (web) |
|---|---|---|---|---|---|
| File Library | `GET /portal/files/sync` | `foldersSince, foldersAfter, filesSince, filesAfter` (independent) | 200 per table | 30 | `files:folder:<uuid>`, `files:item:<uuid>`, `files:sync-cursor` |
| CIP applications | `GET /portal/cip/applications/sync` | `since, after` | 50 | 20 | `cip:…`, cursor key in `cip-sync.js` |
| Clients | `GET /portal/clients/sync` | `since, after` | 200 | 40 | `clients:record:<uid>`, `clients:sync-cursor` |

Cursor = `updated_at` **and** row id with an **inclusive** tie-break: the boundary row is re-delivered on purpose; upsert by id. Soft-deleted rows arrive as tombstones `{id, deleted:true, deletedAt}` (files: `{id,type,deleted:true,deletedAt}`); delete the local row. Persist the returned `cursor` object verbatim **after every page** so a killed app loses the pages that were left, never the ones that landed. Stop at the page budget; the next wake continues. A 403/404 (a client account asking for staff cursors) fails quietly and leaves the cursor untouched. Two honest limits: a purged recycle-bin row leaves no tombstone and a revoked share moves no row, so run a **full walk** (cursor reset) once a week and on account change. Sync pages do not materialise CIP checklists; only `GET /portal/cip/applications/{uuid}` does.

Wakes (`portal-replica.js:103-108`): connectivity regained, a queued write landing (`tma:queue-applied`), and `/me` answering; never a timer. Implement as a unique WorkManager `OneTimeWorkRequest` per walker with network constraint, enqueued from those three events, plus a periodic weekly full walk. Announce progress per page; the sync pill shows "Syncing for offline, N records" with a neutral dot.

Warm-boot snapshots: every screen that loads a list snapshots its first page under its key after a real answer (dashboard tiles, Messages conversation list, Feed first page, Overview panels, Calendar grid, People feeds, the mailbox's first page of a plain folder keyed to the account id). Hydrate from the snapshot at boot; overwrite only on a real answer.

### 9.2 Room schema (minimum)

`account_scope` on every table. Tables: `me_cache`, `files` (record JSON + indexed `folderId`, `ownerUserId`, `name`, `modifiedAt`, `deletedAt`), `folders` (JSON + `parentId`, `folderType`), `clients` (JSON + `uid`, `name`), `cip_applications` (JSON + `uuid`, `clientUid`, `status`, `phase`), `sync_cursors` (`walker`, `cursor JSON`), `snapshots` (`key`, `json`, `savedAt`), `notifications`, `activity`, `write_queue` (9.3), `file_bytes` (9.5 index). Entries older than **7 days** are ignored on read and swept (`portal-store.js` `MAX_AGE_MS`), except the replica tables, which are authoritative until a tombstone or full walk removes them.

### 9.3 Offline listings: what is assembled, what is refused

From the replica the app assembles (`portal-files.js:590-660`): File Library **All Files** root, **My Files** (owner = cached `/me.id`), and **any folder's children**; folders first, then files, sorted by name, without search or filters. **Shared with me, Shared Folders, Recent, Favourites, Recycle Bin** encode questions the rows cannot answer offline; refuse them with "You’re offline" rather than show a wrong listing. Client profiles open from `clients:record:<uid>`; the client directory from its snapshot; a CIP application from its replica record (checklist as last materialised). Everything else (Email, Feed, Calendar, Messages, Notifications, People) opens from its snapshot only and shows the pill.

### 9.4 The write queue (`portal-queue.js`, copy its rules exactly)

- **Network first, always.** A write is queued only when it could not be *delivered* (rejected connection, DNS, timeout, or the device already knows it is offline). A 4xx/5xx is an answer: show it, never queue it.
- An intent = `{kind, label, method, url, parts[] (multipart fields, with files as stored blobs), headers, nonce, state:'waiting'|'failed', createdAt}`; auto-incrementing id **is** the replay order.
- The screen applies the change **optimistically** and marks it "Saved on this device".
- Replay is **oldest-first and stops at the first entry that cannot be delivered**; it never steps over a blocked entry (two edits to one record applied out of order leave the older winning).
- An entry the server refuses on its merits (422, 404, 403) is parked as **`failed`** and kept; it does not block later entries. The sync panel lists it with **Try again** and **Discard**. The queue never discards work by itself.
- Retry a stalled queue after 15 s, doubling to a 5-minute ceiling; also on connectivity regained and on foreground.
- `reachable` is learned from the last attempt, not from `navigator.onLine`'s Android equivalent alone: a captive portal is "online" and answers nothing.
- Every replayed request carries the current `X-Socket-ID` and a fresh `X-XSRF-TOKEN`; a 401/419 during replay **stops** the run and keeps the entry.
- Idempotency: message sends carry a client `nonce` (server returns the original on retry); CIP intake carries `submissionId`; uploads resume by upload-session id. Use them.
- Entries are scoped to the account and **survive sign-out**; a different account never sees or replays them.
- Conflict policy today is **last-writer-wins**; the firm has not decided version-based conflict detection (`docs/offline-plan.md`, open questions). Do not invent one; replay as the web does.
- Which writes queue today: CIP application create/edit (`cip-intake.js:1353-1368`) and, in this app, everything the section-11 specs mark as "queues": message sends, reactions, stars, read marks, file rename/move/favourite/delete/restore, folder create, comments, calendar event create/edit/delete/respond, feed posts/comments/reactions/votes, client edits, notification read marks, preferences. Uploads queue as upload sessions (9.5). Mail sends do **not** queue (provider-first; show "You’re offline" and keep the draft locally).

### 9.5 Bytes: previews, thumbnails, uploads

- Document bytes cache (`desktop/file-cache.js`): keep previews and thumbnails a person has **viewed** on disk (cache-on-access, LRU by last *use*), bounded at **512 MB** (the firm's placeholder; one constant), **network first, always**: a file's URL does not change when its content does, so the cache answers only when the network could not; a real answer, a 404 included, stands. Cleared on sign-out and account change; kept across app updates. Avatars join the byte cache. Wire this as an OkHttp `Interceptor` on the shared client so every image, PDF, audio and video load passes through it.
- Uploads use the chunked protocol (`docs/android-api-catalogue.md` A3 §5): `POST /portal/files/uploads` (8 MB chunks, 3 concurrent jobs, 5 retries per chunk, resumable by `GET /uploads/{id}/status`, 24 h TTL, `POST …/complete` with a conflict choice on 409). Persist active jobs so a killed app resumes them; run them in WorkManager with a progress notification.

### 9.6 The sync indicator (`portal-sync-status.js`, copy the strings)

A pill in the header, **silent by design** when there is nothing to say. States and labels: "Syncing…" (queue replaying), "You’re offline" (dot `offline`, neutral grey), "Syncing for offline, N records" / "Syncing for offline…" (replica, neutral dot), N waiting / N failed (amber only when something is parked). Tapping opens the panel: lead copy when offline "You’re offline. These changes are saved on this device and will be sent on their own once you have a connection."; each parked entry shows its label with **Try again** and **Discard**. Pull-to-refresh on lists (`pull-refresh.js`) triggers the screen's load and a queue replay.

---

## 10. Realtime (connection, channel auth, channels, event catalogue, X-Socket-ID, reconnect, presence)

Full detail: appendix chapter A8. Implement it as one `RealtimeClient` in `:core:network`.

1. **Config** comes from `/me.realtime` (`{enabled,key,host,port,scheme}`); nothing is compiled in. `enabled:false` → poll fallbacks only. Restart the socket when `key` changes.
2. **URL**: `{ws|wss}://{host}:{port}/app/{key}?protocol=7&client=tma-portal&version=1.0&flash=false` (`messaging-realtime.js:295-301`). Debug builds map `localhost` → `10.0.2.2` (section 3.2).
3. **Handshake**: wait for `pusher:connection_established`; **`data` is a JSON string** on every frame, parse twice; keep `socket_id`. Answer `pusher:ping` with `pusher:pong`; treat 90 s of silence as a zombie; on `pusher:error` 4000–4099 stop reconnecting and switch Messages to a 10 s poll of `/portal/messaging/conversations`; 4100–4199 back off; 4200–4299 reconnect now.
4. **Auth**: `POST /broadcasting/auth {socket_id, channel_name}` with cookies + `X-XSRF-TOKEN` + `Accept: application/json`, then `pusher:subscribe {channel, auth}`; wait for `pusher_internal:subscription_succeeded`. A **403** here means "not allowed **or** signed out"; confirm with `GET /me` before deciding.
5. **Always-on channels**: `private-App.Models.User.{id}` (`data.changed`, `notification.created`, `presence.status`), `private-messaging.user.{id}` (`messaging.inbox`, `call.signal` — subscribe this one **first**, incoming calls only reliably arrive here), `private-portal.staff` only when `me.isStaff` (a client asking gets 403). Per-conversation `private-conversation.{uuid}` for every conversation in the inbox; `private-file.{uuid}`, `private-feed.channel.{uuid}`, `private-cip.application.{uuid}` while that screen is open, unsubscribed on exit.
6. **Events → action** (names are exactly `broadcastAs`, no leading dot): `data.changed {resource}` → debounce 300 ms per resource and refetch that surface through its normal endpoint (resources `files, clients, users, contacts, calendar, companies, projects, signatures, activity, workflows, cip, identity`; `identity` = refetch `/me`); `notification.created {notification, unread}` → prepend, set badge to the absolute `unread`, raise an OS notification (section 12); `presence.status` → update that user's availability pill; `message.sent {conversationId,messageId,seq,senderId,sentAt}` → refetch the thread/row, `POST …/delivered`, `POST …/read` only if the thread is on screen, notify if not mine and not muted; `message.updated/deleted/reacted`, `conversation.delivered/read` (never downgrade a tick), `messaging.typing` (7 s TTL), `messaging.presence`, `messaging.inbox` (own other devices), `call.signal` (dedupe on `signalId`, 120 s window), `feed.post.changed {channelId,action,postId}`, `file.comment.changed`, `file.detail.changed {fileId,section}`, `file.presence.changed`, `cip.thread.changed`.
7. **Self-echo**: every write carries `X-Socket-ID`; `toOthers()` then skips you. Handlers are idempotent anyway; Messages also ignores its own `recipientId`/`readerId`/`userId`.
8. **Reconnect**: jittered exponential backoff `min(30 s, 1 s·2^n)·(0.7–1.3)`; on every `connected` transition re-auth every channel, refetch every registered surface, `catchUp` notifications with `forceLoad`, reload conversations. Also on foreground and on network regained. **Nothing is replayed by the server.**
9. **Presence**: `POST /portal/messaging/heartbeat` every 30 s while foregrounded (server TTL 45 s); stop when backgrounded so the user goes offline like the web. `POST /me/availability/call {active}` on call start/end.
10. **Background**: there is no push provider today. Until section 13's FCM addition ships, the app only hears rings and notifications while foregrounded, and catches up on resume. Say this in the release notes.

---

## 11. Module-by-module screen specs

Each subsection names the web module that is the full spec, the capability, the phone/tablet arrangement, the endpoints, the realtime signals, the offline rules, verbatim copy, and acceptance checks. Endpoint details (params, shapes, limits) are in `docs/android-api-catalogue.md`; the chapter is named in each subsection.

### 11.1 Dashboard (Home)

Spec: `public/js/portal-home.js`, `portal-home-library.js`, `dashboard-metrics.js`, `dashboard.js`. Appendix A2 §4. Everyone.

- **Layout**: greeting row (the real name and avatar, rendered before any data arrives), four **KPI cards** with a period picker (Today / This week / This month / This year; `GET /portal/dashboard/metrics?period=`; staff cards `clientResponse, cipNew, cipUpdatesRequired, awaitingSignature`; provider-contact cards `cipActive, cipUpdatesRequired, unreadMessages, openComments`; each `{value, delta, deltaUp, hint}`; non-staff without provider reach get `{staff:false}` and **no KPI row**), then the **tile board**. Tiles (ids, labels, descriptions from `DASH_TILES`): `recentFiles` Recent Files "Files you last accessed across all of your devices."; `email` Recent Email "Your latest inbox messages, ready to open." (`mail.use`); `messages` Messages "Your five most recent chats, with unread counts."; `shortcuts` Shortcuts "Frequently used actions, as well as quick access to certain folders."; `employees` Employees "Who is online, and today's work status (office, remote, leave)." (staff only, `GET /portal/dashboard/staff`); `favorites` Favorites "Files and folders you marked as favorite."; `road` Upcoming Events "Upcoming events for the selected day."; `cipStatus` CIP Applications (`GET /portal/cip/dashboard` buckets); `requests`, `comments` (`GET /portal/dashboard/work?want=requests,comments`). Order and visibility come from `/me/preferences.dashboardTiles` and `dashboardLayout` (server stamps `dashboardLayoutVersion`, currently 13, and re-seeds older boards). "Edit dashboard" toggles tiles and reorders them; persist via `PUT /me/preferences`.
- **Phone**: one column, KPI cards two-up then one-up under 560 dp; tiles stack in `dashboardLayout.order`. **Tablet**: KPI four-up, tiles three-up (`tma-portal-tile--third`).
- **Realtime**: `data.changed` for `files`, `cip`, `signatures`, `activity`; `notification.created`; `presence.status` for the Employees tile.
- **Offline**: warm-boots from `home:*` snapshots (metrics, tiles, staff); never a skeleton when a snapshot exists.
- **Checks**: cold start with airplane mode on shows yesterday's board unchanged; period picker changes all four cards; a client account sees no KPI row and no Employees tile; reorder survives restart.

### 11.2 Overview

Spec: `public/js/overview.js`, `overview-activity.js`, `overview-employees.js`, `overview-files.js`, `overview-notifications.js`, `overview-recycle.js`. Gate `overview.view`. Panels: activity (`GET /portal/activity`), employees (`GET /portal/dashboard/staff`), files (`GET /portal/files?section=recent&lean=1`), notifications (`GET /portal/notifications`), recycle (`GET /portal/admin/recycle-bin`, admins). Phone: stacked panels; tablet: two columns. Realtime: `data.changed` `activity`, `files`, `users`; `notification.created`. Offline: `overview:*` snapshots; the road and work-plan panels hydrate only for the day they were kept. Checks: every panel has loading, empty and error states; the recycle panel is absent for non-admins.

### 11.3 Clients hub (incl. Companies, Onboarding)

Spec: `public/js/clients.js` (read all of it), `clients-sync.js`. Appendix A4 §2–4, §8–9. Gate `clients.view`; employees without `clients.viewAll` see only assigned clients (server-scoped, never filter client-side).

- **Screens**: directory (`GET /portal/clients` lean rows + `customFields`; server search `GET /portal/clients/search?q&limit`; default page size 100 with client-side paging "page 4 of 111"; facets by type/referral; A–Z sticky group headers; **split view** toggle = grid mode with the profile beside the list on tablets), client profile with tabs **info, Documents (folders), assigned, messages, access** (`GET /portal/clients/{uid}`, `…/assignments`, `…/conversations`, `…/access`, `…/invite`), create/edit form (`POST`/`PATCH`, `profile` blob with `phones, emails, addresses, importantDates, work, custom{}`), duplicate, delete/bulk-delete, invite (`POST …/invite`), companies list/detail/edit/members/staff (`/portal/companies…`), list tabs `all_applications, pre_approval, post_approval, closed, providers, people`.
- **Referral**: Company column = the *referring* company (`referredByLabel`), never `companyId`; "Private" and an em dash are the other two readings.
- **Phone**: directory as a list with data-label cards instead of a table; profile tabs as a scrollable tab row; split view unavailable. **Tablet**: table + split view.
- **Realtime**: `data.changed` `clients`, `companies`, `cip`.
- **Offline**: directory from its snapshot; a profile from `clients:record:<uid>` (full record via the sync cursor); edits queue; creating a client offline queues and shows the row as "Saved on this device" until it lands.
- **Onboarding** (`/onboarding/*`) is Blade, not JSON: open it in a Custom Tab when `/me` redirects there.
- **Checks**: create → survives restart → bulk delete; an employee without `viewAll` cannot open an unassigned client by deep link (404 → "not found"); the directory of 11k rows scrolls at 60 fps with paging; the Company column shows the referrer.

### 11.4 CIP applications

Spec: `clients.js` application screens + `public/js/cip-intake.js`, `cip-sync.js`; `docs/cip-phase-plan.md`. Appendix A4 §5. Reach = `cip.*` capability **or** `me.cipReach` (provider contact / private client); feature flag `FEATURE_CIP`.

- **Screens**: dashboard buckets (`GET /portal/cip/dashboard`), applications table with filters, sort, phase tabs (`GET /portal/cip/applications`), application profile tabs `overview, applicant, sponsor?, dependents?, …, activity` (`GET …/{uuid}`, `…/events`, `…/messages` with internal/provider lanes, `…/assignments`), intake wizard for new/edit (`GET …/form`, multipart `POST …/applications` and `POST …/{uuid}` — POST, not PATCH), document slots with upload/approve/request-changes (`POST /portal/cip/documents/{uuid}/file|approve|request-changes`, comments), status actions drawn **only** from `availableTransitions`/`availableOverrides` (dedicated verbs `submit`, `confirm`, `submission`, `query`, `acceptance`, `decision` (PDF letter), `stage`, `post-approval`, `milestones/{key}`), person statuses post-approval.
- Transition verbs return a **reduced** record; re-read the full application before painting.
- **Phone**: buckets as a horizontal chip row, table as cards, wizard one step per screen with the checklist as a bottom sheet. **Tablet**: as desktop.
- **Realtime**: `data.changed` `cip`; `cip.thread.changed` on `private-cip.application.{uuid}` while open.
- **Offline**: replica records open offline; edits queue as multipart intents with `submissionId`; a **new** application queues but the hub cannot show the applicant until it lands (`docs/offline-plan.md`, "does not work yet"); a document uploaded offline queues but its checklist tick waits for the server. Copy: "Saved on this device".
- **Checks**: `tests/Browser/cip-offline.mjs` round trip reproduced with Maestro: open an application online, edit offline, see "Saved on this device", reconnect, see it land; a provider contact sees no Service providers tab; a bare `status` POST to a stage destination is never attempted.

### 11.5 CBI

Spec: `public/js/cbi.js`. Admin + `FEATURE_CBI` only, else 404; no nav item. Read-only Smartsheet mirror: `GET /portal/cbi/summary`, `…/applications`, `…/applications/{uuid}`, `POST …/comments`, sync status/trigger. Build it last, phone as cards, no offline beyond the snapshot. Check: non-admins never see it.

### 11.6 File Library (incl. Folder shortcuts, Recycle bin, Requests)

Spec: `public/js/portal-files.js` (read all), `portal-folders.js`, `file-select.js`, `file-thumbs.js`, `portal-lightbox.js`, `portal-upload-manager.js`, `portal-file-requests.js`, `portal-shortcuts.js`, `folder-colours.js`, `file-icons.js`, `files-sync.js`. Appendix A3.

- **Sections** (`GET /portal/files?section=`): `all` "All Files" / "All files and folders you can access." / empty "No files yet"; `clients` "Client Folders" / "Citizenship by investment application folders you can open." / "No application folders yet" + "Folders for the applications you work with will appear here."; `my` "My Files" / "Files and folders you own." / "You haven’t created any files yet"; `shared` "Shared with me" / "Items other people have shared with you." / "Nothing has been shared with you yet"; `shared-folders` "Shared Folders" / "Folders with active sharing or assigned people." / "No shared folders yet"; `favorites` "Favourites" / "Files and folders you starred for quick access." / "No favourites yet"; `filebox` "File Box" / "Loose files not yet organised into a folder." / "Your File Box is empty"; `recent` "Recent" / "Files you recently uploaded or changed." / "Nothing recent yet"; `recycle` Recycle Bin. Uploads only in `all`, `my`, `filebox` at root or inside a folder with `permissions.upload`.
- **Listing**: breadcrumb, sort (name/created/modified/size/type/owner), type filter, owner facet, search (server), grid/list toggle, folders first then files, page size 50 adopting the server's clamp, `hasMore` paging. Folder sizes come from the 5-minute subtree job (`sizeLabel`), never computed locally. Folder colours (`default, blue, green, pink, red, teal`) and icons.
- **Selection**: explorer-style; long-press enters multi-select; no checkboxes; selection toolbar = bulk actions (`POST /portal/files/bulk`). Context menu per row (long-press menu on phones) with exactly the actions `portal-files.js:7435-7511` offers, each gated by the row's `permissions`.
- **Viewer** (one for the whole app; every list that opens a file calls it): image (`previewUrl`), PDF (`PdfRenderer` over a ranged download of `previewUrl`; never a WebView), audio/video (ExoPlayer on `previewUrl`, which is a 302 to a signed R2 URL for media), `text/*` (fetched), anything else = no preview + Download. Side panel: Activity (`GET …/activity?filter`), Access (`…/access`), Details (`…/details`), Comments (`…/comments`, `peek=1` to read without marking read; anchors on pages), Versions (`…/versions`, add/restore), Workflows (`…/workflows`), Presence (`POST …/presence` on a timer while the viewer is open, `DELETE` on close; the server prunes after 10 min of silence, `portal-files.js:2605`).
- **Thumbnails** (`TMAFileThumbs` rule): `thumbUrl` for raster images; PDFs painted client-side from page 1, cached by URL, lazy, one at a time; everything else the category icon.
- **Uploads**: chunked (section 9.5); conflict 409 → dialog Replace / Keep both / Rename; progress in a notification; `tma:upload-complete` refreshes the folder.
- **Shares** (`GET/POST/PATCH/DELETE /portal/files/shares…`): people, companies, link with password/expiry/allow-download; **Request files** (`/portal/files/requests`): one dialog behind three entry points (folder menu, toolbar, client Documents tab), link `/r/{token}` shared via the share sheet.
- **Folder shortcuts**: sidebar tab, `GET/POST/PUT /portal/files/shortcuts`, drag to reorder, remove.
- **Recycle bin**: Restore / Delete permanently / View details; Empty bin.
- **Phone**: list only (no grid), breadcrumb collapses to "‹ Parent", side panel as a full-screen sheet, viewer full-screen with a bottom action bar. **Tablet**: grid/list + side panel.
- **Realtime**: `data.changed` `files` (refetch the open listing, 300 ms debounce); `file.comment.changed`, `file.detail.changed`, `file.presence.changed` on `private-file.{uuid}` while the viewer is open.
- **Offline**: 9.3 assembly rules; byte cache for viewed previews/thumbs; rename/move/favourite/delete/restore/folder-create queue; uploads resume.
- **Checks**: `tests/Browser/files-cached-listing.mjs` and `files-replica.mjs` behaviours: a folder browsed once opens offline; Shared with me refuses offline with "You’re offline"; a 2 GB upload survives the app being killed; the same viewer opens from Dashboard, Clients › Documents, Messages attachments and Feed; a personal OneDrive file of another user never appears in All Files (`FileOrgDefaultAccessTest` is the guarantee; treat any leak as a release blocker).

### 11.7 Signatures

Spec: `public/js/sign.js`; `tests/Browser/signature-editor.mjs`, `signing-flow.mjs`. Appendix A3 §13. Everyone sees `/signatures`; creating needs `signatures.create`.

- List (`GET /portal/signatures?search&status&scope`), statuses `draft, sent, viewed, in_progress, completed, declined, changes_requested, cancelled, expired`; create from a PDF in the library (`GET …/documents`, `POST /portal/signatures`), recipients (signer/approver/cc, order), **field editor** on the rendered PDF (`PdfRenderer` pages, drag to place `signature|initials|name|email|date|text|checkbox` fields stored as page-relative fractions 0..1, `PUT …/{uuid}/fields`), send with expiry, remind, cancel, links. Public signing (`/sign/{token}`) stays in the browser (Custom Tab) — it has no portal session.
- Phone: editor in landscape with a floating field palette; tablet: as desktop.
- Realtime: `data.changed` `signatures`. Offline: list snapshot; sending requires network (say so).
- Checks: a field placed at `y=0.78` on page 2 lands there after send (`stamped-output.mjs` logic); a non-creator cannot see the create button.

### 11.8 Workflows

Spec: `public/js/portal-work.js`. Gate `workflows.view`. Hub screens Requests (`GET /portal/files/workflows?scope=inbox|sent|all&type&state&q&cursor`), Feedback and Comments (`…/workflows/comments`), Updates required (`…/workflows/updates`), counts badge (`…/workflows/counts`). Per-file actions live in the file viewer (respond `approve|decline|request_changes|acknowledge|submit_feedback`, delegate, cancel, history). Read-only hub, per-file writes. Phone: cards with the status tone; tablet: table. Realtime `data.changed` `workflows`. Offline: snapshot; responses queue. Check: a deep link to a workflow whose file the user cannot list still opens the file (listing-vs-access gap was fixed server-side; verify).

### 11.9 Messages and Calls

Spec: `public/js/messages.js` (read all), `messaging-api.js`, `messaging-realtime.js`, `messaging-calls.js`, `messaging-recorder.js`, `messaging-image-editor.js`, `call-recordings.js`, `presence-status.js`, `last-seen.js`. Appendix A7 and A8. Everyone; clients only reach assigned staff and admins (`ContactScope`).

- **Conversation list**: `GET /portal/messaging/conversations` (bootstrap, also returns `me`, `settings`, `realtime`, `limits`), pinned first then by `timestamp`; row = photo, name, preview, time, unread badge, `markedUnread`, mute, `presence` dot (green = online, nothing else), typing; swipe actions pin/archive/mute; new chat via `GET …/contacts?q`; groups (`POST /portal/messaging/groups`, photo, members, admins); calls tab (`GET …/calls`, missed count `…/tab-counts`).
- **Thread**: `GET …/conversations/{uuid}/messages?before=<seq>` (30 per page, `seq` is the ordering and dedupe key; `around=` for search jumps); bubbles with reactions (one per user, same emoji toggles off), stars, replies (`replyTo`), forward, edit own text within **10 min**, delete, read/delivered ticks (never downgrade), system lines (`group_created … call_missed`), typing (throttle 3 s, stop at 4 s idle, expire 7 s), draft per conversation (`PUT …/draft`), attachments staged first (`POST …/attachments`, ≤10 per message, 100 MB) then sent with a client `nonce` (`POST …/messages`), voice notes (record Opus/AAC ≤ 10 min with 60 waveform peaks, `voice=1, durationMs, waveform[]`), image editor before send, link previews (`GET …/link-preview?url`), info panel (`GET …/info`), gallery shelves media/documents/links (`…/gallery?shelf`), search (`GET …/search?q`), export, clear, leave, block. Empty thread copy: "No messages yet. Say hello." Toast copy on failures: "Could not copy message", "Could not update pin", "Could not forward message", "Could not play the recording", "Could not play this voice note", "Could not mark as unread".
- **Phone**: list **or** thread (the thread replaces the list; back returns; swipe eats in-bubble taps so keep swipe on the row edge only). **Tablet**: list + thread side by side; info panel as a third pane on expanded widths.
- **Calls** (WebRTC, signalled through `POST …/conversations/{uuid}/call`, events on `call.signal`): follow the numbered sequence in A7 §5 exactly (`ring` → `offer` → callee `state{ringing}` → `accept` → `answer` → `ice` both ways → `state` on connect and every toggle → `upgrade/upgrade-accept/upgrade-decline/downgrade` → `hangup` with `answered`). STUN only (`stun:stun.l.google.com:19302`), **no TURN** exists; flag to the firm that cellular/symmetric-NAT calls may fail. Add both an audio and a video transceiver up front; later switches are `replaceTrack`. Caller ring timeout 15 s, callee 30 s. Incoming call = a `CallStyle` full-screen-intent notification with Accept/Decline while the app is not in front (no separate window opens; accepting brings the app forward, mirroring `desktop/call-window.js`), the in-app incoming sheet when it is. In-call presentations: modal, compact, and the **floating window** = Android picture-in-picture for video (the desktop's document PiP), and a foreground service (`phoneCall|microphone|camera` types) for the duration; audio routing (speaker/earpiece/Bluetooth); screen share via `MediaProjection` → `replaceTrack` on the video sender + `state.screenSharing`. Report `POST /me/availability/call {active}`.
- **Client call recordings**: auto-record is a **server decision** (`POST …/conversations/{uuid}/recordings` returns `{recording:{id}}` only to the staff side of a client call, `{recording:null}` otherwise); both peers call it on connect; show the consent banner and send `state.recording:true` **1.5 s before** starting; upload 10-second chunks (`POST /recordings/{uuid}/chunks`, seq + chunk ≤ 16 MB) sequentially with one retry; `finish {durationMs, media}` after the last chunk, `finish {failed:true}` on abort; **stop the recorder before tearing down media** so the last chunk survives. The server forces WebM (`audio/webm`/`video/webm`, `CallRecordingController.php:196-198`); Android's `MediaRecorder` cannot write WebM/Opus from WebRTC tracks, so either implement an Opus/VP8 WebM muxer over the mixed local+remote tracks, or use the section-14 allowance to accept `audio/mp4`/`video/mp4` server-side. Decide in phase 9 and record the decision in this file.
- **Recordings page** (`/call-recordings`, `callRecordings.view`): `GET /portal/call-recordings?clientId&from&to&q&page`, playback via `…/{uuid}/media` with Range.
- **Realtime**: every event in section 10 item 6; subscribe every inbox conversation; `messaging.user.{id}` first. Fallback: 10 s poll of the list when the socket is refused.
- **Offline**: list and open threads from snapshots; sends, reactions, stars, read marks and drafts queue (nonce makes replay safe); attachments re-upload if the staged id expired (422 `attachments`); calls need network.
- **Checks**: two emulators (or emulator + phone) exchange messages with ticks progressing sent → delivered → read; a message sent in airplane mode lands once and only once after reconnect; a voice call connects on Wi-Fi both ways and survives an upgrade to video and back; a client-side recording shows "This call is being recorded" before the staff side starts recording; a missed call raises `call.missed` and a system line.

### 11.10 Email

Spec: `public/js/email.js` (read all), `email-api.js`. Appendix A5. Gate `mail.use` (employees; clients never). Requires a connected Google/Microsoft mailbox; connecting is a browser OAuth flow at `{origin}/auth/social/{google|microsoft}/redirect?sync_all=1&return=email` in a Custom Tab against the same session.

- **Bootstrap** `GET /portal/mail` → `connected`, `account`, `folders{total,unread}`, `preferences`, `labels`. Not connected: list empty state title "No emails yet", body "Connect your email account to get started.", button "Connect email account". **409 `reconnect:true`** anywhere = stop all polling, banner "This mailbox needs to be reconnected." with "Fix it".
- **Folder rail** order: inbox, important, starred, pinned, snoozed, sent, draft, spam, trash, archive, templates; counts from `folders` (drafts = total, others = unread). **Conversation list** `GET /portal/mail/messages?folder&page&perPage(25|50|100|200)&label` (grouping is a **server anti-join** when `preferences.conversationView`; expand arrow uses `threadCount>1` and `…/conversation`; the arrow must not open the message); row = avatar (`avatarUrl`, else initials), sender, subject, snippet, `sentAt` formatted in the reader's zone (ignore `time`/`dateLabel`), flags, attachment chips (hydrated via `POST …/hydrate-attachments` ≤40 ids). Swipe archive/trash; bulk (`POST …/bulk` ≤100 ids). Optimistic read/star with rollback (provider round-trip 400–2000 ms).
- **Thread** `GET …/messages/{uuid}/thread` (oldest first; only the opened message hydrated, fetch others per card when `bodyLoaded=false`); HTML body rendered script-less with cookies on `cid:` images (already rewritten to `/portal/mail/attachments/{uuid}?inline=1`); quoted history split with the same selector list as `email.js:6277-6328` and "Show quoted text" / "Hide quoted text"; on phones images capped to width, tables reflowed, quotes clamped 14/1.5; attachments download with the cookie; snooze (`PATCH {snooze}` ISO after now), labels (portal-only `localOnly`), pin, move, delete (permanent, bypasses trash).
- **Compose**: To/Cc/Bcc as **pill fields** (state stays the address string, typing survives re-render, commit the pill before send; typeahead `GET …/suggest?q`), subject, rich body, signature (`preferences.signatures[]`, `activeSignatureId`), templates picker (`GET /portal/mail/templates`), attachments base64 in JSON (≤10, ≤100 MB each), autosave draft `POST …/drafts` (800 ms debounce, only once the draft has substance), reply/reply-all/forward by `inReplyTo` + `mode`, **undo send** is client-side (`undoSendSeconds` 0–30, default 5, toast "Sending in N…"), success "Message sent", missing recipient "Add at least one recipient". Send `POST …/send`.
- **Search**: drawer and header share one popup that never rebuilds its input while typing; `GET …/messages?q&limit≤50[&live=0]` (no paging; `perPage` with a search is a 422).
- **Sync**: no realtime channel for mail. Poll while the Email screen is foregrounded: list every 2 s, `POST …/sync?fast=1` every tick for Gmail and every third for Microsoft, full `POST …/sync` every 30th tick; pause when hidden, disconnected, on Templates, or after a 409. Sync progress panel from `GET …/sync-status` (stages "Connecting account" … "Mailbox up to date", polled 3 s running / 10 s failed / 15 s after error, hidden 6 s after done).
- **Settings › Mailbox**: `GET/PUT /portal/mail/settings`, sign-out, import signature (`POST …/import-signature` → chooser → `…/apply`); copy "No mailbox connected" / "Connect your work email to read and send it here." / "Connected for reading only. Reconnect to send and organise mail." / "Last synced …" / "Not synced yet" / "Mail sync is off".
- **Phone** (`isEmailMobile` ≤ 1024): reading pane replaces the list; category strip hidden; refresh/bulk/label menus in the list head; nav and search in the slide-in sidebar; the mail rows own the left edge (no drawer swipe there). **Tablet**: rail + list + reading pane per `preferences.layout` (`split|single`) and `sidebarMode` (`full|icons|hidden`).
- **Offline**: first page of a plain folder and opened threads from snapshots; nothing writes offline (provider-first); compose keeps a local draft and shows "You’re offline".
- **Checks**: connect a mailbox, see the inbox within a minute; open a thread and see inline images with the cookie; send with an attachment and see it in Sent; a 409 stops the polling and shows the banner; the phone reading pane's reply bar sits above the keyboard.

### 11.11 Calendar

Spec: `public/js/calendar.js`, `calendar-colours.js`, `schedule.js`. Appendix A6 §1. Everyone; staff features gated by `calendar.staff`/`calendar.admin` and per-calendar roles.

- Views `month, week, work_week, day, agenda` (pref `calendarView`, default month; week grid 08:00–19:00 Monday start), calendars sidebar in sections `mine, people, group, shared, connected, imported` (`GET /portal/calendar/calendars`; members = permission, subscriptions = the user's own list with visible flag and colour override, `PUT …/subscription`), discover (`GET …/discover?q`), event window anchor −1..+2 months (`GET …/events?from&to`, ≤400 days), event editor (title, calendar, start/end, all-day, timezone, location, description, status, visibility, colour, meeting URL, recurrence `freq/interval/byDay/count|until`, guests invited **after** create via `POST …/attendees`, availability check via `…/availability`), respond (`accepted|tentative|declined`), complete toggle, series scope `this|following|all` (occurrence ids contain `@` — percent-encode; `DELETE` takes `scope` in the JSON body), ICS export/import/subscribe, provider sync (`…/sync/*`), sharing (`…/members`), history. Colour keys `blue, purple(=deep blue), green, teal, pink, red`.
- Time: send instants with offset (device wall time → ISO) like the web, or wall time + `timezone`; all-day snaps to midnight in the event zone; end must be after start (422 "The end time must be after the start time.").
- **Phone**: month grid with a day agenda below; week view scrolls horizontally; editor full-screen. **Tablet**: sidebar + grid.
- **Realtime**: `data.changed` `calendar` on `portal.staff` only — **clients get no calendar signal**; poll every 60 s while the screen is open for non-staff.
- **Offline**: grid snapshot for the loaded window; create/edit/delete/respond queue (optimistic with rollback on failure like the web).
- **Checks**: a recurring event edited with `following` splits the series; a hidden calendar's events disappear from `/events`; `purple` renders as `#136da0`; the Today badge count matches the grid.

### 11.12 Feed

Spec: `public/js/feed.js`, `feed-api.js`. Appendix A6 §3. Gate `feed.view`; every payload carries `can` — render from it.

- Channels list (`GET /portal/feed/channels`, unread, `My channels` client-side), channel header (avatar/cover, join/leave, members, membership mute + email frequency), posts (`GET …/posts?channel&before&view…`, 20 per page, `pinned` on page one), composer (types `discussion|question|praise|poll|announcement`, title, rich body with mentions as `data-mention="user:<id>"` markers from `GET …/mentionable`, hashtags, attachments staged via `POST …/channels/{uuid}/attachments` ≤20/post ≤5/comment, polls 2–12 options, schedule, acknowledgement, email audience), post card (reactions quick picks 👍 ❤️ 🎉 👏 😄 🤔 👀, counts, bookmark, share, acknowledge, pin/lock for moderators), **gallery viewer** for images (`state.gallery`), comments one level deep (`GET …/posts/{uuid}/comments`, keys scoped per post), poll vote/close/voters, search, analytics (`feed.analytics`).
- Empty/gone: 404 = channel no longer visible → remove locally.
- **Phone**: single column; composer full-screen; the gallery viewer edge-to-edge. **Tablet**: channels rail + feed + (expanded) details.
- **Realtime**: `feed.post.changed` on the open channel only.
- **Offline**: first page snapshot; posts/comments/reactions/votes queue; attachments re-stage on replay if pruned (24 h).
- **Checks**: an upload race that loses photos does not recur (`feed-module` lesson: attachments are staged and claimed, never sent inline); poll counts show `null` as hidden, not 0.

### 11.13 People and Users

Spec: `public/js/portal-people.js`, `users.js`, `person-card.js`, `user-info-panel.js`. Appendix A2 §8–9. Gates in 8.1.

- People home cards (`GET /portal/people/summary`): Browse employees "Manage employee accounts, permissions and personal folders.", Browse client contacts "The client accounts that can sign in to the portal.", Browse prospects "Invitations and the people who have not activated yet.", Shared address book "Account-wide contacts available to every employee.", personal address book, distribution groups (`/portal/groups`), resend welcome emails (`GET …/welcome-candidates`, `POST …/welcome`). Person rows with presence and last-active; contacts CRUD (`/portal/contacts?scope=shared|personal`); invitations (`/portal/invitations…`, every resend rotates the link).
- Users (`/users`, `users.view`): the whole table in one call (`GET /admin/users`), pending count badge, actions approve (with account type), deny, suspend, reactivate, send reset, generate password, reset 2FA, activity; `POST /admin/users` issues an **invitation**, never an account; a deleted user is soft-deleted into the recycle bin and holds its email hostage until purged.
- **Phone**: data-label cards; **tablet**: the table (this table is the pattern every other table copies).
- **Realtime**: `data.changed` `users`, `contacts`, `identity`.
- **Offline**: snapshots; contact edits queue.
- **Checks**: approving a pending user sends them the approval email (inline, not queued); the last active administrator cannot be demoted (422 copy shown verbatim).

### 11.14 Notifications and Activity

Spec: `public/js/notify-store.js`, `notify-render.js`, `notify-realtime.js`, `activity-popups.js`. Appendix A2 §5. Everyone.

- Bell popover and full list (`GET /portal/notifications?cursor&limit≤50`, filters unread/actionRequired/module/type/level/search; id cursor descending, `nextCursor:null` = done), count (`…/count` → `{unread, actionRequired}` is the badge's source of truth), read/unread/complete/read-all/bulk/delete. Item: icon (Phosphor name), title, message, actor avatar or `image`, `actionUrl` + `actionLabel`, `requiresAction`, `level` tone (`info|success|warning|error|action_required|approval_required|security|reminder`). Failure copy "Could not load. Try again.". Types and icons: `app/Support/Notifications/NotificationType.php` (email.*, message.*, call.missed, calendar.*, file.*, folder.*, signature.*, client.*, company.*, cip.*, account.*, security.*).
- Toasts obey `/me.toasts` (position, duration 3/5/8/10, stickyImportant, sound, previewText, groupSimilar). OS notifications: section 12.
- Preferences (`GET/PUT /portal/notifications/preferences`): groups `email, messages, calendar, files, signatures, clients, groups, feed, approvals, security, system` × channels `portal, email, desktop, sound`; `security` and `approvals` are locked on for `portal`. Map `desktop` to "Device" (Android OS notifications).
- Activity (`GET /portal/activity…`, `…/count`, `POST …/seen`, `…/filters`): the log with module/type/status filters; non-`activity.viewAll` viewers see only their own.
- **Offline**: last 50 cached; read marks queue.
- **Checks**: badge equals `/count.unread` after any action; `notification.created` prepends without a refetch; deep link from a notification lands on the right screen (8.4).

### 11.15 Settings (all pages incl. Security, Storage usage, Templates, Admin)

Spec: `public/js/settings.js`, `account.js`, `portal-admin.js`, `security settings` in `settings.js`, `TMAPrefs` write-through. Appendix A2 §2–3, §7, §9. Pages and gates in 8.3. Mount once per visible instance (the web mounts twice; scope to the visible one).

- **Profile**: `GET /me/profile`, `PUT /profile` (JSON only with `Accept`), photo `POST /me/avatar` (upload ≤8 MB jpeg/png/webp or `source:provider`), initials fallback; errors verbatim "That file is not an image. Use a JPG, PNG, or WebP." etc.
- **Theme**: `themeMode` system/light/dark (Light, Dark, System labels), `accentColor`, `fontScale`, sidebar style Standard / Hover Overlay (`sidebarStyle`, tablets only; phones ignore).
- **Time and language**: `autoTimezone`, `timezone`, `language` (`auto, en, es, fr, zh-hans` — only shipped languages are offered; dictionary keys are the English strings verbatim, `public/js/i18n/*.js`), `voice`.
- **Notifications**: 11.14 preferences + toasts + `notifyAlwaysEmail`.
- **Privacy**: messaging settings (`GET/PUT /portal/messaging/settings`: `onlineStatus`, `lastSeen` (Everyone / People I message / Nobody), `readReceipts`, `typingIndicator`, sounds, `messageTone`, `ringtone`, `desktopNotifications`, `notificationPreview`, `enterToSend`, `mediaAutoDownload`, `voicePlaybackSpeed`, `callDisplay`) + the native app lock (5.5).
- **Account security**: `GET /security-settings/data`; sessions addressed by digest (revoke cycles `remember_token`), trusted devices, phone, alerts, password set (only when auto), 2FA enrolment via Fortify routes in a Custom Tab (needs password confirmation), "Log out other devices". The HIBP check rejects weak passwords with Fortify's messages.
- **Connectors**: `GET /admin/connectors`, `GET /me/sync-status` (email/calendar/onedrive/smartsheet states), OneDrive pause/resume; connect buttons open the OAuth Custom Tab.
- **Admin pages**: Background Operations (`/admin/background-ops…`), Notification History, Branding (`GET /admin/branding` readable by everyone; branding must not own the app title), Client hub Access/Service teams/Custom fields/CIP document requirements/letters/distribution/Administrator, Security Insights/Sign-in policy/Security policy/Alert settings/Device security (`/admin/security-policies`), Usage (`GET /admin/storage-usage` — real bytes; the limit is a licence figure, never metered), Permissions (`/admin/permissions`), Default Folders and Folder Templates (`/portal/file-library/…`), Templates (system emails `GET /portal/templates/system-emails`, compose templates `…/email-templates`, letters, document requirements). Phone: one page per screen with the rail as a list; tablet: rail + page.
- **Offline**: preference writes queue through one write-through path (the app's `Prefs` repository), everything else read-only from snapshots.
- **Checks**: a preference changed on the phone appears in the web after reload and vice versa; the settings rail shows only gated sections after a capability change arrives over `identity`.

### 11.16 Search

Spec: `public/js/global-search.js`, `portal-search-index.js`. There is **no server search endpoint**: reproduce the fan-out. Static index = nav items + settings pages filtered by capabilities; on ≥2 chars fan out to `GET /portal/files?section=all&search=&perPage=12&lean=1`, `GET /portal/clients/search?q&limit=12` (`clients.view`), employees (`GET /portal/people/employees` or `/admin/users`, cached, filtered locally), `GET /portal/signatures?search=`, `GET /portal/mail/messages?q&limit=8&live=0`, `GET /portal/messaging/search?q`, `GET /portal/cip/requirements`, `GET /portal/cip/applications?q&perPage=8`; empty palette = `GET /portal/clients/preview?limit=5&sort=latest` + recent files; de-duplicate by id. Phone: full-screen search; tablet: the header popup. Offline: static index + replica name matches only.

---

## 12. Desktop behaviours and their Android equivalents (badge, OS notifications, incoming-call panel, updates, file cache, local settings)

From `desktop/README.md`, `main.js`, `host-bridge.js`, `badge.js`, `notifications.js`, `call-window.js`, `settings.js`, `updater.js`, `file-cache.js`, `shell-cache.js`.

| Desktop behaviour | Exact rule | Android equivalent |
|---|---|---|
| Dock/taskbar badge | number = unread notifications + new activity (`host-bridge.js:21-30`); red `#d21c1c` overlay (`badge.js`) | `NotificationManager` badge count via the summary notification's `setNumber`; launcher badge follows automatically on launchers that support it. Source of truth: `/portal/notifications/count.unread` + `/portal/activity/count.new` |
| OS notifications | raised by the notification store only when the window is not focused and the module's `desktop` channel is on; body hidden when `notificationPreview` is off; click brings the app forward at the item's `actionUrl` | `NotificationCompat` with one channel per module group (`email, messages, calendar, files, signatures, clients, groups, feed, approvals, security, system`), `desktop` channel preference = "Device"; preview off → title only; tap = deep link (8.4); grouped per module |
| Incoming-call panel | small always-on-top panel naming the caller with Accept/Decline; does not open the app; app comes forward only if answered; no panel when already focused; display sleep blocked while ringing/active | `CallStyle` notification with full-screen intent (`USE_FULL_SCREEN_INTENT`), ringtone from messaging settings (`ringtone-1`, `ringtone-2`, `none`), vibrate; Accept/Decline call `accept()`/`decline()` on the same code path as the in-app buttons; foreground service (`phoneCall`) + `WakeLock`/`keepScreenOn` while ringing/active; in-app sheet when the app is in front |
| Keep running when the window closes / tray | app stays alive for the socket and badge | Not applicable. The app keeps the socket only while foregrounded (section 10 item 10); background delivery is push (section 13) |
| Launch at login | local setting | Not applicable |
| Ring in a separate window | local setting | Not applicable; the CallStyle notification is the equivalent |
| Blue title bar drawn by the shell | `#136da0` caption | System status bar coloured `#136da0` on the splash only; elsewhere the page background with light icons |
| Shell cache | boots from the last served shell; gates on session cookie, deploy build, `/me` watchdogs | Section 6.2 warm boot + watchdogs. No "deploy moved" gate is needed: the app ships its own UI |
| Asset cache | serves bundles unverified when offline | Not applicable |
| Document-byte cache | 512 MB LRU-by-use, network first, cleared on sign-out/account change | Section 9.5, identical rules |
| Right-click menu | text editing, links, images | Native selection toolbar and long-press menus; `Copy link` / `Open in browser` on links; `Save image` on images |
| Spellcheck | Chromium | the keyboard's |
| Sign-in handoff | `tmaportal://` + PKCE | Section 5, identical |
| External links | portal origin in-app; everything else in the system browser; only the OAuth hosts (`accounts.google.com`, `login.microsoftonline.com`, `login.live.com`, `oauth.googleusercontent.com`) may load in-app for connecting a mailbox | Portal paths in-app (8.4); OAuth hosts and everything else in a Custom Tab |
| Pop-out compose / mail windows | separate `BrowserWindow`s | full-screen routes (`/email/compose`) |
| Auto-update | `updater.js` polls `/desktop/releases` (`{mac:{available,version,minOs,url},windows:{…}}`, `DesktopReleasesController.php`), downloads, installs on relaunch | Google Play internal testing track for staff; optionally the same feed extended with an `android` platform (section 14) so the app can offer "A new version is available" with an APK download for sideload installs. In-app update UI copy: keep it to one sentence |
| Window state, About panel, taskbar pin | macOS/Windows chrome | Not applicable |
| `backgroundThrottling: false` so the socket survives | Electron flag | foreground service **only during calls**; otherwise accept background disconnect |
| Power save blocker during calls | `powerSaveBlocker` | `WakeLock` + foreground service as above |

---

## 13. Push notifications (backend addition spec, clearly marked as new work)

**Status today: there is no push infrastructure.** A repo-wide search for FCM, Firebase, APNs, web-push, device tokens and push subscriptions finds nothing; the web and desktop hear events only while a window holds the websocket (appendix A8 §6). Without this addition the Android app cannot ring for a call or show a notification while it is not in the foreground. Build it in phase 13 under the rules of section 14.

**Backend (new):**

1. Migration `device_tokens`: `id, user_id (fk, cascade), platform ('android'), token (unique), app_version, device_name, last_seen_at, created_at, updated_at`.
2. Routes inside the portal group: `POST /me/devices {platform, token, appVersion, deviceName}` (upsert by token, 201/200 `{ok:true}`), `DELETE /me/devices/{token}` (`{ok:true}`). Sign-out on the device deletes its token; a 401 on any push-driven fetch deletes it too.
3. `app/Support/Notifications/Push.php`: sends **data-only** FCM messages (HTTP v1 API, service-account credentials from `FCM_CREDENTIALS_JSON` / `FCM_PROJECT_ID` env, never committed) with the **same payload the websocket carries**: for `notification.created` → `{kind:'notification', notification:{…NotificationPresenter}, unread}`; for a call `ring` → `{kind:'call', signalId, conversationId, fromUserId, fromName, fromPhoto, media}` with `priority: high` and a 30 s TTL; for `hangup`/`reject` → `{kind:'call-end', signalId, conversationId}`. Hook it where the websocket events are fired (`Notifier::notify` after `event(new PortalNotificationCreated)`, and `MessagingController::call` for `ring`/`hangup`/`reject`). Send **synchronously in the request** (like the account lifecycle emails), not through a queue, because the queue worker is not something the firm can rely on being alive; wrap in try/catch, log, never fail the request.
4. Honour the user's notification preferences: only groups whose `desktop` channel is on get a push (the Android app maps `desktop` to Device); muted conversations never push; `security` and `approvals` always do.
5. Remove tokens FCM reports as `UNREGISTERED`.
6. PHPUnit: token upsert/delete, payload shape, preference gating, the call ring path.

**Android:** `FirebaseMessagingService` registering the token after `/me` succeeds and on token rotation; `kind:'notification'` → store + OS notification via 11.14/12 rules (no fetch needed); `kind:'call'` → start the call foreground service and post the `CallStyle` full-screen notification, then connect the socket to receive `offer` and the rest of the signalling (the caller's 15 s timeout is short; make the socket connect fast on this path); `kind:'call-end'` → dismiss. Firebase project and `google-services.json` are the firm's; the file is gitignored and injected in CI.

---

## 14. Backend changes allowed and forbidden

**Allowed** (each as its own commit with PHPUnit coverage, and the web + desktop must keep working unchanged):

1. Section 13's device tokens, `/me/devices`, and the push hook.
2. A static `public/.well-known/assetlinks.json` for App Links (`package_name: com.tmantoinelaw.portal`, the release signing certificate's SHA-256).
3. Optional: an `android` platform in `DesktopReleasesController` (`latest-android.yml` + APK on the releases disk) so the app can offer sideload updates through the existing feed.
4. Optional, only if the firm agrees: accept `audio/mp4`/`video/mp4` in `CallRecordingController::finish` so Android can record with `MediaRecorder`; otherwise ship a WebM muxer.
5. Optional, only if the firm buys TURN: a `GET /portal/messaging/ice` endpoint returning ICE servers, and make `messaging-calls.js` read it too. Do not hard-code TURN credentials in the app.

**Forbidden**: introducing token auth (Sanctum/JWT) or any second auth path; changing capability rules or `Role::MATRIX`; changing an existing response shape or status code; a new queue without adding it to the worker's queue list; anything that writes to production data from a developer machine (the `.env` in this repo points at the live Laravel Cloud Postgres; use the Docker stack, which masks it); `migrate:fresh` and friends anywhere.

---

## 15. Build order (phases with acceptance criteria)

Finish each phase's checks on the phone, tablet and foldable AVDs, in light and dark, before starting the next.

| Phase | Build | Accept when |
|---|---|---|
| 0 Scaffold | `android/` Gradle project, modules (4.1), theme from tokens (7), Inter, icon map, splash (6.1), Docker build image and `android/compose.yaml` (3.3), CI job that runs the container build and unit tests, `.gitignore` entries | `docker compose -f android/compose.yaml run --rm build` yields an APK that shows the splash and a placeholder; the theme screenshot matches the web's tokens side by side |
| 1 Network and auth | OkHttp client, cookie jar, CSRF/Accept/UA/Socket-ID interceptor, error mapping (5.3), sign-in handoff (5.1), `/me` cache and watchdogs, sign-out, app lock | Sign in on the emulator against Docker with the seeded admin via the Custom Tab; kill the app; relaunch shows the dashboard route without the browser; sign out clears everything but the queue |
| 2 Shell | NavHost, drawer/rail by size class, header, capability gating from `/me`, deep links (8.4), settings hub skeleton, boot sequence with skeleton and offline notice (6) | A client account sees no staff nav; App Links open the right screen; a cold start in airplane mode with a cached `/me` opens without an error screen |
| 3 Realtime and notifications | `RealtimeClient` (10), notifications module (11.14), OS notifications and badge (12), toasts | Two devices: a notification created for one appears on it within a second with the badge equal to `/count`; reconnect after network loss re-auths every channel and refetches |
| 4 Dashboard and Overview | 11.1, 11.2, snapshot infrastructure (9.1 warm boot) | Airplane-mode cold start paints yesterday's board with no skeleton |
| 5 File Library | 11.6 in full, files replica walker, byte cache, chunked uploads, the one viewer | `files-cached-listing` and `files-replica` behaviours pass offline; a killed upload resumes; a PDF renders in the viewer without a WebView |
| 6 Clients hub | 11.3, clients replica | Directory of 11k rows pages; a profile opens offline; a queued edit lands after reconnect |
| 7 CIP and the write queue | 11.4, CIP replica, the full queue (9.4) with the sync pill (9.6) | The `cip-offline` round trip passes; a 422 during replay parks the entry with Try again / Discard and does not block later entries |
| 8 Messages and presence | 11.9 without calls | Ticks progress across two devices; a message sent offline lands exactly once |
| 9 Calls and recordings | 11.9 calls, `CallStyle`, PiP, foreground service, recordings | Voice and video calls connect on Wi-Fi both ways; upgrade/downgrade works; a client call is recorded on the staff side only, with the banner first |
| 10 Email | 11.10 | Inbox, thread with inline images, compose with attachment, search, sync panel, 409 banner |
| 11 Calendar and Feed | 11.11, 11.12 | Recurring edit scopes; hidden calendars; feed attachments staged and claimed; gallery viewer |
| 12 The rest | 11.13 People/Users, 11.7 Signatures, 11.8 Workflows, 11.15 all settings pages, 11.16 Search, 11.5 CBI | Every nav item and settings page in 8.1/8.3 opens; search fan-out matches the web's results for the same query |
| 13 Push and release | Section 13 backend + app, `assetlinks.json`, dark audit, tablet/foldable pass, Maestro suite (16), Play internal testing, optional release feed | Section 16 fully green |

---

## 16. Definition of done and verification checklist

**Constraint checks (fail any = not done):**

- [ ] No `android.webkit.WebView` anywhere in `android/`; the only browser dependency is `androidx.browser` (Custom Tabs). No Capacitor, Cordova, React Native, Flutter, or PWA manifest.
- [ ] Every screen in 8.1 and 8.3 is native Compose and reachable by nav and by deep link.
- [ ] Theme values are read from one `Tokens.kt` generated from `design/tokens.json`; no hard-coded colours in feature modules.
- [ ] No endpoint is called that is not in `docs/android-api-catalogue.md`; no backend change outside section 14.

**Parity with the desktop:**

- [ ] Splash matches 6.1 (colour, lockup, bar, timings, fade) and never reveals a half-built screen.
- [ ] Cold start in airplane mode with a signed-in account opens on the replica with no error screen; Dashboard, a browsed folder, a client profile, a CIP application, the conversation list and the inbox's first page all paint from local data.
- [ ] Offline writes: CIP edit, message send, file rename, calendar event, feed reaction, preference change each queue, show "Saved on this device" / the pill, and land exactly once on reconnect; a server refusal parks with Try again / Discard.
- [ ] Realtime: every event in section 10 item 6 is handled; `X-Socket-ID` is on every write; reconnect refetches.
- [ ] Badge and OS notifications follow section 12; incoming calls ring via `CallStyle` when backgrounded (after phase 13) and via the in-app sheet when foregrounded.
- [ ] Calls: voice, video, upgrade/downgrade, screen share, PiP, recordings per 11.9.

**Responsiveness:**

- [ ] Phone, tablet and foldable AVDs each pass a walk through every module in both themes; folding/unfolding mid-screen keeps state.
- [ ] Nothing important ellipsises; wide tables scroll inside their container; the reply/compose bars sit above the keyboard.

**Quality:**

- [ ] Unit tests: cookie/CSRF interceptor, error mapping, realtime frame parser and backoff, queue ordering/parking/replay, replica cursor upsert and tombstones, initials avatar rule.
- [ ] Compose UI tests: boot sequence (splash → warm paint → refresh), one screen per module.
- [ ] Maestro flows: sign-in handoff, airplane-mode round trip (CIP edit and message send), incoming call accept.
- [ ] `docker compose -f android/compose.yaml run --rm build` is green in CI on every push; lint and detekt clean.
- [ ] Accessibility: TalkBack labels on every control, 48 dp touch targets, contrast checked in both themes.
- [ ] Security: cookie jar and verifier encrypted at rest; no secrets in the repo; release build HTTPS only; `assetlinks.json` verified.
- [ ] This file and `docs/android-api-catalogue.md` updated wherever the code taught you something different, with the commit saying so.

## 17. Field notes from the first emulator run (6 Sep 2026)

What the code taught us that the sections above did not say. Keep these true.

- **Every OkHttp body read or close runs on `Dispatchers.IO`.** `PortalHttp` wraps each call in `withContext(IO)`; `raw(request) { response -> }` closes the response after the block. Closing a chunked 302 on the main thread throws `NetworkOnMainThreadException` and kills the process, and it only shows up on a device — unit tests with MockWebServer never see it.
- **A 401 must not wipe a session it did not test.** `CsrfRetryInterceptor` emits the cookie-jar `generation` the request left with; `SessionRepository` forgets the session only when the jar still holds that generation. Without this, a notifications poll that left while signed out landed after the sign-in claim and erased the fresh cookies. Pollers (`ForegroundWatcher`, `NotificationsRepository.catchUp`) no-op while nobody is signed in.
- **Sign-in claim success is a 302 whose Location path is `/`.** Every refusal is a 302 to the sign-in page; do not test for a path name.
- **The listing facets are strings.** `GET /portal/cip/applications` → `assignees[].id` is `"none"` or `"3"`, with a `count`; `AssigneeDto.id: String?` plus `userKey` for the number. `investmentType` is `""` when unset, not null.
- **`Client::toRecord().profile` is `[]` when empty** (PHP's empty array). Model it as `JsonElement?`, read it as an object when it is one.
- **CIP status tones** go beyond the five portal tones: sky, indigo, violet, amber, teal, orange, rose, cyan, copper, emerald, slate, lime, navy, gold, plum, success, action, danger, neutral, pending. `core/ui` `toneColour` maps them.
- **Docker stack:** CIP ships dark; `.env.docker` needs `FEATURE_CIP=true` and the app container must be recreated (`TMA_APP_PORT=8002 docker compose up -d app`). The new-device sign-in code is only in `docker compose logs app` (mail is the `log` mailer; the rendered mail carries `000000` placeholders, the real six digits sit on their own line). Tick "Trust this device" once.
- **Emulator:** AVD `tma_phone` (android-36 google_apis arm64, Pixel 8). Chrome's first run must be dismissed once ("Use without an account") before a Custom Tab shows anything. Install with `./gradlew :app:installDebug -PportalOrigin=http://10.0.2.2:8002`.
