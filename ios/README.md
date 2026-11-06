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
