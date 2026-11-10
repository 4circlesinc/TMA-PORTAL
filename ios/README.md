# TM ANTOINE Portal — iOS app

The iOS twin of the Android app in `../android` and the Mac app in `../desktop`. It is a native app, not a PWA and not a home-screen shortcut. The window loads the portal origin in a `WKWebView`, so the phone layout is the web's responsive layout. This folder only adds what a browser tab cannot do: an offline boot, Notification Center, a sign-in that goes through Safari, CallKit, downloads, and the `tmaportal://` handoff.

Open `ios/TMAPortal.xcodeproj` in Xcode, pick your team, and run it on a simulator or a phone.

```
# Simulator, against the Docker stack on this Mac (port 8001)
open ios/TMAPortal.xcodeproj

# A physical phone cannot see 127.0.0.1. Set the scheme's environment:
#   PORTAL_ORIGIN = http://192.168.x.x:8001
```

Debug builds talk to `http://127.0.0.1:8001` and may use plain HTTP, including a LAN address you pass in. Release builds talk only to `https://portal.tmantoinelaw.com`.

## How the pieces fit

| Piece | Android | Here |
|---|---|---|
| The window | `PortalWebHost` | `PortalModel` — one WKWebView over the origin |
| Page → shell bridge | `assets/preload.js` | `preload.js`, injected at document start |
| `window.TMADesktop` | `isDesktop` + `isAndroid` | `isDesktop` + `isIOS` |
| Sign-in handoff | Custom Tab + `tmaportal://` | `ASWebAuthenticationSession` + the same URL |
| Sign in with Apple | Apple's web page, same handoff | the system sheet (`ASAuthorizationController`), posted to `/auth/social/apple/native` |
| Offline boot | `ShellCache` | `ShellCache.swift` |
| Notifications | the shade | `UNUserNotificationCenter` |
| Incoming call | CallStyle | CallKit, when the app is not in front |
| Updates | APK from `/desktop/releases` | the `ios` entry on the same feed; Update opens the URL |
| Push | FCM, platform `android` | APNs, platform `ios` (release) or `ios-sandbox` (debug) |
| Bottom bar and header bubbles | the page's own | `GlassChrome.swift` on iOS 26+, in the system's Liquid Glass |

## Opening like an installed app

The portal's front end lives on the phone. `ShellCache.swift` keeps the last
shell the server served together with every script and stylesheet it names
(`Application Support/shell-cache`), and a launch paints that copy with its
files inlined (`instant`); the page then fetches only data. The one question
asked of the network first, for at most 0.4 s inside the splash, is whether
the portal has deployed since: a moved deploy, no session, or a missing file
means the network, as before. After the page is up the shell and its files
are fetched again in the background for the next launch, and if the server
answers with anything but the shell (signed out, onboarding) the kept copy is
dropped and the server's page shown. Signing in or out drops it too.

Three things that used to rebuild the portal in front of the reader, and no
longer do:

- **A connection coming back.** It reloaded whatever was on screen; now only
  the app's own offline or error page is reloaded. The page reconnects itself.
- **iOS taking the page away** (memory, a long time in the background). That
  left the web view's own blue background with nothing on it; now the page
  comes back where it was, from the kept shell (`webViewWebContentProcessDidTerminate`).
- **The forward swipe.** WebKit's navigation gestures are both edges; the right
  edge's is switched off, so a hard swipe in from the right no longer reopens
  the screen just closed. The left edge is back on any screen opened inside a
  page and on any detail page (phone-screens.js decides, `setEdgeBack`).

`ShellCacheTests` covers what is inlined, when a launch may use it, and the
back-only swipe.

## Liquid Glass

On iOS 26 and later the app draws the bottom bar and the header's bubbles itself, with SwiftUI's `glassEffect`, over the page. A page can only imitate the material, and it cannot see what changes it: the look chosen in Settings > Display & Brightness > Liquid Glass (Clear or Tinted), Reduce Transparency, Increase Contrast and Reduce Motion. Apple applies those to its own material and has no API for the first, so only the system's glass follows them.

The page stays in charge. `public/js/glass-chrome.js` (loaded by the shell, active only when the preload says `TMADesktop.glassChrome`) sends where each bubble sits, its buttons and their icons (drawn to PNG once), the open tab, the counts, and whether something on the page covers it. The app draws that in the same place; a tap on the glass comes back as a click on the page's own button. The page's copies stay where they are, invisible and hidden from VoiceOver (`html.tma-native-glass`), so the layout, the popups that hang from them and the measurements don't move. The page's viewport is the safe area, so the overlay lays out in the safe area too.

Search bars, everywhere, are glass too: the buttons that open search, and every search input (`type="search"`, or a "Search…" placeholder on something named search). The page sends each one's icons and words, the words drawn in its own font (Inter, which the app doesn't carry) and inked by the glass. An input's glass lets taps through, so the page's input takes the focus and the keyboard; while it is typed in, the page's own field shows in the same look (the app can't hold the page's caret) and the glass takes back over on blur. The page's field carries `data-glass`, which `dom-morph.js` treats as bookkeeping, so a re-render patches it instead of rebuilding it mid-word.

Older iPhones (iOS 18 and earlier) and older builds of the app keep the page's own bar. `tests/Browser/glass-chrome.mjs` covers the page's side; `GlassChromeTests` the app's.

## Push

Push is off until Apple and the server are both configured. The app still runs, and it still shows notifications the page raises while it is open.

1. `TMAPortal.entitlements` already carries `aps-environment`. Turn on Push Notifications for the App ID `com.tmantoinelaw.portal` in the Apple developer account; Xcode's automatic signing does this on the first archive.
2. Create an APNs key in the Apple developer account.
3. On the server set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` (`com.tmantoinelaw.portal`), and `APNS_PRIVATE_KEY` (the `.p8` contents, or a path to it).

Debug installs register as `ios-sandbox`. App Store and TestFlight installs register as `ios`.

## App Store

`ios/scripts/app-store.sh` archives a Release build and uploads it to App Store Connect, where it lands in TestFlight. The Apple account setup, the store listing and what App Review needs are in [`docs/app-store.md`](../docs/app-store.md).

Release builds never offer a build from `/desktop/releases`; the App Store and TestFlight update them. Debug builds still check the feed.

## Not built yet

An `apple-app-site-association` file, so `https://portal.tmantoinelaw.com` links open the app.
