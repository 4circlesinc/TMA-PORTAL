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
npm run dist               # builds release/ including latest-mac.yml
cd .. && php artisan desktop:publish
```

`desktop:publish` uploads the artifacts to object storage under `desktop/`,
and `DesktopUpdateController` serves them at `/desktop/{file}` — which is the
feed URL baked into the app. The manifest uploads last, so no installed app
ever sees a version whose build is still uploading.

Installed apps check ten seconds after launch and hourly after that. When a
newer version is on the feed the user is asked, and on Update Now the app
downloads it (progress shows on the dock icon), verifies it against the hash in
the manifest, swaps the bundle and relaunches.

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

Set these before `npm run dist` and the build signs and notarizes itself:

```
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD=…
export APPLE_ID=…
export APPLE_APP_SPECIFIC_PASSWORD=…
export APPLE_TEAM_ID=…
```

Without them the build is unsigned, and first launch needs right-click → Open.

## Builds are Apple Silicon only

`--mac` on an arm64 machine produces arm64. Intel Macs need `--mac --x64`, or
`--mac --universal` for one build that runs on both (roughly double the size).

## Sign-in

Google refuses OAuth inside an embedded webview, so the sign-in buttons open
the system browser and the session comes back over `tmaportal://`. The exchange
is PKCE-shaped because any app can register a URL scheme — see
`app/Http/Controllers/DesktopAuthController.php` and `tests/Feature/DesktopAuthTest.php`.

Connecting a mailbox or calendar from Settings still runs in-app, in a child
window: that flow attaches an account to the user who is *already* signed in
here, and sending it to the browser would attach it to whoever is signed in
there instead.
