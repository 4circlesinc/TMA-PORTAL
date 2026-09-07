# TM ANTOINE Portal — Android app

The Android twin of the Mac app in `../desktop`. It is not a second copy of
the portal: the window loads the portal origin in a WebView and this folder
only adds what a browser tab cannot do — an offline boot, OS notifications, a
sign-in that goes through the real browser, calls with the camera and
microphone, downloads and uploads, deep links. The page is the portal's own
HTML, CSS and JS, so the phone layout is the web's responsive layout.

```
./gradlew :app:installDebug -PportalOrigin=http://10.0.2.2:8002   # against the Docker stack
./gradlew :app:installDebug                                         # against http://10.0.2.2:8001 (php artisan serve)
./gradlew :app:assembleRelease                                      # https://portal.tmantoinelaw.com
./gradlew :core:network:testDebugUnitTest :core:data:testDebugUnitTest
```

Needs JDK 17+ (`JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`),
Android SDK with `platforms;android-37`, and an emulator or device on API 26+.

## How the pieces fit

| Piece | Desktop original | Here |
|---|---|---|
| The window | `main.js` BrowserWindow | `app/.../web/PortalWebHost.kt` — one WebView over the origin |
| Page → shell bridge | `preload.js` + `host-bridge.js` | `app/src/main/assets/preload.js` (+ `host-bridge.js`, copied from `../desktop` at build time by `copyDesktopBridge`) |
| `window.TMADesktop` | `{isDesktop, platform, version, openInBrowser}` | same object, plus `isAndroid: true`; `isDesktop: true` turns on the page's IndexedDB tier |
| `<html data-tma-*>` relays | badge, call, overlay, theme, focus, signin-reopen, signin-cancel | same attributes → `TMAAndroidHost.relay` → `MainActivity` |
| Navigation rules | `attachNavigationRules`, `signin-provider.js` | `web/NavigationRules.kt` |
| Sign-in handoff | `tmaportal://` + PKCE, `signin-waiting.html` | `core/data/auth/SignInHandoff.kt`, the same waiting page; claimed cookies go to `CookieManager` |
| Offline boot | `shell-cache.js` | `web/ShellCache.kt` — the last served shell per `/desktop/build`, served for navigations while offline |
| Offline / load-error pages | `showOffline`, `showLoadError` | `web/OfflinePages.kt`, verbatim |
| OS notifications | Chromium `Notification` | `window.Notification` polyfill in `preload.js` → `web/WebNotifications.kt`; a tap hands the click back to the page |
| Loading layer | `splash.js` | `core/ui/splash/BootSplash.kt` over the WebView until `onPageFinished` |
| Media permissions | `setPermissionRequestHandler` | `WebChromeClient.onPermissionRequest` → runtime permissions |
| Incoming call | `call-window.js` panel, power blocker | `web/CallNotifications.kt` CallStyle notification with Accept/Decline when the app is not in front; `web/CallService.kt` foreground service while ringing or active |
| Downloads / uploads | Chromium | `DownloadManager` with the page's cookies; `onShowFileChooser` |

## Debugging the page

Debug builds enable `WebView.setWebContentsDebuggingEnabled`. Either open
`chrome://inspect` on a desktop Chrome, or from the terminal:

```
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.tmantoinelaw.portal)
curl -s http://localhost:9222/json     # page targets and their webSocketDebuggerUrl
```

## Not built yet

Push notifications (FCM; needs the backend addition in `docs/android-app-prompt.md` §13),
`assetlinks.json` for App Links, release signing and Play.
