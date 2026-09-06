# TM ANTOINE Portal — Android app

The native Android client of the portal in this repository. Kotlin + Jetpack Compose, the same backend as the web portal and the desktop app, no WebView. The spec is [docs/android-app-prompt.md](../docs/android-app-prompt.md); the endpoints are in [docs/android-api-catalogue.md](../docs/android-api-catalogue.md).

## Build

Android Studio opens `android/` directly. From a terminal (JDK 17+; Android Studio's bundled runtime works):

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"   # macOS
./gradlew assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew test                 # unit tests
./gradlew assembleDebug -PportalOrigin=http://192.168.1.20:8001   # point a debug build elsewhere
```

`local.properties` (gitignored) must name the SDK: `sdk.dir=/Users/you/Library/Android/sdk`.

Reproducible build without a local SDK:

```sh
docker compose -f android/compose.yaml run --rm build
```

## Backend for the emulator

```sh
docker compose up -d           # from the repository root: app on :8001, Reverb proxied under /app/
```

Debug builds point at `http://10.0.2.2:8001` (the emulator's alias for the host) and rewrite a realtime host of `localhost` to `10.0.2.2`. Sign in with the seeded `admin@localhost` / `password`.

## Layout

```
app/            application, navigation host, splash, deep links
core/common     result types, time formatting, i18n
core/ui         theme generated from design/tokens.json, design-system components, icons, skeletons
core/network    OkHttp client, cookie jar, CSRF interceptor, Retrofit APIs, realtime socket
core/database   Room: replica, write queue, snapshots, cursors
core/data       offline-first repositories
feature/*       one module per portal module
tools/          gen_tokens.py regenerates core/ui/.../theme/Tokens.kt from design/tokens.json
```
