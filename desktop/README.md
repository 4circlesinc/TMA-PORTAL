# TM ANTOINE Portal — macOS app

A native shell around the hosted portal. It is not a second copy of the app:
the window loads `https://portal.tmantoinelaw.com`, and this folder only adds
what a browser tab cannot do — a dock badge, a call that rings the dock, OS
sign-in, and updates that install themselves.

```
npm start           # run against production
npm run start:local # run against http://localhost:8001
npm test            # verify the page → shell bridge, and update logic
npm run test:call   # verify the incoming-call panel
npm run test:update # drive a real update against the build in release/
npm run dist        # build .dmg, .pkg and .zip into release/
npm run icon        # rebuild assets/icon.icns from the icon master
```

> Launching from a VS Code or Cursor terminal fails silently: those terminals
> export `ELECTRON_RUN_AS_NODE=1`, which makes the `electron` binary run as
> plain Node. The npm scripts strip it. Finder and a normal Terminal are fine.

## How the pieces fit

The page and the shell run in separate JavaScript worlds — they share the DOM
but not globals — so everything crosses on attributes of `<html>`:

| Attribute | Written by | Does |
|---|---|---|
| `data-tma-badge` | `host-bridge.js` | dock badge: unread notifications + new activity |
| `data-tma-call` | `public/js/messaging-calls.js` | `ringing` bounces the dock; `ringing`/`active` blocks display sleep |
| `data-tma-focus` | `host-bridge.js` | page called `window.focus()`; brings the app forward |

`preload.js` relays them over IPC and `main.js` acts on them. `npm test`
drives the whole chain with a fake page.

## Incoming calls

A ringing call opens a small panel in the top-right corner naming the caller,
with Accept and Decline — it does not open the app. The app only comes forward
if the call is answered.

The panel is its own `BrowserWindow` ([call-window.js](call-window.js)) because
it has to float above full-screen apps and across Spaces, which the portal page
cannot do from inside the main window. It shows with `showInactive()` so a call
never steals the keyboard mid-sentence.

It has no portal session of its own: Accept and Decline go over IPC to the main
process, which calls `TMAMessagingCalls.accept()` / `.decline()` on the page
that owns the call, landing on the same code paths as the in-page buttons.

If the app is already focused, no panel appears — the page's own call UI is
right there, and a second one on top of it would just be in the way.

## Menu and app settings

The menu carries ⌘1…⌘9 for the nine main areas (Go), Back/Forward, ⌘, for
portal settings, and an **App Settings** submenu under the app menu with three
switches that belong to this Mac rather than the account — anything about the
person already syncs through `/me/preferences`, so these stay local in
[settings.js](settings.js):

| Setting | Default | Off means |
|---|---|---|
| Launch at Login | off | — |
| Keep Running When Window Closes | on | the red button quits, like a plain window |
| Ring Calls in a Separate Window | on | a call surfaces the main window instead |

Toggling one rebuilds the menu, so every checkbox reflects what is actually
stored.

## When a request fails, it must say so

`protocol.handle` takes a promise, and a promise that **rejects** is a handler
that failed — Chromium cannot tell what went wrong, so it reports the only
thing it can: `ERR_UNEXPECTED`. `net.fetch` does not throw, it rejects, so the
try/catch that looked like it covered this never did. Every ordinary network
failure in the app — dropped wifi, a DNS blip, the portal between deploys —
reached the window with its name taken off, and the error screen read
"Can't reach the portal / ERR_UNEXPECTED".

Answering `502` instead of rejecting is what lets the app's own error page say
something true. If you touch [asset-cache.js](asset-cache.js), keep the
`.catch()`.

Two Electron facts that constrain anything you do there:

- `net.fetch` with `redirect: 'manual'` **throws** (`Redirect was cancelled`)
  rather than returning an opaque redirect, and with `follow` it reports
  neither `redirected` nor a final `url`. So a navigation that redirects shows
  the right page at the *original* address — `/` displaying the sign-in page.
- `net.request` *does* expose the redirect, and **ignores**
  `bypassCustomProtocolHandlers`: called from inside the handler it re-enters
  it until the process dies with SIGTRAP. It is not an option here.

Both go away when the app stops navigating to a website — see the shell notes.

