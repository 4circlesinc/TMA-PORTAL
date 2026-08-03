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
