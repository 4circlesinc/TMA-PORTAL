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

## Liquid Glass

On iOS 26 and later the app draws the bottom bar and the header's bubbles itself, with SwiftUI's `glassEffect`, over the page. A page can only imitate the material, and it cannot see what changes it: the look chosen in Settings > Display & Brightness > Liquid Glass (Clear or Tinted), Reduce Transparency, Increase Contrast and Reduce Motion. Apple applies those to its own material and has no API for the first, so only the system's glass follows them.

The page stays in charge. `public/js/glass-chrome.js` (loaded by the shell, active only when the preload says `TMADesktop.glassChrome`) sends where each bubble sits, its buttons and their icons (drawn to PNG once), the open tab, the counts, and whether something on the page covers it. The app draws that in the same place; a tap on the glass comes back as a click on the page's own button. The page's copies stay where they are, invisible and hidden from VoiceOver (`html.tma-native-glass`), so the layout, the popups that hang from them and the measurements don't move. The page's viewport is the safe area, so the overlay lays out in the safe area too.

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