`npm run test:navigation` is the guard, and it points at **production** on
purpose: the handler is registered for https and the dev server is http, so
against localhost this code is not in the path at all. No local test can cover
it.

## The shell cache — the app opens before the network answers

The turn away from "a window that navigates to a website": the last shell the
portal served is kept on disk ([shell-cache.js](shell-cache.js)), and a
navigation is answered from there in under a millisecond. The window opens ON
the portal — the network's remaining job is data. It is the byte-for-byte
document the server sent, capabilities inlined and all, captured whenever a
navigation carries the `tma-shell:` marker; never a copy we compose.

Three gates at serve time, and two watchdogs after:

- **A session cookie must exist** — a stranger gets the network and its
  sign-in bounce.
- **The path's first segment must have served the shell before** — `/auth/*`
  and friends never carried the marker, so they are never answered from disk.
- **The deploy must not have moved** — the copy is stamped with the build it
  was captured under; verification learning of a deploy drops it and reloads
  the window if it is already on screen (a stale shell references bundles the
  new deploy may not serve: a broken page, not a slow one).
- `/me` answering **401/419** after a disk-served shell means the session died
  behind the cookie → drop and reload. `/me` naming a **different account**
  means the inlined capabilities on screen are somebody else's → drop and
  reload.

Verification itself moved out of the startup path: `install()` registers the
protocol handler synchronously and verifies against `/desktop/assets` in the
background. Asset requests hold for that answer (a stylesheet 300ms late costs
nothing; unverified against a moved deploy costs a broken page) — navigations
and the cached shell do not.

**And one deliberate loosening:** when the portal is *unreachable* — offline,
not answering-badly — the bundle is served unverified. Offline there is no API
to be stale against, and the strict alternative was the app refusing to open
with 2,000 usable files on disk. The moment a manifest can be fetched, the
per-file gate is back. `test-asset-cache.js` pins both halves;
`test-shell-cache.js` pins every gate and watchdog above.

## The document-byte cache

