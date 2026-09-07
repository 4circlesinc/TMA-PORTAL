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

## 4. Architecture as built (6 Sep 2026): the desktop shell's twin

**This section replaces the original §4–§11, which described a native-Compose
recreation of every screen. That approach was built through the CIP hub and
rejected: it was "way different" from the web's responsive layout, which is
the layout the firm wants on the phone. The app is now what the Mac app is.**

The window loads the portal origin in a WebView. The page is the portal's own
HTML, CSS and JS — the same bundle a browser gets, so the phone layout is the
web's responsive layout with nothing recreated. The Kotlin host adds only what
a browser tab cannot do, mirroring `desktop/main.js` piece by piece:

| Concern | Desktop | Android |
|---|---|---|
| Window | `BrowserWindow` + `preload.js` | `app/src/main/kotlin/com/tmantoinelaw/portal/web/PortalWebHost.kt` |
| Page-side bridge | `preload.js` (`window.TMADesktop`, `<html data-tma-*>` relays), `host-bridge.js` | `app/src/main/assets/preload.js` (same `TMADesktop` object plus `isAndroid`, same relays → `TMAAndroidHost.relay`, `window.Notification` polyfill); `host-bridge.js` and `signin-waiting.html` copied from `../desktop` by the Gradle task `copyDesktopBridge` |
| Navigation rules | `attachNavigationRules`, `signin-provider.js` | `web/NavigationRules.kt`: portal + OAuth hosts in-app, social sign-in from the sign-in page → real browser (PKCE handoff), everything else → Custom Tab |
| Sign-in handoff | `startBrowserSignIn`, `claimBrowserSession`, `tmaportal://` | `core/data/auth/SignInHandoff.kt`; claimed cookies pushed into `CookieManager`; email sign-in happens inside the WebView |
| Offline boot | `shell-cache.js` | `web/ShellCache.kt`: last served shell (marker `tma-shell:`) per `GET /desktop/build`, served for navigations while offline; `WebSettings.cacheMode` flips to cache-else-network offline |
| Offline / error pages | `showOffline`, `showLoadError` | `web/OfflinePages.kt`, verbatim |
| Loading layer | `splash.js` | `core/ui/splash/BootSplash.kt` until `onPageFinished` |
| OS notifications | Chromium `Notification` | polyfill → `web/WebNotifications.kt` (channel "portal"); a tap brings the app forward and calls the page's `onclick` |
| Media permissions | `setPermissionRequestHandler` | `onPermissionRequest` → RECORD_AUDIO / CAMERA runtime permissions |
| Downloads / uploads | Chromium | `DownloadManager` with the page's cookies; `onShowFileChooser` |
| Call phase | `applyCallPhase` (panel, dock bounce, power blocker) | `data-tma-call` + `data-tma-call-info` → `web/CallNotifications.kt` (CallStyle, Accept/Decline) and `web/CallService.kt` (foreground service, microphone + camera); screen stays on |
| Theme | `tma:theme` | `data-theme` → status bar icon colour |
| Deep links | `tmaportal://auth`, argv | `tmaportal://auth` → claim; https App Links → `webView.loadUrl` |

Offline data is the page's own: `TMADesktop.isDesktop` is true, so
`portal-store.js` keeps its IndexedDB tier and `portal-queue.js` parks writes,
exactly as on the desktop. No Room, no replica, no native write queue.

What remains native: `core/network` (config, cookie jar, CSRF interceptor,
`PortalHttp` for the handoff claim and the shell capture), `core/data/auth`
and `core/data/prefs`, `core/ui` (tokens, boot splash), and the host.

Verified on the `tma_phone` AVD against the Docker stack: sign-in, dashboard
identical to the web's phone layout, drawer, offline boot with the radio off.

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

## 13. Push notifications — built (7 Sep 2026); needs a Firebase project to switch on

**Backend (in place):** migration `device_tokens`; `POST /me/devices {platform:'android', token, appVersion, deviceName}` (upsert by token, the last sign-in owns the device) and `DELETE /me/devices/{token}`; `App\Listeners\ForgetDeviceTokensOnLogout` drops what the ending session registered. `App\Support\Notifications\Push` sends **data-only** FCM messages with the same payload the websocket carries: `{kind:'notification', notification:<NotificationPresenter JSON>, unread}` beside every `notification.created`, gated like the desktop banner (groups whose `desktop` channel is on; `security` and `approvals` always), and `{kind:'call', signal:<call.signal JSON>}` to every unmuted recipient of a `ring`, TTL 30 s. `FcmClient` speaks the HTTP v1 API with a service account and drops tokens FCM reports as `UNREGISTERED`; `App\Jobs\SendPush` runs on the queue. Nothing is attempted while unconfigured. Tests: `tests/Feature/PushNotificationsTest.php`.