[file-cache.js](file-cache.js): previews and thumbs are kept on this machine
(userData/file-cache, 512 MB default, least-recently-USED evicted), so a
document somebody has looked at opens again with no network. It lives in the
protocol handler, not portal JS, because the viewer never fetches — it renders
`<img src>` / `<iframe src>` / `<video src>`, and the handler is the only
place all of those pass through. **Network first, always**: a file's URL does
not change when its content does, so the cache only answers when the network
could not (the handler's own 502) — a real answer, including a 404, stands.
Cleared when the shell cache detects a dead session or an account change;
kept across deploys (files do not redeploy with the portal). The budget
figure is still the firm's open question (docs/offline-plan.md) — one number
in file-cache.js when answered. `npm run test:file-cache`.

## The right-click menu

Electron ships none — right-clicking anywhere in the app did nothing at all,
which no native application on either platform does. [context-menu.js](context-menu.js)
builds one from what was actually clicked: a text field gets the editing
commands, a link gets Copy Link / Open in Browser, an image gets Copy and Save
Image As…, a selection gets Copy, and empty space gets nothing rather than an
empty frame.

The spelling half is why it matters most. `spellcheck: true` has been set in
the window options all along, so Chromium has been underlining misspellings in
every message and email the firm writes — with no way to reach a single
suggestion. The red line was decoration until this connected it.

`role:` throughout rather than hand-wired clicks, so each item carries the
platform's own label, accelerator and enabled state. Note that Electron
lower-cases them on the built item (`pasteAndMatchStyle` → `pasteandmatchstyle`),
which is what `test-context-menu.js` compares against.

## The About panel

`app.setAboutPanelOptions` in [main.js](main.js), with `assets/icon-master.png`.
Left unset, the Mac menu's `role: 'about'` opens a panel showing a stock icon
and Electron's own version — the one window in the app whose entire job is to
answer "what is this program", answering "somebody else's".

That icon is reached by filename, so it has to be in the `files` whitelist.
`verify-asar.js` now checks `assets/` references as well as `require()`s: a
missing picture fails far more quietly than a missing module — no exception,
no log, just a hole where the firm's mark should be.

## Closing versus quitting

Closing the window hides it; the app keeps running, so messages and calls still
arrive and reopening from the dock is instant with nothing reloaded. Only Quit
(⌘Q) actually ends it.

Two things make that work, and both are easy to undo by accident:

- `backgroundThrottling: false` on the window. Chromium throttles timers to
  roughly once a minute in hidden windows, and a hidden window is this app's
  normal state — the websocket heartbeat and the badge refresh both live there.
- The `close` handler calls `preventDefault()` and hides unless `quitting` is
  set. `before-quit` is what sets it, which is also why an update restart works.

## Releasing

```
npm version patch          # or minor / major
npm run release            # macOS   → release/ + latest-mac.yml
npm run release:win        # Windows → release/ + latest.yml
cd .. && php artisan desktop:publish
```

Both platforms share one bucket prefix and one publish command, which uploads
whichever manifests it finds. Building only one platform therefore leaves the
other's published release alone rather than retracting it — but it also means
the two can drift to different versions, so bump and build both together.

The Windows installer cross-compiles from macOS: electron-builder brings its
own NSIS and needs no Wine. `--win` alone builds for the host architecture,
which on an Apple Silicon Mac means an arm64 Windows build almost nobody can
run, so `release:win` pins `--x64`.

`desktop:publish` uploads the artifacts to object storage under `desktop/`,
and `DesktopUpdateController` serves them at `/desktop/{file}` — which is the
feed URL baked into the app. The manifest uploads last, so no installed app
ever sees a version whose build is still uploading.

Installed apps check ten seconds after launch and hourly after that. When a
newer version is on the feed the user is asked, and on Update Now the app
downloads it (progress shows on the dock icon), verifies it against the hash in
the manifest, swaps the bundle and relaunches.

Windows takes the shorter road. `latest.yml` names the NSIS installer, and NSIS
already knows how to stop a running instance, replace the files and start the
new one — so there the verified download is simply run with `/S --force-run`,
and none of the hand-rolled swap below applies.

`updater.js` does that swap itself rather than using electron-updater, which
delegates to Squirrel — and Squirrel refuses to replace a bundle whose
signature it cannot verify, so on an unsigned build it downloads a new version
and then fails at the last step. Doing it here works signed or unsigned, and
keeps working if a certificate arrives later.

Two things follow from how macOS works, not from this code:

- The app cannot delete itself while running, so the swap is handed to a
  detached script that waits for the process to exit, replaces the bundle with
  `ditto`, and reopens it.
- If the bundle is not writable — which is what installing via `.pkg` as root
  produces — there is nothing to swap. That case opens the `.pkg` for the new
  version instead and lets the OS installer ask for a password, rather than
  this app collecting one.

`.pkg` is an installer format, not an update format: updates always come from
the `.zip`, which is why all three targets are built.

`npm run test:update` runs the whole path — feed, download, checksum,
extraction — against whatever is in `release/`, over a local server.

## Signing

Set these before `npm run dist`, **and delete `mac.identity: null` from
package.json**, and the build signs and notarizes itself:

```
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD=…
export APPLE_ID=…
export APPLE_APP_SPECIFIC_PASSWORD=…
export APPLE_TEAM_ID=…
```

That is the only way to make the app open without a warning. It needs a
**Developer ID Application** certificate, which requires a paid Apple Developer
Program membership. Nothing below is a substitute for it.

### Why `identity: null` and `adhoc-sign.js` exist

Two ways to ship an app macOS refuses to open, both of which shipped once:

1. **No certificate at all.** electron-builder sees `hardenedRuntime: true`,
   finds nothing to sign with, and silently skips signing — leaving the bundle
   as the linker left it (`Sealed Resources=none`, `Info.plist=not bound`).
   That is a *broken* signature, not a missing one, and macOS says
   "…is damaged and can't be opened. You should move it to the Trash."
   There is no way past that dialog. Release 0.7.0 shipped like this.

2. **The wrong certificate.** With auto-discovery on, electron-builder grabs
   whatever it finds in the keychain — here an **Apple Development** cert,
   which is for running builds on your own registered machines and is not valid
   for distribution. This one was also revoked, so `spctl` returned
   `CSSMERR_TP_CERT_REVOKED`: same unbypassable "damaged" dialog.

3. **Hardened runtime on an ad-hoc signature.** The first attempt at the fix
   below signed ad-hoc but kept `--options runtime`. Hardened runtime enables
   *library validation*, which requires every loaded library to share the main
   process's Team ID — and ad-hoc has no Team ID. The app died in dyld:

   ```
   Library not loaded: @rpath/Electron Framework.framework/Electron Framework
   … mapping process and mapped file (non-platform) have different Team IDs
   ```

   macOS shows that as "cannot be opened because of a problem". Shipped as 0.8.0.

So `identity: null` stops electron-builder picking up a keychain cert on its
own, and the `afterPack` hook in `adhoc-sign.js` signs the bundle ad-hoc,
innermost-first, sealing resources and binding the Info.plist — with **no**
hardened runtime and no entitlements, both of which only bite outside a real
Developer ID build.

### Verifying a build

`codesign --verify --deep --strict` is **not sufficient** — failure 3 above
passes it and still cannot launch. Check all three:

```
codesign --verify --deep --strict "release/mac-arm64/TM ANTOINE Portal.app"
codesign -dv --verbose=2 "release/mac-arm64/TM ANTOINE Portal.app"   # want flags=0x2(adhoc)
"release/mac-arm64/TM ANTOINE Portal.app/Contents/MacOS/TM ANTOINE Portal"
```

The third is the one that matters: run the binary directly and confirm it stays
up with helper processes. `open` will *not* start an ad-hoc build — Gatekeeper
blocks it — so `open` failing tells you nothing about whether the bundle works.
The hook fails the build if the `runtime` flag is ever set again.

### What users see on macOS 15 and later

Right-click → Open no longer bypasses Gatekeeper for unsigned apps; Apple
removed that in Sequoia. The only route is **System Settings → Privacy &
Security → Open Anyway**, which the account page now tells people. Every user
must do this once, on every macOS from 15 up. A Developer ID certificate is the
only thing that removes the step.

## Release notes — edit these every release

`release-notes.md`, one markdown bullet per line. `build.releaseInfo.releaseNotesFile`
makes electron-builder copy it into `releaseNotes` in both manifests, `updater.js`
parses it back out, and it becomes the **What's new** list in the update offer.

**It is not generated.** Ship without editing it and the new version offers the
*previous* version's notes, which is worse than none — so treat it as part of the
version bump, not an afterthought. Empty is safe: no notes simply hides the
disclosure rather than opening an empty drawer.

Both YAML shapes are handled, because electron-builder picks between them by
content: a `|` block scalar, and a quoted scalar with escaped newlines.

## The update offer

`update-available.js` + `update-available.html`. Replaced
`dialog.showMessageBox`: a native message box cannot carry a disclosure, so the
only thing it could say about an update was a version number — people were asked
to accept a change they had no way to read.

`show({version, notes})` resolves `'update'` or `'later'`, so it drops into
`runUpdate` where the dialog was. Closing the window resolves `'later'` too;
without that the promise never settles and the update hangs waiting for an answer
that cannot arrive.

Two things that bit, both covered by `test-update-available.js`:

- **The panel grew and would not shrink.** The renderer measured `.screen`,
  which `min-height: 100%` pins to the window — so the measurement could only
  ever report the size the window already was. A separate `.content` wrapper,
  sized by its content alone, is what gets measured now.
- **The second offer went deaf.** Handlers read the module-level `panel`, and
  opening a second offer reassigns it *before* the first window's `closed`
  handler runs and nulls it — leaving the live window guarding against a null
  and ignoring its own buttons. Every handler closes over its own `win` now.

Also: resize is deliberately **not** animated. An animated `setContentSize` on a
transparent vibrant window leaves the newly exposed strip unpainted on macOS —
the window grows and the disclosed notes are simply not drawn, which reads as the
drawer opening empty. `webContents.invalidate()` forces the missing frame.

## The updating screen

`update-window.js` + `update-window.html`. An update used to run with nothing on
screen but the dock progress bar, and then the app vanished and came back — on a
slow connection, a long silence followed by what looks like a crash.

It is a separate window rather than an overlay on the portal, for the same
reason as the call panel: the page an overlay would sit on is about to be thrown
away, and the swap happens after the main window has gone.

Three phases, pushed from `updater.js`:

| phase | bar | set when |
|---|---|---|
| `downloading` | real percentage | bytes arriving |
| `installing` | indeterminate | checksum passed, unzip/swap starts |
| `restarting` | indeterminate | staged, about to relaunch |

Only the download can report a fraction. Unzipping 90 MB and swapping the bundle
take real time with nothing to measure, so the bar stops claiming a percentage
it does not have — and drops `aria-valuenow` rather than leaving a stale number
a screen reader would still read out.

Two things that bit, both now covered by `test-update-window.js`:

- **Do not name a DOM variable `status`.** `window.status` is a legacy string
  setter, so a top-level `var status = document.getElementById(…)` becomes a
  *string* and every `textContent` write silently vanishes. The bar animated
  perfectly while the words never changed once.
- **An indeterminate stripe narrower than its track is invisible part of every
  cycle**, which reads as a stalled empty bar at the exact moment the app is
  busiest. It is a shimmer across a full-width bar instead.

`npm run test:update-window -- --watch` steps through the phases slowly and
leaves the window up to look at.

## When the portal is down

Two different failures, and only one of them is a "load failure" to Chromium.

- **No connection at all** (DNS, refused socket, offline) fires `did-fail-load`.
- **A 5xx does not.** Bytes were requested and bytes arrived, so the load
  succeeded and the body renders as the page. When the portal is between
  containers that body is the proxy's, and the window fills with "upstream
  connect error or disconnect/reset before headers… connection refused" — which
  reads as a broken app rather than a server that stepped out.

`did-navigate` carries the status code, so anything >= 500 is turned into the
same friendly page with a Try again button. The error page itself navigates
(a `data:` URL, status 0), which is below the threshold and cannot re-trigger
it — verified against a local server that returns nothing but 503s: three hits
total, then steady.

## The blue title bar

`titlebar.js`. macOS will not tint a native title bar — `backgroundColor` only
paints the web area before the page loads, and the frame is drawn by AppKit in
the system appearance (tested: plain frame, `hidden`, and `hiddenInset` all
refuse). The only route is hiding the native bar and drawing our own, in
`--color-primary` (#03a5e9) from public/css/tokens.css.

Nothing about this lives in the portal's stylesheets. It is injected at runtime
with `insertCSS` + `executeJavaScript`, so a browser never sees it and no portal
CSS file can be broken by it. Re-applied on `did-navigate-in-page` as well as
`did-finish-load`, because the portal routes through pushState and would
otherwise lose the bar on the second screen.

### Back / Forward / Reload

The bar carries the three navigation controls. They call `history.back()`,
`history.forward()` and `location.reload()` in the page rather than going
through new IPC — that is the same session history `webContents` exposes, so
Back on the bar and Back in the Go menu land in the same place, and `preload.js`
keeps its deliberately tiny surface.

Whether there is anywhere to go *to* cannot be worked out in the page
(`history.length` counts entries, not position), so the main process reads
`webContents.navigationHistory` and the bar is re-rendered with that state on
every navigation. Buttons must carry `-webkit-app-region: no-drag` or the strip's
drag region swallows their clicks.

`refresh()` re-renders the bar; `apply()` is `refresh()` plus `insertCSS`. Only
a freshly loaded document gets the full pass — a stylesheet inserted that way
lives as long as the document, and the portal navigates by pushState, so calling
`apply()` on every navigation would stack a new copy of the CSS each time.

### position:fixed is the trap — run `npm test`

Hiding the native bar means the web viewport starts at the very top of the
window. `body { padding-top }` moves everything in normal flow down past the
bar, but **`position: fixed` anchors to the viewport and ignores it**, so any
part of the shell that goes fixed ends up underneath the bar. That shipped once:
the hover-style rail is `position: fixed; top: 0` when collapsed, and the logo is
the first thing in it, so the logo went half-missing.

Every fixed element therefore needs an explicit offset, mirroring the exact
selector and breakpoint that made it fixed in dashboard.css — the offset cannot
be applied unconditionally, because those same elements are `position: relative`
in their other states, where an offset shoves them down instead. Currently:

| element | fixed when | offset |
|---|---|---|
| `.tma-dash__sidebar` | ≥1025px, collapsed, hover style | yes |
| `.tma-dash__sidebar`, `.tma-dash__rightbar`, `.tma-dash__header` | ≤1024px | yes |
| `.tma-dash__mmenu`, `.tma-dash__scrim` | takeovers | **no** — meant to cover the bar |

`test-titlebar.js` (part of `npm test`) loads the *real* shell and stylesheets
over a throwaway server, with scripts stripped so the page cannot sit polling
`/me` and never finish loading, and asserts the rail and logo clear the bar in
both sidebar states. It measures after two animation frames — reading in the
same tick as a class change returns stale geometry and invents failures.

If you add a fixed element to the shell, add it to that table and that test.

The one thing to know: hiding the native bar means the web viewport now starts
at the very top of the window. Ordinary content is pushed down by the body
padding, but `position: fixed` elements ignore that, and this app has a lot of
full-viewport overlays (`.tma-dash__scrim`, the command palette, the mobile
menu, `.tma-portal-sig-wizard`). The bar therefore sits at **z-index 200** —
above ordinary content, deliberately below those takeovers, so their headers and
close buttons are never clipped. The cost is that the blue strip is hidden, and
the top strip not draggable, while such an overlay is open.

If that trade ever becomes the wrong one, the robust fix is to inset the web
contents themselves — `BaseWindow` + `WebContentsView` with bounds starting at
`HEIGHT` — so the viewport genuinely begins below the bar and fixed overlays
behave exactly as they do in a browser, with no injection at all.

## Windows

One codebase, two shells. `IS_MAC` in main.js marks every place they diverge,
and the differences are not cosmetic:

- **The tray is load-bearing** (`tray.js`). macOS has the Dock, so an app with
  no windows is still visible and still quittable. Windows has nothing of the
  sort — close the window with `backgroundOnClose` on and the app would be
  running with no icon anywhere and no way to reach or quit it. The tray is the
  only reason the same close-to-background behaviour is safe to ship there.
- **`window-all-closed` must not quit.** The usual Electron boilerplate quits
  when the last window closes off macOS, which would defeat exactly that.
- **The menu is genuinely different.** `role: 'appMenu'` and everything under it
  — services, hide, hideOthers, unhide, front, zoom — are macOS-only and render
  as dead entries elsewhere, so Windows gets About and Exit in File and Help
  instead of a Mac menu with holes in it.
- **The badge is a taskbar overlay.** `app.setBadgeCount` is macOS and Linux
  only; Windows gets `setOverlayIcon` plus the count in the tray tooltip.
- **A ringing call flashes the taskbar** rather than bouncing the Dock.
- **Deep links arrive in `argv`,** not as an `open-url` event — and on a cold
  start that argv belongs to this process, not to `second-instance`.

Icons all come from `./build-icon.sh`: `icon.icns`, plus `icon.ico` and the
tray PNGs. The .ico is cropped back to the artwork first, because Windows has
no equivalent of Apple's icon grid and the margin the .icns needs would just
make the app look smaller than its neighbours on the taskbar. `make-ico.js`
packs the .ico by hand — there is no ImageMagick on the build machine and
nothing in macOS emits .ico, but the container is a header and some PNGs.

## macOS builds are Apple Silicon only

`--mac` on an arm64 machine produces arm64. Intel Macs need `--mac --x64`, or
`--mac --universal` for one build that runs on both (roughly double the size).
The Windows build is pinned to x64 and runs on arm64 Windows under emulation.

## The Windows build is unsigned too

There is no code-signing certificate for Windows either, so SmartScreen shows
"Windows protected your PC" on first run and the way through is **More info →
Run anyway**. The account page prints whichever hint matches the visitor's OS.

Windows signing is a separate purchase from the Apple one: an OV or EV
code-signing certificate, set via `CSC_LINK` / `CSC_KEY_PASSWORD` the same way.
An OV certificate stops the warning only after the download builds reputation;
an EV certificate clears SmartScreen immediately.

## Sign-in

Google refuses OAuth inside an embedded webview, so the sign-in buttons open
the system browser and the session comes back over `tmaportal://`. The exchange
is PKCE-shaped because any app can register a URL scheme — see
`app/Http/Controllers/DesktopAuthController.php` and `tests/Feature/DesktopAuthTest.php`.

Connecting a mailbox or calendar from Settings still runs in-app, in a child
window: that flow attaches an account to the user who is *already* signed in
here, and sending it to the browser would attach it to whoever is signed in
there instead.