**Android (in place):** `TmaApp` initialises Firebase from build values (no `google-services.json` needed); `web/PushRegistrar.kt` posts the token with the page's own cookies after a portal page loads with a session, and on rotation; `web/PushService.kt` shows `notification` pushes in the shade (the page's tap handling) and `call` pushes as the CallStyle notification with the foreground service — both only while the app is not in front, since in front the socket already has it.

**To switch it on:**

1. Firebase console → create a project → add an Android app with package `com.tmantoinelaw.portal`. Note from its config: Project ID, App ID (`1:…:android:…`), API key, Sender ID (project number).
2. `android/firebase.properties` (gitignored): `projectId=… appId=… apiKey=… senderId=…` — or pass `-Pfirebase.projectId=…` etc. Rebuild.
3. Firebase console → Project settings → Service accounts → generate a private key (JSON). On Laravel Cloud set `FCM_PROJECT_ID` and `FCM_CREDENTIALS_JSON` (the JSON itself, or a path). The queue worker must be running (it is on Cloud).
4. Verify: sign in on the phone, background the app, have someone message you; the shade shows the notification and a call rings the phone.

## 14. Backend changes allowed and forbidden

**Allowed** (each as its own commit with PHPUnit coverage, and the web + desktop must keep working unchanged):

1. Section 13's device tokens, `/me/devices`, and the push hook.
2. A static `public/.well-known/assetlinks.json` for App Links (`package_name: com.tmantoinelaw.portal`, the release signing certificate's SHA-256).
3. Optional: an `android` platform in `DesktopReleasesController` (`latest-android.yml` + APK on the releases disk) so the app can offer sideload updates through the existing feed.
4. Optional, only if the firm agrees: accept `audio/mp4`/`video/mp4` in `CallRecordingController::finish` so Android can record with `MediaRecorder`; otherwise ship a WebM muxer.
5. Optional, only if the firm buys TURN: a `GET /portal/messaging/ice` endpoint returning ICE servers, and make `messaging-calls.js` read it too. Do not hard-code TURN credentials in the app.

**Forbidden**: introducing token auth (Sanctum/JWT) or any second auth path; changing capability rules or `Role::MATRIX`; changing an existing response shape or status code; a new queue without adding it to the worker's queue list; anything that writes to production data from a developer machine (the `.env` in this repo points at the live Laravel Cloud Postgres; use the Docker stack, which masks it); `migrate:fresh` and friends anywhere.

---

## 15. Build order — status

| Phase | Status |
|---|---|
| Host: WebView over the origin, preload bridge, navigation rules, loading layer | done |
| Sign-in: email in-page; social via PKCE handoff and Custom Tab; cookies to the page | done (social untested locally — no OAuth in Docker) |
| Offline boot from the kept shell; page-side store and queue | done |
| OS notifications from the page's `Notification` | done |
| Downloads, uploads, camera/mic permissions, deep links, back | done |
| Incoming-call notification (Accept/Decline → `TMAMessagingCalls.accept()/decline()`), foreground service during calls | done (CallStyle notification when the app is not in front; the page rings itself) |
| Push (§13 backend addition, FCM token registration) | to do |
| `assetlinks.json`, release signing, Play internal track | to do |

## 16. Field notes

- A WebView inside Compose's `AndroidView` needs explicit `LayoutParams(MATCH_PARENT, MATCH_PARENT)`; otherwise Chromium resolves every `vh`/`dvh`/`svh` unit to 0 while `innerHeight` is right, and the dashboard is laid out but never painted (`.tma-dash` height 0).
- Every OkHttp body read or close runs on `Dispatchers.IO`; a 401 forgets the session only when the cookie-jar generation matches the request's.
- The new-device sign-in code in the Docker stack is only in `docker compose logs app` (mail is the `log` mailer); CIP needs `FEATURE_CIP=true` in `.env.docker`.
- Debug builds enable `WebView.setWebContentsDebuggingEnabled`; `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` and a Node script (global `WebSocket`) can evaluate JS in the page.
