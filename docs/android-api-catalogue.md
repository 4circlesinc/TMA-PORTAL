# TM ANTOINE Portal — API catalogue for the native Android app

Companion to [android-app-prompt.md](android-app-prompt.md). Everything here was read out of this repository's code on 5–6 September 2026; every table row cites the file (and usually the line) it came from, so open the cited file when in doubt. Nothing is invented: where a reader could not find something it says **not found**.

Two parts:

- **Part A** — eight subsystem chapters with endpoint tables, verbatim payload shapes, validation rules, error semantics and native-client gotchas.
- **Part B** — the mechanical list of every route the backend registers, so nothing is missed.

Paths are relative to the portal origin (`https://portal.tmantoinelaw.com` in production, `http://10.0.2.2:8001` from an emulator against the Docker stack). File paths are relative to the repository root.

## Error format (applies everywhere)

| Status | Body | Meaning for the app |
|---|---|---|
| 401 | `{"message":"Unauthenticated."}` | No or expired session. Clear the cookie jar and cached `/me`, run the sign-in handoff again. |
| 419 | `{"message":"CSRF token mismatch."}` | The `XSRF-TOKEN` cookie you echoed is stale. Do one GET (any endpoint) to receive a fresh cookie, retry once, then treat as 401. |
| 403 | `{"message":"You do not have access to this."}` (capability) or `{"message":"Set up two-factor authentication to continue.","code":"mfa-required","redirect":"…"}` or `{"message":"Your email address is not verified."}` | Permission, MFA policy, or verification wall. Branch on `code` / `message`. |
| 404 | `{"message":"…"}` | Gone, or out of scope (clients, CIP, messaging and feed answer 404, never 403, for records the account may not see). Remove the local copy. |
| 409 | `{"message":"…","reconnect":true}` (mail) or `{"message":"…","conflict":true,"existingName":"…","suggestion":"…"}` (uploads) or `{"duplicate":{…}}` (CIP intake) | Terminal until the user acts: reconnect the mailbox, pick a conflict resolution, or resend with `allowDuplicate=1`. |
| 422 | `{"message":"…","errors":{"field":["…"]}}` (field keys are the camelCase request keys) | Validation. Show the first message per field. Never queue a 422 for offline replay. |
| 429 | `{"message":"Too Many Attempts."}` + `Retry-After` | Throttle. Back off for `Retry-After` seconds. |
| 502 | `{"message":"…"}` | Provider (Gmail/Graph/R2) failure. Show the message, offer retry. |
| 302 | `Location: /auth/login`, `/auth/pending`, `/auth/role-pending`, `/auth/profile-setup`, `/onboarding…`, `/auth/getting-started`, `/auth/setup/*`, `/auth/email/verify`, `/auth/stay-signed-in` | Only when a request lacks `Accept: application/json`, or on the walls that have no JSON branch (`profile.complete`, `account.approved`, `onboarded`). Never follow automatically: open the `Location` in a Chrome Custom Tab, then re-run `/me` when the tab closes. |

Always send `Accept: application/json` and `X-Requested-With: XMLHttpRequest`, or errors arrive as HTML redirects.

## Part A. Subsystem chapters

---

### A1. Auth, session, CSRF and the sign-in handoff

All paths are relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Everything below was read from code; "not found" means the repo does not contain it.

### 1. The shape of authentication (there is no API token layer)

- The only guard is `web`, driver `session`, provider eloquent `App\Models\User` (`config/auth.php` `guards.web`). There is no Sanctum, Passport or bearer-token guard — `config/` has no `sanctum.php` and `composer.json` lists only `laravel/fortify ^1.36`, `laravel/socialite ^5.28`, `laravel/reverb ^1.11`, `laravel/framework ^13.8` (`composer.json:10-13`).
- **Every portal endpoint is a `web`-group route in `routes/web.php`** (no `routes/api.php`; `bootstrap/app.php:20-25` registers only `web`, `console`, `channels`). So the Android app authenticates exactly like the Electron desktop: a **cookie jar** holding the Laravel session cookie plus the remember cookie, and a CSRF token on every non-GET.
- Sessions are forced onto the **database** driver: `config/session.php` maps `SESSION_DRIVER=cookie` to `database` (comment explains Laravel Cloud injects `cookie`, which cannot be revoked). Lifetime `SESSION_LIFETIME` default **120 minutes idle** (`.env:36`), `expire_on_close=false`, `http_only=true`, `same_site=lax`, `secure=env(SESSION_SECURE_COOKIE)` (unset in `.env` → Laravel sets Secure when the request is https; `bootstrap/app.php:31` trusts all proxies so Cloud's TLS is honoured).
- Session cookie name = `Str::slug(APP_NAME).'-session'` unless `SESSION_COOKIE` is set (`config/session.php` `cookie`). `APP_NAME="TM ANTOINE Advisory"` (`.env:1`) → **`tm-antoine-advisory-session`**. `SESSION_COOKIE` is not set in `.env`/`.env.example`; the Cloud value is not in the repo — the app must store whatever `Set-Cookie` names arrive rather than hard-code one.
- Remember-me cookie name is Laravel's `remember_web_<sha1('Illuminate\Auth\SessionGuard')>` (`vendor/laravel/framework/src/Illuminate/Auth/SessionGuard.php:884-887`), value `id|token|hash(password)`, lifetime 5 years (`CookieJar::forever` = 576000 min, `vendor/.../Cookie/CookieJar.php:86-89`). It is issued whenever `Auth::login($user, true)` runs — which the desktop claim does (`app/Http/Controllers/DesktopAuthController.php:133`).
- The DB session handler is throttled: byte-identical session writes are skipped and `last_activity` is bumped only after `TOUCH_SECONDS` (`app/Support/…ThrottledDatabaseSessionHandler` header, `tests/Feature/ThrottledSessionWriteTest.php`). Idle expiry therefore still moves with normal polling.

### 2. CSRF — what the server actually checks

- CSRF is enforced on every POST/PUT/PATCH/DELETE in the `web` group; the only exemption is `hooks/microsoft-graph` (`bootstrap/app.php:33-35`).
- Token sources, in order (`vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestForgery.php:183-196`): form field `_token`, header `X-CSRF-TOKEN`, then header `X-XSRF-TOKEN` which is **decrypted** (`$this->encrypter->decrypt($header)`) — i.e. the `XSRF-TOKEN` cookie value is encrypted and the client passes it back verbatim.
- The server sets an `XSRF-TOKEN` cookie on every `web` response (`PreventRequestForgery.php:239-253`): not HttpOnly, lifetime = session lifetime, SameSite from config. **The value in `Set-Cookie` is URL-encoded; every web helper `decodeURIComponent`s it before putting it in `X-XSRF-TOKEN`** (`public/js/current-user.js:137-150`, `public/js/portal-queue.js:283-305`, `public/js/messaging-realtime.js:27-30`, `public/js/sign-out.js:45-71`).
- The served shell also inlines the plain token as `window.TMACsrfToken` (`app/Support/PortalShell.php:96-108`) and sign-out sends it as `X-CSRF-TOKEN` as well (`sign-out.js:59-71`). A native client only needs the cookie→`X-XSRF-TOKEN` path.
- Mismatch → `TokenMismatchException` → **HTTP 419** (`vendor/.../Foundation/Exceptions/Handler.php:774`), JSON `{"message":"CSRF token mismatch."}` when JSON is expected. The web sign-out retries once on 419 (`sign-out.js:103-110`); the write queue treats 401/419 as "stop, keep the entry" (`portal-queue.js:402`).

### 3. Headers every request must carry

| Header | Value | Why (cite) |
|---|---|---|
| `Cookie` | session + remember + `XSRF-TOKEN` (+ `tma_device_trust`, `tma_trusted_device` if received) | session guard; `StaySignedIn::COOKIE` `app/Support/StaySignedIn.php:22`; `TrustedDevices::COOKIE` `app/Support/TrustedDevices.php:22` |
| `Accept: application/json` | always, on every XHR-style call | `wantsJson()` = first Accept type contains `/json` (`vendor/.../Http/Concerns/InteractsWithContentTypes.php:34-39`); `expectsJson()` = that OR (`X-Requested-With: XMLHttpRequest` AND Accept `*/*`) (`:24-27`). JSON errors are rendered when `expectsJson()` (`bootstrap/app.php:60-62`). |
| `X-Requested-With: XMLHttpRequest` | always | matches every web helper (`current-user.js:146`, `portal-queue.js:286`) |
| `X-XSRF-TOKEN` | URL-decoded `XSRF-TOKEN` cookie value | §2 |
| `Content-Type: application/json` | JSON bodies (`current-user.js:144`); multipart for uploads | — |
| `X-Socket-ID` | Reverb `socket_id` on every write while connected | `public/js/portal-live.js:52-70`; without it `toOthers()` echoes the actor's own change back |
| `User-Agent` | anything containing `Android` | `app/Support/DeviceName.php:7-27` produces "Browser on Android" labels for Security settings and trusted devices; a new UA/IP pair also triggers the "New sign-in to your account" notification for returning users (`app/Listeners/RecordAuthEvent.php:82-127`) |

### 4. Middleware walls on the portal group (`routes/web.php:162`)

Group order: `auth, verified, profile.complete, account.approved, onboarded, mfa.enforced`. Aliases: `bootstrap/app.php:37-43`. Also appended to `web` globally: `ApplySecurityPolicyHeaders`, `IssueTrustedDeviceCookie`, `EnsureStaySignedInChoice` (`bootstrap/app.php:45-47`).

| Middleware | Trigger | JSON caller gets | HTML caller gets |
|---|---|---|---|
| `auth` (Laravel) | no session user | **401** `{"message":"Unauthenticated."}` (`vendor/.../Exceptions/Handler.php:849-853`) | 302 → `/auth/login` (`bootstrap/app.php:49-56`; `/media/*` excluded) |
| `verified` | `email_verified_at` null | **403** `Your email address is not verified.` (`vendor/.../Auth/Middleware/EnsureEmailIsVerified.php:36-38`) | 302 → `/auth/email/verify` |
| `profile.complete` (`app/Http/Middleware/EnsureProfileComplete.php`) | `profile_completed_at` null | **no JSON branch — 302** to `/onboarding` (client without `onboarding_completed_at`) or `/auth/profile-setup` | same |
| `account.approved` (`EnsureAccountApproved.php`) | `status==='suspended'` → logs out, invalidates session, 302 `/auth/login` with flash "Your account has been suspended…"; `!isApproved()` → 302 `/auth/pending`; `account_type==='Employee'` → 302 `/auth/role-pending` | **no JSON branch — 302** | same |
| `onboarded` (`EnsureOnboarded.php`) | `AccountSetupFlow::isComplete()` false | **no JSON branch — 302** to `/auth/getting-started` (staff) or `/onboarding` (client) or `/auth/setup/{step}` | same |
| `mfa.enforced` (`EnforceTwoFactor.php`) | policy `sign-in.requireMfa` true (default **false**, `app/Support/SecurityPolicies.php:17-21`) and `two_factor_confirmed_at` null; exempt: `security-settings*`, route `me`, `/settings`, `/account-settings` | **403** `{"message":"Set up two-factor authentication to continue.","code":"mfa-required","redirect":"…/security-settings"}` | 302 → security settings |
| `capability:x` (`EnsureCapability.php`) | user lacks all listed capabilities | **403** `{"message":"You do not have access to this."}` | 403 |
| `EnsureStaySignedInChoice` | session flag `stay_signed_in.needed` set and cookie `tma_device_trust` not `yes`/`no` | 302 → `/auth/stay-signed-in` | same |

**Gotcha:** `/me` sits inside this group, so a pending/unverified/un-onboarded account calling `/me` receives 302/403 — the Android client must not follow redirects blindly; treat a `Location` of `/auth/pending`, `/auth/role-pending`, `/auth/profile-setup`, `/onboarding*`, `/auth/getting-started`, `/auth/setup/*`, `/auth/email/verify` as a "finish in browser" state and open it in a Custom Tab. `/auth/pending-status` (`routes/web.php:1327-1331`, `auth`+`verified` only) returns `{"approved":bool,"hasRole":bool}` for polling; `/auth/email/verification-status` (`routes/web.php:137`, `auth` only) returns `{"verified":bool}` (`app/Http/Controllers/EmailVerificationStatusController.php`).

Status meanings for a native client: **401** = no/expired session → re-run sign-in; **419** = CSRF token stale → refresh `XSRF-TOKEN` (any GET) and retry once; **403** = capability/verification/MFA policy (check `code`); **404** = resource gone or (from `/security-settings/sessions/{digest}`) "already ended"; **422** = validation `{"message":…,"errors":{field:[…]}}`; **429** = throttle (`Retry-After`); **409** with `reconnect:true` = mailbox needs reconnect (`bootstrap/app.php:92-101`); **409** with `conflict:true` = upload name clash (`:74-85`).

### 5. Fortify endpoints (prefix `auth`, `config/fortify.php` `prefix`)

Routes: `vendor/laravel/fortify/routes/routes.php`. Guard `web`, username `email`, lowercased. Features on: registration, resetPasswords, emailVerification, updateProfileInformation, updatePasswords, twoFactorAuthentication (confirm, confirmPassword, window 1) (`config/fortify.php:179-190`). Redirects: login `/`, logout `/auth/login?from=logout`, password-reset `/auth/login?reset=1`, email-verification `/auth/profile-setup` (`:99-104`).

| Method & path | Fields | JSON answer (Accept: application/json) | Notes |
|---|---|---|---|
| `POST /auth/login` | `email`, `password` (`LoginRequest.php:25-31`); `remember` accepted but the portal never sends it — remember is decided by Stay-signed-in | `200 {"two_factor":false}` (`app/Http/Responses/LoginResponse.php:17-19`) or `200 {"two_factor":true}` (`vendor/.../RedirectIfTwoFactorAuthenticatable.php:153-155`); failure **422** `{"errors":{"email":["These credentials do not match our records."]}}` (`AttemptToAuthenticate.php:97-104`) | throttle `login` = 5/min per `email|ip` (`app/Providers/FortifyServiceProvider.php:71-75`) → 429. Pipeline swaps in `App\Actions\Fortify\RedirectIfTwoFactorAuthenticatable` which skips 2FA when `TrustedDevices::trusts()` (cookie `tma_trusted_device`, hash match, **same IP**, `app/Support/TrustedDevices.php:51-79`). |
| `POST /auth/two-factor-challenge` | `code` OR `recovery_code` (`TwoFactorLoginRequest.php:43-49`), optional `trust_device=1` (`resources/views/auth/two-factor-challenge.blade.php:48,66`) | `204` (`app/Http/Responses/TwoFactorLoginResponse.php:17-19`); bad code → 422 `{"errors":{"code":[…]}}` | Needs the **same session cookie** from the login response (`login.id` in session, `TwoFactorLoginRequest.php:109-121`). Throttle 5/min per `login.id`. `trust_device` makes `IssueTrustedDeviceCookie` set `tma_trusted_device` (30 days, `TrustedDevices::issue`). |
| `POST /auth/logout` | none | `204` (`vendor/.../LogoutResponse.php:19-21`) | `auth:web`; invalidates session and regenerates token. Web then navigates to `/auth/login?from=logout` (`sign-out.js:96-101`) and wipes `TMAStore` + `localStorage tma.me` (`sign-out.js:19-43`). Logout does **not** cycle `remember_token` — only `revokeSession` does (`app/Http/Controllers/SecuritySettingsController.php:190-201`). |
| `POST /auth/register` | `first_name`, `middle_name?`, `last_name`, `gender` ∈ Female/Male/Non-binary/Prefer not to say, `email`, `password`, `password_confirmation`, `terms=accepted` (`app/Actions/Fortify/CreateNewUser.php:25-41`) | `201 {"redirect":"/auth/email/verify"}` (`RegisterResponse.php:19-21`) | Password rules: min max(8, policy.minLength=10) + HIBP uncompromised + policy digits/specials (`PasswordValidationRules.php:18-46`). New user `status='pending'` (`app/Models/User.php:56`). |
| `POST /auth/forgot-password` | `email` | `200 {"message":…}` / 422 `{"errors":{"email":[…]}}` | broker expire 60 min, throttle 60 s (`config/auth.php` passwords.users) |
| `POST /auth/reset-password` | `token`, `email`, `password`, `password_confirmation` (`NewPasswordController.php:57-61`) | 200 / 422 | |
| `POST /auth/email/verification-notification` | none | 202/200 | `auth`, throttle `6,1` (`routes.php:36,94-96`) |
| `GET /auth/email/confirm/{id}/{hash}` (signed) | — | 302 to `/auth/profile-setup?verified=1`; logs the user in if signed out (`app/Http/Controllers/UnsignedVerifyEmailController.php:41-61`) | link opened from mail; throttle 6/min |
| `PUT /auth/user/password`, `PUT /auth/user/profile-information`, `POST/DELETE /auth/user/two-factor-authentication`, `POST /auth/user/confirmed-two-factor-authentication`, `GET /auth/user/two-factor-qr-code`, `…/two-factor-secret-key`, `GET/POST …/two-factor-recovery-codes`, `GET/POST /auth/user/confirm-password`, `GET /auth/user/confirmed-password-status` | Fortify defaults | Fortify defaults | 2FA routes require `password.confirm` (`routes.php:142-172`); password timeout 10800 s |

Post-login web-only detour: `StaySignedIn::afterAuthenticated` (`app/Support/StaySignedIn.php:87-100`) — when cookie `tma_device_trust` is absent it flags the session and redirects to `/auth/stay-signed-in`; `POST /auth/stay-signed-in` `stay=yes|no` (`app/Http/Controllers/StaySignedInController.php:25-57`) sets the 30-day cookie and, for `yes`, re-logs in with remember. **For JSON logins this detour is skipped** (`LoginResponse.php:17-19` returns before it), but the session flag is not set either, so nothing pins the app. If the app wants a durable session after a password login it must answer `POST /auth/stay-signed-in` with `stay=yes` (or rely on the desktop handoff, which always remembers).

### 6. Social sign-in (Google / Microsoft)

- `GET /auth/social/{google|microsoft}/redirect` (`routes/web.php:1409`), `GET /auth/social/{provider}/callback` (`:1425`), `POST /auth/social/{provider}/disconnect` (`auth`,`verified`, `:1428`), `GET /connect/{provider}` (`auth`, `:1420-1423`) for mailbox/calendar connects. Providers: `['google','microsoft']` (`app/Http/Controllers/SocialAuthController.php:37`). Missing `services.{provider}.client_id` → back to login with `social_error` "… sign-in is not configured yet." (`:76-78`).
- The callback signs in via `login()` (`:489-518`): 2FA users without a trusted device go to `/auth/two-factor-challenge`; otherwise `Auth::login($user,false)`, regenerate, then Stay-signed-in.
- OAuth **must not run inside an embedded webview** — the desktop comment and `signin-provider.js` say Google refuses it (`desktop/main.js:641-648`). That is the reason the handoff in §7 exists; Android must use it too.

### 7. The desktop handoff — reuse it verbatim on Android

Server: `app/Http/Controllers/DesktopAuthController.php`. Routes `routes/web.php:1437-1447`.

| Step | Endpoint | Rules |
|---|---|---|
| 1 | `GET /auth/desktop/start?challenge=<43 chars [A-Za-z0-9_-]>&provider=google|microsoft` (provider optional) | throttle 20/min. Validation `size:43` + regex (`:52-55`); a bad challenge is a 302 back with session errors (`tests/Feature/DesktopAuthTest.php:135-139`). Stores `desktop.challenge`, `desktop.started_at`, sets `url.intended` = `/auth/desktop/finish`; if the browser is already signed in → straight to finish; with `provider` → `/auth/social/{provider}/redirect`; else → `/auth/login` (`:56-72`). Browser has **CHALLENGE_TTL = 900 s** to finish (`:36`). |
| 2 | user signs in by any method in the **system browser** (password, Google, Microsoft, 2FA, stay-signed-in all chain through `url.intended`) | — |
| 3 | `GET /auth/desktop/finish` (`auth`) | pulls challenge; if missing/expired → 302 `/`. Mints `token = Str::random(64)` in cache `desktop-auth:{token}` = `{user_id, challenge}` for **TOKEN_TTL = 120 s** (`:39,80-95`). Returns an HTML page that does `location.href = "tmaportal://auth?token=…"` and shows an "Open the app" button with the same href (`:141-181`). |
| 4 | app receives `tmaportal://auth?token=<64>` | scheme constant `SCHEME='tmaportal'` (`:41`) |
| 5 | `GET /auth/desktop/claim?token=<64>&verifier=<43..128>` **from the app's own cookie jar** | throttle 20/min. `Cache::pull` — **single use even on failure** (`:111-113`, `DesktopAuthTest::test_a_failed_claim_burns_the_token`). Verifies `base64url(sha256(verifier)) === challenge` (`:119-123`). Success: `Auth::login($user, true)` (remember cookie), `session()->regenerate()`, **302 → `/`** (`:133-136`). Failure: **302 → `/auth/login`** with flash `social_error` ("That sign-in link has expired. Try again." / "That sign-in could not be verified." / "That account is no longer available.") (`:115-131`). |

Desktop client reference (`desktop/main.js:651-762`, `desktop/signin-handoff.js`):
- `verifier = base64url(randomBytes(32))` (43 chars), `challenge = base64url(sha256(verifier))` (`main.js:651,711-712`); base64url strips `=` and maps `+/`→`-_`.
- Verifier persisted to disk (`userData/signin-verifier`, mode 0600) so a cold-start deep link can still claim (`signin-handoff.js:1-23,39-49`); single use — deleted after claim (`:61-67`, `main.js:678-682`).
- Opens `PORTAL_ORIGIN/auth/desktop/start?challenge=…[&provider=…]` in the system browser (`main.js:710-720`) and shows `desktop/signin-waiting.html` ("Continue in your browser" / "Finish signing in with Google, then return here." / buttons "Open in browser", "Back to sign in"); cancel forgets the verifier and loads `/auth/login` (`main.js:1416-1426`).
- On deep link (`open-url` / `second-instance` / cold argv, `main.js:1325-1338,1517-1521`) it parses `token`, and if no verifier survives shows the dialog "That sign-in could not be completed." / "Start signing in from this window rather than from the browser, and finish in the tab it opens." (`:733-752`); otherwise loads `/auth/desktop/claim?token&verifier` in its own session and forgets the verifier (`:755-761`).
- The desktop only hands off **social** clicks; the password form is posted inside the Electron window (`desktop/signin-provider.js:71-92`, `main.js:382-388`). The user-agent is Chrome-shaped (`main.js:110-114,194`).

#### Android sign-in plan (step by step)

1. Generate `verifier` (32 random bytes → base64url, 43 chars) and `challenge` (SHA-256 → base64url). Persist the verifier in EncryptedSharedPreferences/DataStore **before** launching the browser (cold-start deep links, as `signin-handoff.js` explains).
2. Launch a **Chrome Custom Tab** at `https://<portal>/auth/desktop/start?challenge=…&provider=google|microsoft` (omit `provider` for the password/login page). Show a native "Continue in your browser" screen mirroring `desktop/signin-waiting.html` copy with "Open in browser" (relaunch the same URL) and "Back to sign in" (forget verifier).
3. Declare an `<intent-filter>` for scheme `tmaportal`, host `auth` (`android:launchMode="singleTask"`); on `onNewIntent`/`onCreate` read `token` (exactly 64 chars).
4. With the app's OkHttp `CookieJar` (empty or stale), `GET /auth/desktop/claim?token=…&verifier=…` with `followRedirects=false`. Delete the stored verifier immediately. Treat `302 Location: /` (+ `Set-Cookie` session and `remember_web_*`) as success; `302 Location: /auth/login` as failure — the reason text is only in the flashed session, so show a generic "That sign-in could not be completed. Try again." and offer retry (the token is burnt either way).
5. Immediately `GET /me` with the headers in §3 to hydrate identity (`app/Http/Controllers/MeController.php:23-73` — keys `id,name,firstName,lastName,email,phone,jobTitle,company,linkedin,avatar,hasAvatar,accountType,isAdmin,isStaff,cipReach,isProviderContact,isPrivateClient,capabilities[],providerPhoto,realtime{enabled,key,host,port,scheme},toasts,desktopNotifications{enabled,preview},workStatus,availability`). Persist the JSON as the offline identity, exactly as the desktop keeps `localStorage tma.me` (`current-user.js:280-298,338-347`): a non-OK reply deletes it; a network failure falls back to it (`:352-372`).
6. Any later **401** → clear cookies + cached `/me`, return to step 1. Any 302 from `/me` → open `Location` in a Custom Tab, then poll `/auth/pending-status` or re-run `/me` when the tab returns.
7. Sign-out: `POST /auth/logout` with CSRF (retry once on 419 like `sign-out.js:103-110`); on 204/200/302 clear the cookie jar, the replica and the write queue (`sign-out.js:19-43,112-126`).

The claim path never triggers `EnsureStaySignedInChoice` (it never calls `StaySignedIn::markNeeded`), and it already logs in with remember=true, so the app gets a 5-year remember cookie plus a 120-minute session cookie; Laravel re-mints the session from the remember cookie transparently, so keep both.

### 8. Realtime auth (Reverb)

- Connection details come from `/me.realtime` (`app/Support/RealtimeConfig.php:16-31`): `wss://{host}:{port}/app/{key}?protocol=7&client=tma-portal&version=1.0&flash=false` (`public/js/messaging-realtime.js:18-21,279-286`). Wait for `pusher:connection_established` → `data.socket_id` (`:349-356`; Reverb sends `data` as a JSON string, `:336-343`).
- Private channels: `POST /broadcasting/auth` (registered by `withRouting(channels:)`, `bootstrap/app.php:24`, `vendor/.../ApplicationBuilder.php:128-139`, `web` middleware → needs session cookie + `X-XSRF-TOKEN`) with JSON `{socket_id, channel_name}`; reply `{auth, channel_data}` sent in `pusher:subscribe` (`messaging-realtime.js:439-466`). Channels and authorisers in `routes/channels.php`: `App.Models.User.{id}`, `portal.staff` (staff only — a client asking gets 403, `portal-live.js:194-201`), `messaging.user.{id}`, `conversation.{uuid}`, `file.{uuid}`, etc.
- Send `X-Socket-ID` on writes (§3).

### 9. Security settings endpoints the app may mirror

`GET /security-settings/data` (`SecuritySettingsController.php:28-83`) returns `email, google{connected,email}, microsoft{…}, hasRealPassword, phone, alerts, syncAvailable, trustedDevices[{id,device,ip,lastUsed,expires}], twoFactor: on|pending|off, twoFactorSince, twoFactorApp, recoveryCodesCount, failedSignins7d, sessions[], events[{event,detail,when,atIso,ip,device}]`. `DELETE /security-settings/sessions/{sha256 digest}` (404 "That session has already ended." if gone; **cycles `remember_token`, signing out every other remembered device**, `:167-201`). `POST /security-settings/logout-others` `{password}` (`:232-249`). `DELETE /security-settings/trusted-devices[/{id}]`. `POST /security-settings/two-factor-app {app}`. `PUT/DELETE /security-settings/phone`. Routes at `routes/web.php:199-227`.

### 10. Auth screen design

`AUTH_DESIGN.md` is the spec: screen list with paths and states (§1 table, lines 20-42), flow diagrams (§3), copy rules — neutral errors, "Done / Optional / Recommended" pills, no fear language, autocomplete hints (§4), breakpoints 960/760/720/560 px and `data-theme="dark"`. Live Blade views: `resources/views/auth/` (`login`, `register`, `two-factor-challenge`, `stay-signed-in`, `forgot-password`, `reset-password`, `verify-email`, `pending`, `role-pending`, `profile-setup`, `getting-started`, `setup/`). The login view shows provider buttons first with an email form behind "data-show-email" (`login.blade.php:47-73`) and renders `session('social_error')` as an alert (`:40-43`). Prototype behaviours (OTP auto-advance, countdowns, password meter) live in `public/js/auth-flow.js`. Because the handoff runs sign-in in the browser, the native app only needs: the waiting screen, the claim/failure states, and (optionally) a native password form posting to `/auth/login` + `/auth/two-factor-challenge` as JSON.

### 11. Not found / open questions

- No API-token or bearer auth; no `SESSION_COOKIE`/`SESSION_DOMAIN` production values in the repo.
- `public/js/portal-data.js` does no fetching of its own (no `fetch(` in it); 401 handling lives in `public/js/auth-session.js:23-31` (wraps `window.fetch`, redirects to `/auth/login?return=<path>` on 401 unless signing out) and `current-user.js:352-372`.
- The `social_error` reason after a failed claim is only available as an HTML flash on `/auth/login`; there is no JSON variant.

---

### A2. Core API: /me, preferences, dashboard, notifications, activity, people, contacts, groups, security, admin

Every path below is relative to the portal origin. All of it lives in `routes/web.php` (there is **no** `routes/api.php`; `ls routes` = `channels.php console.php web.php`), so every endpoint is a **session-cookie, CSRF-protected "web" route**. Nothing here is Sanctum/token-based.

### 1. Transport contract a native client must honour

| Concern | What the code does | Cite |
|---|---|---|
| Auth | Laravel session cookie (`SESSION_DRIVER` maps cookie→database; cookie name `SESSION_COOKIE` or `<app-slug>-session`), issued by Fortify under prefix `/auth` (`/auth/login`, `/auth/logout`, `/auth/two-factor-challenge` …). Login throttle: 5/min per `email|ip`; two-factor 5/min. | `config/session.php:141-144`, `config/fortify.php:89,117`, `app/Providers/FortifyServiceProvider.php:71-79` |
| CSRF | Every non-GET must carry `X-XSRF-TOKEN` = URL-decoded value of the `XSRF-TOKEN` cookie. Only `hooks/microsoft-graph` is exempt. | `bootstrap/app.php:34-36`; `public/js/current-user.js:118-131`; `public/js/notify-store.js:16-45` |
| Headers every JS call sends | `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, `credentials: same-origin`; `Content-Type: application/json` for JSON bodies; `X-Socket-ID` (Reverb socket id) on writes so `broadcast()->toOthers()` skips the caller. | `public/js/notify-store.js:27-45`, `public/js/portal-live.js:52-69`, `app/Support/Realtime/Live.php` (flush → `toOthers()`) |
| JSON errors vs redirects | JSON rendering only when `request->is('api/*') || expectsJson()`. **Without `Accept: application/json`, 401/403/419 and every gate middleware answer with a 302 to an HTML page** (`/auth/login`, `/auth/pending`, `/auth/role-pending`, `/auth/getting-started`, `/profile-setup`, onboarding). With it: 401 `{"message":"Unauthenticated."}`, 403 `{"message":...}`, 419 CSRF mismatch, 422 `{"message","errors":{field:[..]}}`. | `bootstrap/app.php:60-63`; `app/Http/Middleware/EnsureAccountApproved.php`, `EnsureProfileComplete.php`, `EnsureOnboarded.php` |
| Portal gate stack | `['auth','verified','profile.complete','account.approved','onboarded','mfa.enforced']` wraps everything in this brief. `account.approved`: suspended → logout+redirect; `status != approved` → `/auth/pending`; `account_type == 'Employee'` → `/auth/role-pending`. `mfa.enforced`: only when admin policy `sign-in.requireMfa` is true (default **false**) → JSON `403 {"message":"Set up two-factor authentication to continue.","code":"mfa-required","redirect":"/security-settings"}`; `/me` and `security-settings*` are exempt. | `routes/web.php:161`; `app/Http/Middleware/EnforceTwoFactor.php`; `app/Support/SecurityPolicies.php:18-25` |
| Capability gate | `capability:x[,y]` middleware = holder of **any** listed capability, else `403 "You do not have access to this."`. Most core routes instead check inside the controller via `Role::can()`/`Role::authorize()`. | `app/Http/Middleware/EnsureCapability.php` |
| Reverb | `/me.realtime` = `{enabled, key, host, port, scheme}`; socket URL = `ws(s)://host:port/app/<key>?protocol=7&client=tma-portal&version=1.0&flash=false`; `pusher:connection_established` yields `socket_id`; private channels authorised by `POST /broadcasting/auth` `{socket_id, channel_name}` (same cookie+CSRF headers) returning `{auth, channel_data}`; then `pusher:subscribe`. Event `data` arrives as a JSON **string**. | `app/Support/RealtimeConfig.php`; `public/js/messaging-realtime.js:281-284,340-356,436-470` |
| Dates | Every timestamp is ISO-8601 with offset (`toIso8601String()`); human strings (`"Last seen 5 minutes ago"`, `"Just now"`, `"M j, Y"`) are pre-rendered **in the reader's zone** from `users.preferences.timezone` (`utc±N` ids or IANA). Native clients should render from the `*Iso`/`*At` field, not the label. | `app/Support/UserTime.php::zone`, `app/Support/Presence/LastSeen.php` |
| Logout | `POST /auth/logout` (Fortify) with CSRF; the web client then wipes `localStorage['tma.me']` and its offline store. | `public/js/sign-out.js:1-60` |

**`portal-data.js` is NOT a fetch helper**: it is a legacy `localStorage` blob (`tma.portal.v1`) of mock settings; nothing server-backed reads it. The real shared fetch wrapper is `window.TMANotifyAPI.api(url, {method, json})` in `public/js/notify-store.js:27-58` (throws `Error` with `.status`/`.data` on non-2xx; parses JSON only if `content-type` includes `application/json`).

### 2. `/me` — identity, capabilities, realtime config

`GET /me` (`MeController::show`, `app/Http/Controllers/MeController.php:22-77`). Exempt from the MFA gate. Response keys, verbatim:

| Key | Type / source |
|---|---|
| `id`, `name`, `firstName` (falls back to `name`), `lastName`, `email`, `phone`, `jobTitle`, `company` (`companyName()`), `linkedin` | user columns |
| `avatar` (URL or **null** → draw initials), `hasAvatar`, `providerPhoto` | `avatar_url`, `provider_avatar_url` |
| `accountType` | one of `Client`, `Employee` (parked), `CRO / Reviewing officer`, `Administrator` (legacy `Reviewing Officer`/`Compliance Officer` alias to officer) — `app/Support/Access/Role.php:29-80` |
| `isAdmin`, `isStaff` | `Role::isAdmin/isStaff` |
| `cipReach`, `isProviderContact`, `isPrivateClient` | `CipAccess` (`app/Support/Cip/CipAccess.php:73,104,131`) |
| `capabilities` | `string[]` of matrix names the user holds (admins get all; `cbi.*`/`cip.*` hidden when feature flags off) — full list `Role.php:150-330` |
| `realtime` | `{enabled:false}` or `{enabled:true,key,host,port,scheme}` |
| `toasts` | `{enabled:true, position:'bottom-right'|'top-right'|'bottom-left', durationSec:3|5|8|10, stickyImportant, sound, previewText, groupSimilar}` — `app/Support/Notifications/ToastSettings.php` |
| `desktopNotifications` | `{enabled, preview}` from MessagingSettings `desktopNotifications`/`notificationPreview` (defaults true) |
| `workStatus` | today's public work plan `{status,label,startsAt:'HH:MM',endsAt,location}` or null — `app/Models/WorkDay.php::publicFromPlan` |
| `availability` | `AvailabilityService::selfPayload` (see §6) |

Capability names (the matrix, `Role.php:150-330`): `clients.view/viewAll/manage/invite/assign`, `cbi.view`, `cip.view/create/review/compliance/assign/decide/configure/report`, `users.view/manage`, `directory.view`, `presence.view`, `mail.use`, `feed.view/createChannel/moderate/analytics`, `messaging.contactAll`, `files.viewOrg/admin/settings`, `signatures.create`, `templates.view/email`, `workflows.view`, `callRecordings.view`, `overview.view`, `activity.viewAll`, `calendar.staff/admin`, `groups.view/manage`, `recyclebin.admin`, `settings.security/operations/reporting/branding/clientHub/storage/advanced`. Employee baseline for `clients.*` and `directory.view` is admin-editable (§9). Page→capability map `Role.php:334-380`, settings-rail map `Role.php:396-430`.

Web-client behaviour to replicate (`public/js/current-user.js`): one `/me` in flight at a time; desktop keeps the last answer in `localStorage['tma.me']` and paints it before the network answers; a non-OK response **deletes** the cached copy (signed out/suspended); a network failure keeps it. `applyMe` then scopes the offline store/write-queue to `id`, applies toast/desktop prefs, and runs catch-up syncs (files/CIP/clients). Branding is loaded separately via `GET /admin/branding` (readable by everyone).

Other `/me` routes (`routes/web.php:215-222`):

| Method/path | Body | Response |
|---|---|---|
| `GET /me/profile` | – | `{name,firstName,middleName,lastName,gender,email,phone,jobTitle,company,companyInherited,bio,linkedin,accountType,avatar,providerPhoto,connected:[{key:'google'|'microsoft',name}]}` |
| `POST /me/avatar` (multipart) | `avatar_photo` (jpeg/png/webp ≤ 8192 KB) and/or `source: upload|provider` | `{status:'ok', avatar}`; 422 `avatar_photo` messages `"That file is not an image. Use a JPG, PNG, or WebP."`, `"That image is too large. Keep it under 8 MB."`, `"Choose a photo to upload."` |
| `PUT /profile` | `first_name`*, `middle_name`, `last_name`*, `gender` (`Female|Male|Non-binary|Prefer not to say`), `phone` (`^\+?[0-9 ()\-]{7,32}$`), `job_title`, `company`, `bio` ≤1000, `linkedin_url`, `avatar_photo`, `source` | JSON only with `Accept: application/json`: `{status:'ok', name}` else 302 — `ProfileController.php:22-85`. Email/account type are not self-service. |
| `GET /profile` | – | 302 to `/account-settings?page=profile` (not JSON) |
| `GET /me/sync-status` | – | `{importsPaused, email:{state,synced?,total?,mode?}, calendar:{state,count?,synced?,pending?}, onedrive:{state,synced?,total?,importsPaused?}, smartsheet:{...}}`; `state ∈ off|syncing|done|error|paused` — `MeSyncStatusController.php` |
| `POST /me/onedrive/pause` / `resume` | – | `{paused:true|false}`; 404 `"No OneDrive is connected."` |
| `GET /admin/connectors` | – | `{microsoftReady, connected, email, features:{email:{linked,writable}, calendar:{linked,readable,writable}, onedrive:{linked,ready,paused}}}` (any signed-in user) |

Avatars: `GET /media/avatars/{uuid}.jpg` and `GET /media/branding/{uuid}.{ext}` are `auth`-only (outside the portal gates), streamed with `Cache-Control: private, max-age=86400` / `3600` — `AvatarController.php`, `BrandingController::logo`. Send the session cookie when loading images.

### 3. `/me/preferences` — every key and default

`GET|PUT /me/preferences` (`PreferencesController.php`). PUT is a **merge** of whitelisted keys (`sometimes|nullable`); unknown keys are dropped; response is the full payload.

| Key | Default | Validation |
|---|---|---|
| `autoTimezone` | `true` | boolean |
| `timezone` | `'utc+0'` | `^(utc[+-]\d{1,2}|Area/City)$`; changing it re-times the user's local calendars |
| `language` | `'auto'` | `auto` or `xx[-yyyy]` |
| `voice` | `'en-us'` | ≤32 |
| `sidebarStyle` | `'hover'` | `standard|hover` |
| `notifyAlwaysEmail` | `false` | boolean |
| `themeMode` | `'light'` | `system|light|dark` (portal ignores device scheme unless `dark` chosen) |
| `fontScale` | `3` | 1–5 (coerced to int) |
| `accentColor` | `'indigo'` | `indigo|yellow|red|blue|orange|green` |
| `historyDays` | `30` | `7|14|30|60|90|365` |
| `plugins` | `null` (= never customised) | `[{id≤40, enabled}]`, first id wins; explicit `null` resets |
| `calendarView` | `'month'` | `week|month|agenda|day|work_week` |
| `calendarSidebarOpen` | `true` | boolean |
| `fileSyncNoticeDismissed` | `false` | boolean |
| `dashboardWorkflowStrip` | `true` | boolean |
| `toasts` | ToastSettings defaults | nested keys above |
| `dashboardTiles` | all ten `true` | `{tileId: bool}`; ids `recentFiles,email,cipStatus,favorites,road,shortcuts,employees,messages,requests,comments` |
| `dashboardLayout` | `{order:[recentFiles,email,cipStatus,favorites,road,shortcuts,employees,messages,requests,comments]}` | unknown ids dropped, missing ids appended; server stamps `dashboardLayoutVersion` (currently **13**) and re-seeds the default board on GET when the version is older |

Not returned by this endpoint but stored in the same `users.preferences` JSON: `notifications` (§5), `toasts`, `security_alerts` (§7), `activity_seen_at` (§5), `accountSetupStep`/`accountsSetupComplete` (onboarding), messaging settings.

### 4. Dashboard

| Route | Gate | Params | Response |
|---|---|---|---|
| `GET /` | portal | – | HTML SPA shell with capabilities inlined (`PortalShell`), `no-store`. Not for native use. |
| `GET /portal/dashboard/metrics` | none; non-staff get `{staff:false}` | `period=today|week|month|year` (anything else = rolling `PORTAL_METRICS_WINDOW_DAYS`=30) | staff: `{staff:true, scope:'organization'|'personal', period, windowDays, cards:{clientResponse, cipNew, cipUpdatesRequired, awaitingSignature}}` cached 300 s per user+period; provider contact: `{staff:false, provider:true, scope:'provider', period, windowDays, cards:{cipActive, cipUpdatesRequired, unreadMessages, openComments}}` uncached; else `{staff:false, period}`. Each card: `{value:string, delta:string, deltaUp:bool, hint:string, count?/seconds?/sample?}` — `app/Support/Dashboard/DashboardMetrics.php:135-200`, `Period.php` (calendar periods start at the reader's local midnight / Sunday) |
| `GET /portal/dashboard/staff` | `presence.view` else `{staff:false, employees:[]}` | – | `{staff:true, canManage, employees:[{id,name,firstName,jobTitle,avatar,accountType,self,online,lastSeen,lastSeenAt,status,statusLabel,statusSource,statusMessage,statusIcon,workStatus}]}` sorted online → most recent → name — `StaffPresenceController.php` |
| `GET /portal/dashboard/work` | `CipAccess::canViewWorkflows` else `{enabled:false, requests:[], comments:[], feed:[], counts:null}` | `want=requests,comments,feed` (default `requests,comments`) | `{enabled:true, want, requests:[…Hub rows], comments:[…], feed:[{kind:'request'|'comment'|'update', at, item}], counts}` (10 rows each) — `DashboardWorkController.php` |
| `GET /portal/sign-ins` | staff only (`Role::authorizeStaff`) | `limit` 1–50 (default 8) | `{items:[{id:'auth-N', module:'security', type:'security.login|login_failed|lockout|social_failed', status:'success'|'failure', description, actor:{id,name,avatar}|null, createdAt}]}` — `SignInActivityController.php` |

### 5. Notifications and Activity

Base `/portal/notifications` (`NotificationController.php`), all scoped to the caller's rows:

| Method/path | Params/body | Response |
|---|---|---|
| `GET /` | `unread=1`, `actionRequired=1`, `module`, `type`, `level`, `search`, `cursor` (id; returns rows with `id < cursor`), `limit` ≤50 (default 20) | `{items:[Notification], nextCursor:int|null, unread:int}` |
| `GET /count` | – | `{unread, actionRequired}` (badge source of truth) |
| `POST /{uid}/read`, `/{uid}/unread`, `/{uid}/complete` | – | `{item, unread}`; 404 if not yours |
| `POST /read-all` | `{module?}` | `{unread}` |
| `POST /bulk` | `{action:'read'|'unread'|'delete', ids:[uid…] 1–200}` | `{affected, unread}` |
| `DELETE /{uid}` | – | `{ok:true, unread}` |
| `GET /preferences` | – | `{groups:[email,messages,calendar,files,signatures,clients,groups,feed,approvals,security,system], channels:[portal,email,desktop,sound], locked:[security,approvals], preferences:{group:{portal,email,desktop,sound}}}` (defaults all true except `email.email=false`; `portal` forced true for locked groups) |
| `PUT /preferences` | `{preferences:{group:{channel:bool}}}` | `{preferences}` |

Notification item (`NotificationPresenter::notification`, `app/Support/Notifications/NotificationPresenter.php:23-47`): `{id (uid), type, level, module, priority, title, message, icon (Phosphor name), image (photo URL|null), isSystem, actor:{id,name,avatar}|null, actionUrl, actionLabel, subjectType, subjectId, read, readAt, requiresAction, completed, createdAt, meta}`. Levels: `info|success|warning|error|action_required|approval_required|security|reminder` (`app/Models/Notification.php:27-34`). Modules: `email, messages, calendar, files, signatures, clients, account, security, feed, system`. Full type registry with icon/level/priority/action label: `app/Support/Notifications/NotificationType.php`.

Realtime: event `notification.created` on `private-App.Models.User.{id}` with `{notification, unread}` (`app/Events/PortalNotificationCreated.php`). The web store (`notify-store.js`) applies it, toasts it, raises an OS banner only when backgrounded and the module's `desktop` channel is on, then polls `/count` every 60 s **only when the socket is unhealthy**, and always reconciles on focus/visibility/online.

Base `/portal/activity` (`ActivityController.php`); non-`activity.viewAll` viewers see only their own actions:

| Method/path | Params | Response |
|---|---|---|
| `GET /` | `module,type,action,status,system=1,actor (admin only),client (uid),from,to,search,cursor,limit≤100 (25)` | `{items:[Activity], nextCursor, isAdmin}` |
| `GET /count` | – | `{new, failed}` (since `preferences.activity_seen_at`; admins exclude own actions) |
| `POST /seen` | – | `{ok:true,new:0}` |
| `GET /filters` | – | `{modules[], types[], statuses:[success,failure,pending], actors:[{id,name}] (admin only)}` |

Activity item: `{id, type, module, action, status, description, isSystem, actor, client:{id,name,initial,color}|null, subjectType, subjectId, ip, device, oldValues, newValues (last four null unless admin), createdAt}`.

Signal-only realtime for lists: `data.changed` `{resource}` on `private-portal.staff` (staff) and `private-App.Models.User.{id}`; resources `files,clients,users,contacts,calendar,companies,projects,signatures,activity,workflows,cip,identity` — refetch the endpoint you already use (`app/Support/Realtime/Live.php`, `public/js/portal-live.js:27-40,194-200`). `identity` means "re-fetch `/me`".

### 6. Availability (`/me/availability`, `AvailabilityController.php`)

`selfPayload` (returned by GET and by every write): `{primary:{status,source,message,label,icon,startedAt,expiresAt}, states:[{status,source,message,startsAt,expiresAt,meta}], locations:[{type:'office'|'remote',label,address,latitude,longitude,radiusM,enabled}], schedules:[{id,status,message,startsAt,endsAt,recurrence,enabled}], manualPicks:[available,on_call,at_meeting,do_not_disturb,in_office,working_remote,away], allStatuses:{slug:label}}` (`app/Support/Presence/AvailabilityService.php:336-395`, statuses/labels/icons `AvailabilityStatus.php`).

| Method/path | Body |
|---|---|
| `PUT /status` | `status` (in `LABELS`), `message` ≤140, `startsAt`, `expiresAt` (after startsAt) |
| `DELETE /status` | `status` |
| `PUT /message` | `message` ≤140 |
| `POST /location` | `lat, lng, accuracyM` (not stored; geofence only) |
| `GET /geocode?q=` / `GET /reverse-geocode?lat&lng` | Nominatim proxy → `{lat,lng,label}`; 503 when upstream fails; 422 `"No results for that address."` |
| `PUT /locations` | `type, label, address, latitude*, longitude*, radiusM 25–5000 (100), enabled` |
| `DELETE /locations/{office|remote}` | – |
| `POST /schedules` | `id?, status*, message, startsAt*, endsAt*, recurrence, enabled` |
| `DELETE /schedules/{id}` | – |
| `POST /call` | `{active:bool}` → `{ok:true}` |

Realtime: `presence.status` on `private-portal.staff` + own channel `{userId,status,label,source,message,icon,expiresAt}` (`app/Events/UserStatusChanged.php`).

### 7. Security settings (`SecuritySettingsController.php`)

`GET /security-settings/data` → `{email, google:{connected,email}, microsoft:{connected,email}, hasRealPassword, phone, alerts:{new_device(true, locked),password_changed,two_factor_changed,monthly_summary}, syncAvailable:{google,microsoft}, trustedDevices:[{id,device,ip,lastUsed,expires}], twoFactor:'on'|'pending'|'off', twoFactorSince, twoFactorApp:{key,name,logo}, recoveryCodesCount, failedSignins7d, sessions:[{id (sha256 digest of session id),device,ip,lastActive,current}], events:[{event,detail,when,atIso,ip,device}]}`. Note `/security-settings` itself is a 302 to `/account-settings?settings-page=account-security`.

| Method/path | Body | Response |
|---|---|---|
| `PUT /security-settings/phone` | `phone` (same regex as profile) | `{status:'ok', phone}` (never verified) |
| `DELETE /security-settings/phone` | – | `{status:'ok', phone:null}` |
| `PUT /security-settings/alerts` | any of the four booleans | `{status:'ok', alerts}` |
| `POST /security-settings/password` | `password` (Fortify rules) — only when `password_auto` | `{status:'ok'}`; 422 `"Your account already has a password. Use \"Change password\" instead."` |
| `POST /security-settings/logout-others` | `password` (current) | `{status:'ok'}` (JSON only with Accept) |
| `DELETE /security-settings/sessions/{digest}` | – | `{status:'ok'}`; 404 `"That session has already ended."`; **rotates `remember_token`**, so other remembered devices must sign in again |
| `DELETE /security-settings/trusted-devices[/{id}]` | – | `{status:'ok'}` |
| `POST /security-settings/two-factor-app` | `app: microsoft|google` | `{status:'ok'}` |

Two-factor enrolment itself is Fortify (`/auth/user/two-factor-authentication`, etc.) and outside the portal gate group — not covered here.

### 8. People, contacts, groups, invitations (staff-only)

**People** (`PeopleController.php`; read gate `directory.view` → 403 `"Only staff can browse the directory."`, which by matrix is **admin-only unless** the admin grants it under Permissions):

| Path | Extra gate | Response |
|---|---|---|
| `GET /portal/people/summary` | – | `{counts:{employees,clientContacts,prospects,sharedContacts,personalContacts,groups}, capabilities:{manageUsers,viewClients,manageGroups,viewGroups}}` |
| `GET /portal/people/employees` | – | `{employees:[Person], capabilities, accountTypes:['CRO / Reviewing officer','Administrator']}` (≤2000) |
| `GET /portal/people/client-contacts` | `clients.view` | `{contacts:[Person + company, clientUid], capabilities}` |
| `GET /portal/people/prospects?status=waiting|accepted|expired|failed|cancelled|all` | – | `{prospects:[Prospect], counts:{waiting,accepted,expired,failed,cancelled}, capabilities}` |
| `GET /portal/people/welcome-candidates` | `users.manage` | `{candidates:[Prospect]}` |
| `POST /portal/people/welcome` | `users.manage`; `{email*, message ≤1000, copyToMe}` | `{status:'ok', kind:'invite'|'activation'|'welcome'}`; 422 when no account/invite |
| `DELETE /portal/people/prospects/{invite:N|user:N}` | `users.manage` | `{status:'ok'}`; 422 if the user has signed in |

Person row: `{id,name,firstName,lastName,email,accountType,admin,jobTitle,phone,avatar,status,activated,lastLogin,lastActive,lastActiveLabel,joined,self}`. Prospect row: `{id:'invite:N'|'user:N', source, name, email, company, accountType, invitedIso, invited, expired, failed?, invitationId?, status?, lastError?, sendCount?, expiresAt?, acceptedAt?, cancelledAt?, invitedBy?, canResend?, canCancel?, awaitingApproval?}`.

**Contacts** (`ContactsController.php`; gate `directory.view`): `scope=shared|personal` (default personal) as query/body param. `GET /portal/contacts` → `{scope, contacts:[{id (uuid),scope,firstName,lastName,name,email,company,phone,jobTitle,notes,addedIso,canEdit}], canManageShared}`; `POST /` (201 `{contact}`), `PATCH /{uuid}`, `DELETE /{uuid}`, `POST /bulk-delete {ids:[uuid]}` → `{deleted}`. Fields: `first_name*`, `last_name`, `email`, `company`, `phone` ≤64, `job_title`, `notes` ≤2000. Personal entries: owner only; shared: creator or `users.manage`.

**Groups** (`GroupsController.php`; gate `groups.view`; create/delete admin): `GET /portal/groups?q&includeArchived=1` → `{groups:[{id,name,description,type,autoJoin,isArchived,memberCount,createdAt,myRole}], types:[team,department,project,committee,organization], canManage}`; `GET /portal/groups/staff?q` → `{staff:[{id,name,email,avatarUrl,jobTitle}]}` (≤200); `POST /` `{name*,description,group_type,auto_join,memberIds[]≤512}` → `{group}`; `PATCH /{uuid}` `{name,description,group_type,auto_join(admin),is_archived}`; `DELETE /{uuid}`; `GET /{uuid}/members` → `{members:[{userId,name,email,avatarUrl,jobTitle,role}], autoJoin, canManage}`; `POST /{uuid}/members {memberIds[],role}` → `{status,memberCount}`; `DELETE /{uuid}/members/{userId}` (422 `"Give someone else management of this group first."`).

**Invitations** (`InvitationController.php`; `clients.invite` for client types, `users.manage` for staff): `GET /portal/invitations?status=live|pending|…&type&q` → `{invitations:[Invitation], counts:{pending,accepted,expired,failed,cancelled}}` (≤200); `POST /` `{type*, email*, name, clientUid, companyUid, role, jobTitle, department, companyRole}`; `GET /{uuid}` → `{invitation, deliveries[], existingAccount}`; `POST /{uuid}/resend|link|cancel`; `PATCH /{uuid}/recipient {email*,name}`; `DELETE /{uuid}` (`users.manage`). Record: `{id,type,typeLabel,email,name,role,offer,status,client:{id,name},company:{id,name},invitedBy,sentAt,expiresAt,acceptedAt,cancelledAt,sendCount,lastError,delivery,canResend,canCancel}` (`app/Support/Invitations/Invitations.php::toRecord`). Every resend/link **rotates the token**.

### 9. Administration

| Route | Gate | Shape |
|---|---|---|
| `GET /admin/users` | `users.view` | `{accountTypes, users:[{id,name,firstName,middleName,lastName,gender,email,accountType,accountTypeLabel ('Pending'|'Service Provider Contact'|'Service Provider Client'|'Private Client'|type),avatar,phone,jobTitle,bio,linkedin,profileDone,note,status,twoFactor,joined,joinedIso,lastActive,lastActiveLabel,lastActiveAt,workStatus,self}], canManage}` — no paging, whole table |
| `GET /admin/users/pending-count` | – (0 for non-admin) | `{count}` |
| `POST /admin/users` | `users.manage` | issues an **invitation**, not an account: `{name*,email*,account_type* (ASSIGNABLE),phone,job_title,department}` → `{status,invitation}` |
| `PATCH /admin/users/{id}` | admin | `first_name*,middle_name,last_name*,gender,email*,account_type,note,avatar_photo,phone,job_title,bio,linkedin_url` → `{status:'ok'}`; 422 `"The portal needs at least one active administrator."` |
| `DELETE /admin/users/{id}`, `POST /admin/users/bulk-delete {ids}` | admin | soft-delete to recycle bin, sessions dropped, email sent; `{status}` / `{deleted, skippedSelf}` |
| `POST /admin/users/{id}/approve {account_type*}`, `/deny {reason}`, `/suspend`, `/reactivate`, `/send-reset`, `/generate-password` → `{password}`, `/reset-two-factor` | admin | `{status:'ok'}`; 422s: `"Only pending accounts can be approved."`, `"You can't suspend your own account."` … |
| `GET /admin/users/{id}/activity?type=login|app` | admin | `{lastLogin, events:[{event,detail,when,atIso,ip,device}]}` (30) |
| `GET /portal/admin/recycle-bin?search&kind` | `recyclebin.admin` | `{items, total, kinds:[file,folder,user,client,signature,group,calendar_event,message_attachment], isAdmin}`; `POST /{kind}/{id}/restore`, `DELETE /{kind}/{id}`, `POST /empty {kinds[]}` → `{ok, counts}` |
| `GET /admin/security-policies` | any; `PUT /{sign-in|security|device|alerts}` needs `settings.security` | `{isAdmin, signInPolicy:{minLength 10,numbersRequired 0,specialRequired 0,requireMfa false,requireMicrosoftConnect,requireGoogleConnect,requireAuthenticatorApp}, securityPolicy:{trustedDomains,autoRemediation{…}}, deviceSecurity:{defaultMode,selfDestruct}, alertSettings:{newDevice{admins},failedSignIns{admins},failedSignInThreshold 5,alternateContacts}, alertEvents[], failureWindowMinutes}` — `AdminSecurityController.php`, `SecurityPolicies.php` |
| `GET /admin/branding` (everyone); `PUT /`, `POST /logo` (multipart `logo` ≤2048 KB, no SVG), `DELETE /logo`, `POST /reset` (`settings.branding`) | | `{branding:{accountName:'TM ANTOINE Advisory', pageTitle:'TM ANTOINE Advisory - Where Companies Connect', headerColor:'#FFFFFF', accentColor:'#0C0C0C', logo:'/media/branding/…'|null, logoName}}` |
| `GET /admin/client-hub` / `PUT` | `settings.clientHub` read, admin write | `{canEdit, capabilities:[{id,label,help,granted,default}] (clients.view/viewAll/manage/invite/assign), allowSelfRegistration, inviteExpiryDays, expiryChoices:[1,3,7,14,30,60], counts:{employees,clients,pendingInvitations}}`; PUT body `{employee:{'clients.view':bool,…}, allowSelfRegistration, inviteExpiryDays}` |
| `GET /admin/permissions` / `PUT` | `settings.advanced` read, admin write | `{canEdit, capabilities:[{id:'directory.view',…}], clientSharing, counts:{employees,clients}}`; PUT `{employee:{'directory.view':bool}, clientSharing}` |
| `GET /admin/background-ops` (+`POST /retry {uuid,action:retry|forget}`, `POST /flush`, `PUT /imports-pause {target,paused}`, `POST /imports-run {target}`, `POST /libraries {site,library}`) | `settings.operations` / admin | `{driver, inspectable, pending[], failed[], imports:{anyPaused,updatedAt,targets[]}, health:{pending,failed,oldestWaitSeconds,stalled}}` |
| `GET /admin/notification-history?date&recipient&status&page` | `settings.reporting` | `{notifications:[{id,recipient,subject,template,status,failed,error,sentAt,date,time}], page, pages, total, recipients[], summary:{total,queued,failed}}` (100/page) |
| `GET /admin/reports`, `POST /` (201), `GET /{uid}`, `POST /{uid}/run`, `DELETE /{uid}`, `GET /{uid}/export` (CSV) | `settings.reporting` (+`cip.report` for CIP) | `{recent[], recurring[], types[], ranges[], frequencies[], cip}`; report record `{id,name,type,range,startsOn,endsOn,frequency,status,error,createdBy,created,generatedAt,nextRunAt,filters,data}` |
| `GET /admin/storage-usage` | `settings.storage` | `{generatedAt, usedBytes, limit, categories[], byLocation, byAccountType, topOwners, largestFiles, growth}` |

`GET /auth/getting-started` / `POST` (`GettingStartedController.php`) are **HTML views/redirects**, part of onboarding, not JSON.

### 10. Global search — client-side index, no server search endpoint

`app/Support/GlobalSearch.php` only loads `design/global-search.json` (a Figma-derived demo preset used by `/design` previews). Real search is entirely in the browser (`public/js/portal-search-index.js`): a static index built from the sidebar DOM + settings pages (filtered by capabilities), plus live fan-out on ≥2 chars to `GET /portal/files/?section=all&search=&perPage=12&lean=1`, `GET /portal/clients/search?q=&limit=12` (needs `clients.view`), `GET /admin/users` or `/portal/people/employees` (cached, filtered locally), `GET /portal/signatures/?search=`, `GET /portal/mail/messages?q=&limit=8&live=0`, messaging search, `GET /portal/cip/requirements`, `GET /portal/cip/applications?q=&perPage=8`; empty palette shows `/portal/clients/preview?limit=5&sort=latest` and recent files. Results are de-duplicated by id key. A native app must reproduce this fan-out; there is nothing to call.

### 11. Gotchas checklist for Android

1. Always send `Accept: application/json` + `X-Requested-With: XMLHttpRequest`, or gates answer with 302s to HTML and `res.json()`-style parsing fails.
2. Persist and resend the session cookie **and** the `XSRF-TOKEN` cookie; put the decoded token in `X-XSRF-TOKEN` on every POST/PUT/PATCH/DELETE (including `/broadcasting/auth` and `/auth/logout`). A 419 means the token/session expired — re-login.
3. Send `X-Socket-ID` on writes once the socket is up, or the device refetches its own changes on `data.changed`.
4. `/me` is the boot dependency: cache the last answer per device (as the desktop does), drop it on any non-2xx, keep it on network failure; treat `capabilities` as UI hints only.
5. Cursor paging on notifications/activity is `id`-based and descending; `nextCursor === null` means done. Never use `perPage` here.
6. Timestamps are UTC ISO-8601; pre-rendered labels are in the user's preference timezone, not the device's — prefer the ISO fields.
7. `dashboard/metrics`, `dashboard/staff`, `dashboard/work` never 403 — they answer `{staff:false}` / `{enabled:false}`; branch on those keys.
8. Avatar/branding image URLs are relative (`/media/...`) and need the cookie; `avatar: null` means draw initials (palette + algorithm in `current-user.js:133-146`).
9. Multipart uploads: `avatar_photo` ≤8 MB jpeg/png/webp; `logo` ≤2 MB; laravel validates `image` mime by content.
10. Revoking a session rotates `remember_token` (all other remembered devices get signed out); `generate-password`, `suspend`, `deny`, delete all drop the target's sessions immediately.

---

### A3. File Library, uploads, bytes, comments, versions, shares, requests, workflows, signatures

Scope: File Library listing, folders, files, uploads, bytes delivery, thumbnails, comments, versions, shares, file requests, workflows, signatures, shortcuts, sync. Every fact below cites a path under `/Users/vernonfrancis/Github/TMA-PORTAL`. "Not found" means the code was not located, not that it does not exist.

### 1. Transport rules every call shares

- All `portal/files/*`, `portal/signatures/*` and `portal/file-library/*` routes sit inside the group at `routes/web.php:162` with middleware `['auth','verified','profile.complete','account.approved','onboarded','mfa.enforced']`. They are **session-cookie web routes**, not `api/*` token routes.
- JSON error rendering is opt-in: `bootstrap/app.php:61-63` renders JSON only when `$request->is('api/*') || $request->expectsJson()`. **Send `Accept: application/json` on every request** or an auth failure comes back as an HTML redirect to login instead of a 401/419.
- CSRF is enforced on every web POST/PATCH/PUT/DELETE (`bootstrap/app.php:34-36`, only exemption is `hooks/microsoft-graph`). The web client reads the `XSRF-TOKEN` cookie and sends it back as `X-XSRF-TOKEN` (`public/js/portal-upload-manager.js:24-38`). It also sends `X-Requested-With: XMLHttpRequest`.
- `X-Socket-ID` must carry the Reverb socket id on writes so `toOthers()` broadcasts skip the sender (`public/js/portal-upload-manager.js:31-36`).
- Files/folders are addressed by public `uuid`; storage paths are never exposed (`routes/web.php:640-643`).
- Permission failure is `abort(403, 'Permission denied.')` from `FileAccess::authorize` (`app/Support/Files/FileAccess.php:780-783`). Missing item is 404 `'Folder no longer exists.'`/`'File no longer exists.'` (`app/Http/Controllers/Files/BaseFilesController.php:19-41`).
- File-manager validation failures render as `{"message": "..."}` with **422** on any `portal/files/*` path (`bootstrap/app.php:68-74`); Laravel field validation is the standard 422 `{message, errors:{field:[...]}}`.
- Upload name conflicts render **409** `{"message","conflict":true,"existingName","suggestion"}` (`bootstrap/app.php:77-86`).
- Timestamps are ISO-8601 strings via `toIso8601String()` (e.g. `Presenter.php:217-221`). Sizes are integer bytes plus a server-made `sizeLabel` (`Presenter.php:1073-1083`).
- Realtime: every create/update/delete/restore of a FileItem/Folder fires `Live::staff('files')` and `Live::user('files', owner_id)` (`app/Observers/FileLibraryObserver.php:52-79`). The event is `data.changed` on `private-portal.staff` (staff only) and `private-App.Models.User.{id}` with payload `{resource:'files'}` — signal only, no rows (`public/js/portal-live.js:194-200`, `app/Events/PortalDataChanged.php:63`). The web view refetches its listing on the signal (`public/js/portal-files.js:8155-8160`). Comments and review changes also signal `files`, `workflows`, `cip` (`app/Support/Files/Comments.php:356-368`, `FileReviewController.php:113-114`, `CommentReads.php:466-468`).

### 2. Listing endpoint — `GET /portal/files`

Controller: `app/Http/Controllers/Files/BrowserController.php`.

| Param | Values / notes | Source |
|---|---|---|
| `section` | `all, my, shared, shared-folders, favorites, filebox, recent, recycle, clients` (unknown → `all`) | `BrowserController.php:27-33` |
| `folder` | folder uuid; browse into children in any section; 403 if not viewable | `:58-63` |
| `perPage` | default 60, clamp 1..200; `0` → 200 | `:52-54` |
| `page` | ≥1 | `:55` |
| `search` | LOWER LIKE on name; files also match extension exactly, owner name, uploader name | `:543-563` |
| `type` | category: `pdf, word, excel, powerpoint, image, video, audio, archive, text` | `:565-569, 705-720` |
| `extension` | exact lower-case ext | `:570-572` |
| `favorite` | boolean filter | `:549-551, 573-575` |
| `owner` | owner user id (int) | `:229-241` |
| `sort` | `name, created, modified, size, type, owner`; default `name`, Recent defaults `modified` | `:585-593` |
| `dir` | `asc|desc`; Recent+modified defaults `desc` | `:589-590` |
| `only` | `files` or `folders` | `:67-75` |
| `lean` | boolean: skips folder stats/facets | `:83, 154` |
| `facets` | boolean: return `owners` facet (expensive) | `:87-92` |
| `totals` | boolean: exact COUNT totals (expensive); Recent never counts | `:88-93` |

Response (`:161-177`):
```json
{ "section":"all",
  "folder": {"id","name","permissions":{view,upload,download,rename,move,copy,delete,share,assign},"packageLocked":bool} | null,
  "breadcrumb":[{"id","name"}], "folders":[Folder], "files":[File],
  "page":1,"perPage":60,"total":123,"hasMore":true,
  "counts":{"folders":n,"files":n}, "owners":[{"id","name","n"}] }
```
Paging is **folders first, then files** in one window; without `totals=1`, `total` is `offset + rows + (hasMore?1:0)` — a lower bound, not a count (`:126-151`). Sections map to sidebar nav ids: `folders-all→all, folders-clients→clients, folders-personal→my, folders-sharedwithme→shared, folders-shared→shared-folders, folders-favorites→favorites, folders-filebox→filebox, folders-recent→recent, folders-recycle→recycle` with titles/empty copy at `public/js/portal-files.js:65-90`. Uploads allowed only in sections `all, my, filebox` at root (`portal-files.js:92`). The web view requests `section, folder, search, type, owner, sort, dir, perPage(50), page` (`portal-files.js:367-375`) and adopts the server's clamped `perPage` (`:482`). Deep links: `?folder=<uuid>&file=<uuid>` (`portal-files.js:2251-2254, 7999-8010`); notifications link to `/folders/all?file=<uuid>` (`app/Support/Files/Workflow/Engine.php:333,454`).

### 3. Record shapes (`app/Support/Files/Presenter.php`)

**File** (`:188-256`): `id, type:"file", name, extension, category, mime, icon, previewable, size, sizeLabel, versionNumber, comments:{open,unread,mentionsMe}|null, folder:{id,name}|null, path:[{id,name}], createdAt, uploadedAt, modifiedAt, updatedAt, deletedAt, owner:Person|null, uploadedBy:Person|null, people:[Person+roles[]], peopleTotal, audience:{label,role,count}|null, assignedTo:[names], shared:bool, favorite:bool, status:{status,label,tone,...}|null, review:{status,label,note,reviewedAt,reviewedBy,canReview,all[],next[],overrides?}, permissions:{preview,download,rename,move,copy,delete,share,assign,review}, downloadUrl, previewUrl|null, thumbUrl|null`.
- `Person` = `{userId,name,email,avatar}` (`:586-600`).
- `category` ∈ `pdf,word,excel,powerpoint,image,video,audio,archive,text,code,other`; `icon` is a Phosphor name (`FileType.php:9-40, 69-77`). `previewable` = category in `pdf,image,video,audio,text` and not svg (`FileType.php:52, 112-121`).
- `downloadUrl/previewUrl/thumbUrl` are absolute `route()` URLs with `?v=<versionNumber>` so caches move with versions (`:1066-1071`). `thumbUrl` only for `jpg,jpeg,png,gif,webp,bmp,svg` (`Thumbnail.php:29-37`); svg files get `previewUrl` pointed at the thumb route (`:251-253`).
- `review.status` ∈ `application_review, update_required, ready_for_submission` (`ReviewStatus.php:45-49`, `Cip/DocumentStatus.php:22-28`).

**Folder** (`:258-320`): `id, type:"folder", name, folderType ∈ user|root|organization|client|staff (Folder.php:20-28), colour, iconName, comments:{unread}|null, fileCount, folderCount, size, sizeLabel (null when lean/recycle), parent:{id,name}|null, path, createdAt, modifiedAt, deletedAt, owner, createdBy, people, peopleTotal, audience, assignedTo, shared, favorite, permissions:{upload,download,rename,move,copy,delete,share,assign,colour,icon}, packageLocked`. Folder stats are the 5-minute subtree job, not live (`:95-98, 274-281`).
- Colour keys: `default, blue, green, pink, red, teal` with fill/shade hex (`FolderColours.php:18-24`); icon names grouped at `FolderIcons.php:17-28`.
- Roles behind `permissions`: `viewer/downloader/editor/full` capability table at `FileAccess.php:41-47`; `upload,rename,move,copy,delete,restore` are frozen on package-locked CIP folders (`:50`).

### 4. Folder & file CRUD

| Method & path | Body | Returns | Source |
|---|---|---|---|
| `POST /portal/files/folders` | `name, parent?(uuid), auto?` | 201 Folder | `FolderController.php:20-38` |
| `GET /folders/{uuid}` | | Folder | `:41-46` |
| `PATCH /folders/{uuid}` | `name` | Folder | `:49-61` |
| `PATCH /folders/{uuid}/colour` | `colour` (palette key or null) — personal pref on `user` folders, admin-only otherwise | Folder | `:64-84` |
| `PATCH /folders/{uuid}/icon` | `icon` | Folder | `:87-107` |
| `POST /folders/{uuid}/move` / `/copy` | `target?` (uuid, null=root) | Folder (copy 201) | `:133-160` |
| `DELETE /folders/{uuid}` | | `{ok:true}` soft-delete | `:163-172` |
| `POST /folders/{uuid}/restore`, `DELETE /folders/{uuid}/force` | | Folder / `{ok}`; admin, owner or deleter only | `:175-196, 224-228` |
| `GET /folders/{uuid}/download` | | streamed `application/zip` named `<name>.zip` | `:213-233` |
| `POST /portal/files/files` | multipart `file`, `folder?`, `conflict?(replace|rename)`, `newName?` — single-shot ≤2 GB | 201 File | `FileController.php:21-73` |
| `GET /files/{uuid}` | works on trashed | File | `:75-81` |
| `PATCH /files/{uuid}` | `name` (extension stays truthful) | File | `:83-100` |
| `POST /files/{uuid}/move` / `/copy` | `target?` | File | `:102-155` |
| `DELETE /files/{uuid}`, `POST .../restore`, `DELETE .../force` | | as folders | `:157-190` |
| `PATCH /files/{uuid}/review` | `status` ∈ ReviewStatus::ALL, `note?` (required for `update_required`) | review payload | `FileReviewController.php:51-104` |
| `POST /portal/files/favorites/toggle` | `type: file|folder, id` | `{favorite:bool}` | `FavoriteController.php:12-43` |
| `POST /portal/files/recycle-bin/empty` | | `{ok,files,folders}` (own items unless admin) | `RecycleBinController.php:15-46` |
| `POST /portal/files/bulk` | `action ∈ delete,restore,forceDelete,move,copy,favorite,unfavorite,review; items:[{type,id}]; target?; status?; note?` | `{ok, processed, errors:[{id,message}], results:[{id,type,item}]}` | `BulkController.php:30-98` |

Name collisions on move/copy auto-suffix via `Naming::nextAvailable` (`FileController.php:109-112`). Blocked upload extensions/MIMEs at `FileType.php:42-56`; max 2 GB (`FileType.php:7`).

### 5. Chunked upload protocol (`UploadController.php`, `ChunkedUpload.php`, `portal-upload-manager.js`)

1. `POST /portal/files/uploads` JSON `{filename, size, folder?, chunkSize?, mime?, versionOf?, versionNote?}` → 201 `{id, chunkSize, totalChunks, received:[], status:"pending"}` (`UploadController.php:18-68`). Default chunk 8 MB (`ChunkedUpload.php:21`); web sends `chunkSize: 8388608` and concurrency `MAX_ACTIVE_JOBS = 3`, `MAX_CHUNK_RETRIES = 5` (`portal-upload-manager.js:16-19`). `versionOf` makes the upload a new version of that file (folder inherited; needs `Versions::canAddVersion`). Session TTL 24 h (`ChunkedUpload.php:24`).
2. For each missing index: `POST /uploads/{id}/chunk` **multipart** `index`, `chunk` (blob named `<name>.part`) → `{id, received:[indexes], receivedCount, totalChunks, status:"uploading"}` (`UploadController.php:70-90`; `portal-upload-manager.js:510-558`). Sequential per job; `job.confirmed = received×chunkSize`.
3. Resume: `GET /uploads/{id}/status` → same shape; client uploads the first index not in `received` (`:92-101`, `nextIndex` `portal-upload-manager.js:503-508`). Web persists jobs in `localStorage` key `tma.uploads.active` (`:20,722`).
4. `POST /uploads/{id}/complete` JSON `{conflict: null|replace|keep-both|rename, newName?}` → 201 File. First call with `conflict:null` on a duplicate name → **409** conflict payload; chunks are kept, re-POST complete with a choice (`ChunkedUpload.php:130-156`, `portal-upload-manager.js:576-600`). Version uploads skip the conflict check. Thumbnails are generated after response for raster images (`UploadController.php:150-153`).
5. `DELETE /uploads/{id}` aborts (`:158-163`). Sessions are scoped to their creator (or admin) — 403 otherwise (`:165-172`).
Statuses: `pending, uploading, processing, completed, failed, cancelled` (`app/Models/UploadSession.php:16-21`). Web emits `tma:upload-complete {folderId, file}` when done (`portal-upload-manager.js:590-592`).

### 6. Bytes: download, preview, thumbnail (`app/Support/Files/Vault.php`)

- `GET /files/{uuid}/download` (ability `download`) → `Content-Disposition: attachment`; `GET /files/{uuid}/preview` (ability `preview`, 415 if not previewable) → `inline` (`FileController.php:192-216`). Both log activity.
- Delivery (`Vault.php:305-384`): (1) local disk → `response()->file()` with Range/ETag/Last-Modified; (2) remote **and** inline **and** mime `image/*`, `video/*`, `audio/*` (never `image/svg+xml`) → **302 redirect to a signed R2 URL** valid 900 s, redirect cacheable 300 s (`:32-34, 371-381, 536-551`); (3) everything else (PDF, docs, downloads) → streamed GetObject proxy honouring `Range`, answering 206 + `Content-Range` + `Accept-Ranges: bytes` (`:403-498`).
- Cache headers `private, max-age=600, must-revalidate`; ETag from checksum (or path|size|version); `If-None-Match` → 304 before storage is touched, except on the redirect path (`:41, 339-343, 553-565`). A SharePoint-referenced file may be fetched on first read (`:262-275`).
- `GET /files/{uuid}/thumb` → JPEG ≤400 px (or sanitised SVG) with `Cache-Control: private, max-age=86400, must-revalidate` and ETag/304; trashed files admin-only (`ThumbnailController.php:13-53`, `Thumbnail.php:26`).
- PDFs have **no server thumbnail**; the web paints page 1 client-side with pdf.js from `previewUrl` using Range, one worker at a time, cached by URL (`public/js/file-thumbs.js:8-27, 42-83, 130-133`). Native: render page 1 with `PdfRenderer` from a ranged fetch.
- Viewer kinds in the web lightbox: image (`<img>`), pdf (pdf.js), audio/video (`<audio>/<video>` on `previewUrl`), `text/*` (fetched, excluding html/svg), otherwise no-preview + download (`public/js/portal-lightbox.js:69-101, 371-412`). Never iframe a document.

### 7. Viewer side panel

| Endpoint | Params | Returns | Source |
|---|---|---|---|
| `GET /files/{uuid}/activity` | `filter ∈ all,comments,shares,edits,versions,approvals,signatures,downloads,access`, `before` (id cursor) | `{filter, entries:[{id,action,text,actor:{name,isSelf,email,avatar}|null,icon,meta,at,group}], nextCursor, filters:[{value,label}]}` | `FileViewerController.php:26-45`, `ActivityFeed.php:34-58, 92-130` |
| `GET /files/{uuid}/access` | | `{sources:[{key,label,detail,role,icon,origin,total,members[],truncated}], canManage, shared:{faces,all,total,extra,summary}}` | `:48-56`, `AccessSources.php:145-214, 356-367` |
| `GET /files/{uuid}/details` | | `{counts:{comments,versions,approvals,...}, groups:[{title,rows:[{label,value}]}]}` | `:59-67`, `FileDetails.php:49-69,187-192` |
| `GET/POST/DELETE /files/{uuid}/presence` | POST `session, action ∈ viewing|editing|commenting, device?`; DELETE `session` | roster `[{id,name,email,avatar,role,action,isSelf,since}]` | `FilePresenceController.php`, `Presence.php:25-28,121-128` |

### 8. Comments & read state

- `GET /files/{uuid}/comments?before=<id>&peek=1` → `{threads:[Comment+{replies:[Comment]}], nextCursor, openCount, total, canComment, readCleared}`. **Without `peek=1` the call marks every thread on the file read** (`FileCommentController.php:23-56`). Comment: `id, body|null, anchor:{page,x,y,w,h}|null, deleted, author:{id,name,isSelf,email,avatar}, mentions:[{id,name}], createdAt, editedAt, resolved, resolvedAt, resolvedBy, replyCount, isReply, can:{edit,delete,resolve,reply}` (`CommentPresenter.php:87-116`).
- `POST` `{body ≤4000, parent?(uuid), mentions?:[userId], anchor?{page,x,y,w,h ∈ 0..1}}` → 201 Comment (`:72-108`, `Comments.php:40`). `PATCH .../{comment}` `{body, mentions?}`; `DELETE` → `{status:"ok"}`; `POST .../resolve` `{resolved:bool}` (threads only, 422 for replies) (`:112-158`). `GET .../mentionable?q=` → `{people:[{id,name,email,avatar,hasAccess}]}` (`CommentPresenter.php:187-200`).
- Unread is defined by `file_comment_reads` per thread (`CommentReads.php:57-98, 434-438`); listing rows carry `comments:{open,unread,mentionsMe}` and folders `comments:{unread}`.

### 9. Versions

`GET /files/{uuid}/versions` → `{canAddVersion, current, versions:[{id,number,isCurrent,size,sizeLabel,mime,extension,category,checksum(12),note,restoredFrom,approvalStatus,uploadedAt,uploadedBy:{name,email,avatar},can:{download,preview,restore}}]}` (`FileVersionController.php:25-70`). `POST` multipart `file, note?` → `{version, file}` (small files; large go through upload init `versionOf`). `PATCH .../{version}` `{note}`; `GET .../{version}/download|preview`; `POST .../{version}/restore` `{note?}` → `{version, restoredFrom}` (appends, never deletes bytes) (`:100-160`).

### 10. Shares (`ShareController.php`, `Sharing.php`)

- `GET /portal/files/shares?type=file|folder&id=` → `{owner:{name,email,avatar}, people:[Share], companies:[Share], link:Share|null, roles:["viewer","downloader","editor","full"]}` (`:27-37, 289-315`). Share: `{id,kind ∈ user|email|link|company, role, person|null, company:{id,name,role,label}|null, allowDownload, hasPassword, expiresAt, link (/s/{token} for link shares), createdAt}` (`Sharing.php:47-71`).
- `POST /shares` `{type,id, mode ∈ invite|link|company, role, email (invite), companyUid/companyRole (company), expiresAt?, password?, allowDownload?}` → 201 access payload; `PATCH /shares/{uuid}` `{role?,expiresAt?,password?,allowDownload?}`; `DELETE /shares/{uuid}` revokes (`:57-122`). `GET /shares/people?type&id&q` → `{people}` for assignment (`:40-55`).
- Public link pages `/s/{token}` (+`/unlock`, `/preview`, `/download`, `/file/{fileUuid}`) are HTML views with a session-held unlock flag — not JSON (`PublicShareController.php:22-160`).

### 11. Request Files (`FileRequestController.php`, `FileRequests.php`)

- `GET /portal/files/requests?folder=&client=` → `{requests:[Req], sizeChoices:[10MB,25MB,100MB,...], typeGroups:{documents,spreadsheets,presentations,...}, maxBytes}` (`:21-46`, `FileRequests.php:31-48`).
- `POST /requests` `{title ≤150, message?, folder?(uuid|"filebox"), client?, recipientEmail?, recipientName?, allowedExtensions?[], maxBytes?, maxFiles? ≤200, allowMultiple?, password? ≥4, expiresAt?, send?}` → `{request, emailed}`; `GET /requests/{uuid}` → `{request, uploads:[{id,name,size,from,at,atIso}]}`; `PATCH` (same fields + `closed`); `DELETE` → `{ok}`; `POST .../send` `{email?,name?}` → `{emailed}` (`:48-209`).
- Req shape: `id,title,message,link (/r/{token}),destination:{id,name,isFileBox},client,recipientEmail,recipientName,allowedExtensions,maxBytes,maxFiles,allowMultiple,hasPassword,expiresAt,open,closedReason,uploadCount,lastUploadAt,createdAt,createdBy` (`FileRequests.php:202-234`).
- Public receiving side `/r/{token}` is HTML; `POST /r/{token}/upload` multipart `file,name?,email?` → `{name,size,remaining}`, throttled `uploads` = 30/min/IP (`PublicUploadController.php:93-240`, `AppServiceProvider.php:257-259`).

### 12. Workflows (review/approval/acknowledgement)

- Per file: `GET /files/{uuid}/workflows` → `{canSend, badge, lockReason, workflows:[WF], openCount, total, mineCount}`; WF: `id,type,status,statusLabel,tone,message,dueAt,overdue,requireAll,ordered,requireComment,lockFile,reminderDays,version,supersededBy,sentAt,completedAt,sender:{name,avatar},steps:[{id,name,email,avatar,role,position,status,statusLabel,comment,respondedAt,delegatedFrom,reminderCount}],signedFile,myStep,myActions,canManage,isOpen` (`WorkflowPresenter.php:41-150`).
- `POST` `{type ∈ feedback|review|approval|acknowledgement (signature → 422), recipients:[{userId,position?}] ≤50, message?, dueAt?, requireAll?, ordered?, requireComment?, lockFile?, reminderDays? 1..60}` → 201 WF (`FileWorkflowController.php:35-99`). `POST .../{wf}/respond` `{action, comment?}` where actions = approval: `approve,decline,request_changes`; acknowledgement: `acknowledge`; default: `submit_feedback,request_changes` (`Status.php:154-162`). `POST .../cancel`; `POST .../delegate {step,userId}`; `GET .../history` → `{events:[{action,detail,meta,at,actor}]}` (`:103-171`).
- Statuses: `draft, feedback_requested, under_review, awaiting_approval, awaiting_acknowledgement, awaiting_signature, partially_signed, changes_requested, approved, declined, signed, acknowledged, completed, cancelled, expired` (`Status.php:15-43`).
- Hub (read-only): `GET /portal/files/workflows?scope=inbox|sent|all&type=&state=open|closed|all&q=&cursor=` → `{items, nextCursor, counts:{waiting,sent,mentions,unread,updates}, canSeeAll}`; `GET .../workflows/comments?scope=mine|unresolved|all&q&cursor`; `GET .../workflows/updates`; `GET .../workflows/counts`; `POST .../workflows/comments/{uuid}/read` marks that thread read and returns `{counts}` (`WorkflowHubController.php:15-97`, `Hub.php:59-76, 137-140, 434-438, 685-719, 765-800`).

### 13. Signatures (`app/Http/Controllers/Signatures/*`)

- `GET /portal/signatures?search&status ∈ all|draft|sent|viewed|in_progress|completed|declined|changes_requested|cancelled|expired&scope=mine|all&perPage≤200` → `{requests:[SR], canAdminView}` (`SignatureRequestController.php:37-79`, `Support/Signatures/Status.php:12-39`). `GET /documents?search` → `{files:[{id,name,extension,folder}], accepts:["pdf"]}` (PDF only, `Signable.php:22`); `GET /people?search` → `{people:[{name,email,accountType,avatar,initials,isYou}]}`.
- `POST /` `{fileId, title?, subject?, message?}` → draft; `GET /{uuid}` → `{request}` with audit; `PATCH /{uuid}` `{title?,subject?,message?,folderId?,recipients:[{name,email,role ∈ signer|approver|cc,order}] ≤25}`; `DELETE`; `POST /{uuid}/send {expiresInDays? 1..365}`; `/remind` → `{reminded}`; `/cancel {reason?}`; `GET /{uuid}/links` → `{links:[{recipient,name,email,status,canSign,url}]}` (`:161-500`).
- SR shape: `id,title,status,statusLabel,subject,autoDeleteDays,recipients:[{id,name,email,role,order,status,statusLabel,initials,viewedAt,signedAt,declinedAt,declineReason,comment}],progress:{signed,total,percent},document:{id,name},signedDocument,folder,createdBy,createdAt,sentAt,completedAt,declinedAt,cancelledAt,expiresAt,permissions:{open,edit,...}` (`Support/Signatures/Presenter.php:45-104, 170-171`).
- Editor: `GET /{uuid}/document` streams the PDF inline (`Vault::preview`); `GET /{uuid}/fields`; `PUT /{uuid}/fields {fields:[{type ∈ signature|initials|name|email|date|text|checkbox, recipient(uuid), page 1..500, x,y ∈ 0..1, width,height ≥0.005, required?}]}` ≤200, replaces the set; 422 if a field runs off the page (`SignatureFieldController.php:20-113`, `FieldType.php:14-34`).
- Public signing `/sign/{token}` (throttle `signing` 60/min/IP, `AppServiceProvider.php:240-242`): `GET /document` (PDF, only on the recipient's turn), `POST /progress {values:{fieldUuid:value}}` autosaved every 700 ms → `{saved:true}`, `POST /submit {values}` → `{done,status}` (422 `'Please complete every required field.'`), `POST /decline {reason?}`, `POST /approve {comment?}`, `POST /request-changes {comment}` (`PublicSigningController.php:86-283`, `public/js/sign.js:213-217, 520`). Signature/initials values must be `data:image/png;base64,...` (`FieldValue.php:49-65`). These POSTs still require the CSRF cookie/header — the token is the only identity, but `validateCsrfTokens` applies (`bootstrap/app.php:34`).

### 14. Shortcuts, library settings, sync status

- `GET /portal/files/shortcuts` → `{shortcuts:[{id,name,parent,colour,iconName}], groups:{libraries,assignedClients,organization,staff}}`; `POST {folder}` (201/200, max cap 422); `PUT /reorder {order:[uuid]}`; `DELETE /{uuid}` (`ShortcutController.php:30-235`).
- Admin only: `GET/PUT /portal/file-library/settings` (`clientSubfolders[], autoCreateStaffFolder`), organization folders (`audience ∈ all_staff|selected`, `role ∈ viewer|editor`, `archived`), folder templates and `POST /folder-templates/{id}/apply {folder}` → `{created, skipped}` (`app/Http/Controllers/FileLibraryController.php:26-249`).
- `GET /portal/files/sync-status` → `{connections:[{id,name,folder,status,enabled,importsPaused,items,itemsTotal,failedItems,conflicts,lastSuccessAt,lastError,initialImport,contentPending}], syncing, importsPaused, hasError, conflicts}`; `POST /sync-status/retry {connection?}` (admin) and `/pull` → `{status:"queued"|"skipped", count?}` (`SyncStatusController.php:25-164`).

### 15. Offline replica — `GET /portal/files/sync`

Params `foldersSince, foldersAfter, filesSince, filesAfter` (ISO time + id cursor); 200 rows per table per call, ordered `updated_at, id`; response `{folders:[Folder|Tombstone], files:[File|Tombstone], cursor:{folders:{since,after},files:{since,after}}, more}`; tombstone = `{id,type,deleted:true,deletedAt}`; folders come without stats (`app/Http/Controllers/Files/SyncController.php:19-150`). Scope is every folder the account owns, is shared, or can see by system rule plus descendants; admins see everything except other people's personal drives (`SyncScope.php:53-119`). The desktop walker stores `files:folder:<uuid>` / `files:item:<uuid>`, cursor under `files:sync-cursor`, max 30 pages per wake, then emits `tma:files-synced` (`public/js/files-sync.js:20-56`). Offline listings are assembled from the replica only for `all`/`my` roots and folder children, without search/filters, folders-first windowing, and `my` requires the cached `/me` id to filter by `owner.userId` (`portal-files.js:590-660`).

### 16. Row / context-menu actions to replicate

Single item (`portal-files.js:7435-7511`): Open/Preview; Download (folder → ZIP) if `permissions.download`; Send for signature (PDF); Share, Assign to people, Copy link if `share`; Request files into this folder; Cut/Move to… if `move`; Copy if `copy`; Rename if `rename`; Folder appearance if `colour`; Add/Remove favourites; Add/Remove Folder Shortcuts; Make default folder (admin); Change status (review); View details; Delete if `delete`. Recycle bin rows: Restore, Delete permanently, View details. Bulk toolbar: download, status, signature, appearance, move, copy, delete, restore, force, favorite, empty bin (`:6105-6123`). Selection is explorer-style (click / shift / ctrl, double-click opens) per memory `explorer-select-everywhere`.

### Open questions / not found

- No dedicated JSON endpoint for the public share page (`/s/{token}` is HTML only).
- `FileAccess::can()` role resolution for folder types (client/staff/org) was not traced line-by-line; rely on `permissions` in each record.
- Whether the mobile app can use Sanctum tokens instead of the session cookie is outside this brief (auth brief).

---

### A4. Clients hub, companies, assignments, CIP, CBI, templates

All paths are relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Every endpoint below sits inside the group at `routes/web.php:162` — middleware `auth, verified, profile.complete, account.approved, onboarded, mfa.enforced` — and is session-cookie authenticated (no bearer tokens exist for these routes). There is no `/api` prefix: the paths are `/portal/...` on the same origin the SPA uses.

### 0. Transport contract every call shares (from the JS the web client actually uses)

`public/js/clients.js:463-503` (`clientsFetch`) and `public/js/cip-intake.js:1111-1131` (`headers`) send:

| Header | Value | Why |
|---|---|---|
| `Accept` | `application/json` | Without it a 401/419/403 comes back as an HTML redirect/page. |
| `X-Requested-With` | `XMLHttpRequest` | Same reason. |
| `X-XSRF-TOKEN` | value of the `XSRF-TOKEN` cookie, on every non-GET | Laravel CSRF; a stale token is a **419**. |
| `X-Socket-ID` | Reverb socket id when connected (`public/js/portal-live.js:65-69`) | Server broadcasts `->toOthers()` (`app/Support/Realtime/Live.php:161`); without it the writer receives its own echo. |
| `Content-Type` | `application/json` for JSON bodies; **omitted** for multipart | Browser sets the boundary. |
| credentials | `same-origin` | Cookie session. |

Errors: the body is `{message}` (plus `{errors: {field: [msg]}}` on **422**); `clients.js:484-488` throws `Error(data.message)` with `.status`. Validation messages are field-keyed to the *camelCase request keys* (e.g. `passportBioPage.0`, `sponsor.dateOfBirth`; `cip-intake.js:1268-1278`). Deleted/unreachable records answer **404, never 403** (`app/Support/Access/ClientScope.php:69-74`, `app/Support/Cip/ApplicationScope.php` `findOrFail`). A capability refusal is **403** with `{message: "You do not have access to this."}` (`app/Http/Middleware/EnsureCapability.php`, `app/Support/Access/Role.php:606-609`).

After any non-GET write, the web app invalidates every cached `clients:*` key (`clients.js:497-499`). Realtime: the server fires the Reverb event **`data.changed`** with payload `{resource}` on private channels `portal.staff` and `App.Models.User.{id}` (`app/Events/PortalDataChanged.php:55-63`, `app/Support/Realtime/Live.php:79-110`). Resources this subsystem raises: `clients`, `companies`, `cip` (`Live.php:33,41,69`). It is a signal, not a payload — re-fetch on receipt (`clients.js:14088,14141` registers refreshers for `CLIENTS` and `CIP`).

All timestamps are ISO-8601 with offset (`toIso8601String()`); **dates** (`submittedAt`, `decidedAt`, milestone `date`, `dateOfBirth`, custom `date` fields) are bare `Y-m-d` strings (`toDateString()`), so parse them as local calendar dates, not instants.

### 1. Capability gates (Role matrix, `app/Support/Access/Role.php`)

Administrators pass every check (`Role.php:509-512`). The matrix lists which *non-admin* account types hold a capability; officers (`CRO / Reviewing officer`, `Compliance Officer`) inherit anything held by `Employee` (`Role.php:520-527`).

| Capability | Non-admin holders | Note |
|---|---|---|
| `clients.view` | Employee | Gates the whole hub, companies, conversations (`ClientsController.php:522-528`). |
| `clients.viewAll` | *(nobody)* | Without it a user sees only clients with a **live** assignment (`ClientScope.php:32-55`). |
| `clients.manage` | Employee | create/edit/delete/duplicate clients; company member writes. |
| `clients.invite` | Employee | `POST /portal/clients/{uid}/invite`. |
| `clients.assign` | *(nobody)* | client + company staff assignments. |
| `cip.view`, `cip.create`, `cip.review`, `cip.compliance`, `cip.decide` | Reviewing officer | Plain `Employee` is explicitly **excluded** from CIP (`app/Support/Cip/CipAccess.php` `canReach`). |
| `cip.assign`, `cip.configure`, `cip.report` | *(nobody)* | admin only. |
| `templates.view` | *(nobody)* | system-email templates. |
| `templates.email` | Employee | compose templates. |
| `settings.clientHub` | *(nobody)* | client-hub settings, custom fields, service teams. |

The five `clients.*` employee grants are **admin-editable** via `GET/PUT /admin/client-hub` (`app/Http/Controllers/ClientHubSettingsController.php`, `app/Support/Clients/ClientHubSettings.php:42-51`), so an Android client must read the effective capability list from `/me` rather than hard-code roles. Every `cip.*` capability is denied to everyone (admins included) unless `FEATURE_CIP=true` (`config/services.php:126`, `Role.php:506-508`); CBI needs `FEATURE_CBI=true` **and** an administrator, else 404 (`app/Http/Controllers/Cbi/CbiController.php:31-35`). CIP is also reachable by external accounts with no capability: a **provider contact** (active `CompanyMember` of a company registered as a `CipProvider`) or a **private client** (a `Client` row whose `user_id` is the user) (`CipAccess.php` `canReach`, `isProviderContact`, `isPrivateClient`).

### 2. Clients hub — `/portal/clients` (`routes/web.php:797-829`, `app/Http/Controllers/ClientsController.php`)

| Method + path | Gate | Request | Response |
|---|---|---|---|
| `GET /portal/clients` | clients.view | — | `{clients: [directoryRow], customFields: [field]}`; cached 60 s per viewer (`ClientDirectory.php:26,45-58`). No `profile`. |
| `GET /portal/clients/sync?since&after` | clients.view | see §2.3 | `{clients:[record|tombstone], cursor:{since,after}, more}` |
| `GET /portal/clients/preview?limit=10&sort=name|latest` | clients.view | limit clamped 1–20 | `{clients:[directoryRow]}` |
| `GET /portal/clients/search?q=&limit=` | clients.view | `q` < 2 chars returns empty; `limit>0` returns records (cap 50) else ids | `{query, ids:[uid]}` or `{query, clients:[directoryRow]}` |
| `GET /portal/clients/assigned-to-me` | clients.view | — | `{clients:[{id,name,folderUuid}]}`; admins get every client (`ClientAssignmentController.php:47-70`). |
| `POST /portal/clients` | clients.manage | §2.2 body, `uid` required | `{client: record}` |
| `GET /portal/clients/{uid}` | clients.view | — | `{client: record}` (404 if out of scope) |
| `PATCH /portal/clients/{uid}` | clients.manage | §2.2 body, `uid` optional | `{client: record}` |
| `DELETE /portal/clients/{uid}` | clients.manage | — | `{status:"ok"}` (soft delete; ends assignments/invites via `AccessSync::clientArchived`) |
| `POST /portal/clients/bulk-delete` | clients.manage | `{uids:[string]}` | `{deleted: n}` |
| `POST /portal/clients/{uid}/duplicate` | clients.manage | — | `{client: record}` (uid `-copy`, name ` (copy)`) |

#### 2.1 Record shapes (`app/Models/Client.php:145-212`)

`toRecord()` (profile / sync / writes): `id` (= `uid`, a slug), `name`, `initial`, `initialColor`, `photo`, `profile` (the verbatim `data` JSON blob), `folderUuid`, `hasLogin`, `userId`, `companyId` (company uid), `companyName`, `clientType` (`private|company`), `clientTypeLabel`, `referralType` (`company|private|none`), `referredByCompanyId`, `referredByLabel`.

`toDirectoryRecord()` (listing/preview/search): same minus `profile`, plus `contact` (email if login is live else phone; `Client.php:88-100`).

`profile` is loose by design (`ClientsController.php:363-389`): validated keys are `phones`, `emails`, `addresses`, `importantDates`, `work` (arrays); name is derived from `name` or `profile.firstName/middleName/lastName` (`:496-510`); `email`/`phone` columns are the first `{type,value}` entry with a non-empty `value` (`:513-527`). Custom-field answers live under `profile.custom[{fieldId}: value]` and are sanitised on every write against `GET /admin/client-fields` definitions (`app/Support/Clients/ClientCustomFields.php:32-35,139-172`): unknown ids dropped, `number`→float, `date`→`Y-m-d`, `select` must match an option, text clipped to 1000 chars.

#### 2.2 Write body (`ClientsController.php:365-381`)

`uid` (`^[a-z0-9-]+$`, ≤96; server de-duplicates by appending `-2`, `-3`…), `name`, `initial` (≤4), `initialColor` (≤24), `companyId` (company uid), `clientType` (`private|company`), `referralType` (`company|private|none`), `referredByCompanyId`, `profile` (required array). `referralType=company` degrades to `none` when the company uid does not resolve (`:404-419`).

#### 2.3 Offline replica cursor (`ClientsController.php:73-112`, `public/js/clients-sync.js`)

Params `since` (ISO timestamp, unparseable = no cursor = full walk) and `after` (integer row id). Predicate is `updated_at > since OR (updated_at = since AND id >= after)` — the boundary row is re-delivered on purpose; upsert it. Page size **200**, ordered `updated_at, id`; `more` is true when the page is full. Soft-deleted rows arrive as `{id, deleted:true, deletedAt}` — remove the local row. Web stores the cursor object verbatim under `clients:sync-cursor` and records under `clients:record:{uid}`, walking at most 40 pages per wake; wakes are `online`, `tma:queue-applied` and `/me` answering — never a timer (`public/js/portal-replica.js:103-108`). Client accounts get 403 here; the walker fails quietly.

### 3. Assignments, invites, access, conversations

| Method + path | Gate | Body | Response |
|---|---|---|---|
| `GET /portal/clients/{uid}/assignments` | clients.view | — | `{assignments, history, assignable, roles:[{value,label}], levels:[string]}` |
| `POST …/assignments` | clients.assign | `userId` (staff only, else 422), `role`, `level` (required), `primary`, `startsAt`, `endsAt` (after now), `notes` ≤2000 | `{assignments, assignable}` |
| `PATCH …/assignments/{userId}` | clients.assign | any of `role, level, primary, endsAt, notes` | `{assignments}` |
| `POST …/assignments/{userId}/reassign` | clients.assign | `{toUserId}` | `{assignments, assignable}` |
| `DELETE …/assignments/{userId}` | clients.assign | — | `{assignments, history, assignable}` (row kept as `ended`) |
| `POST /portal/clients/{uid}/invite` | clients.invite | optional `email` | `{status:"ok", reminder:bool, invitation}`; 422 if account exists / no email |
| `GET …/invite` | clients.view | — | `{hasAccount, invitation|null}` |
| `GET …/access` | clients.view | — | `{hasAccount, account:{name,email,status,accountType,avatar,createdAt,onboardedAt,twoFactor}|null, invitation, logins:[{event,atIso,when,ip,device}], activity:[{type,description,atIso,when}]}` |
| `GET …/conversations` | clients.view | — | `{options:{provider:{available,companyName,companyId,accountCount,contacts},person:{available,name}}, conversations:[messaging conversation], recordings:[{id,clientName,participants,media,status,durationMs,startedAt,endedAt,conversationId}]}` |
| `POST …/conversations` | clients.view | `{with:"provider"|"person"}` | **201** `{conversation}` |

Assignment record (`app/Models/ClientAssignment.php:156-176`): `userId,name,email,avatar,role,roleLabel,level,primary,status(active|ended),live,notes,assignedBy,assignedAt,startsAt,endsAt,endedAt`. Roles: `reviewing_officer, compliance_officer, account_manager, booking_coordinator, finance, contract_manager, event_coordinator, general` (`:40-49`). Levels (lowest→highest): `view_only, view_files, contributor, editor, manager, full` (`:55-62`). "Live" = active AND started AND not lapsed (`:73-90`) — an assignment can silently expire client-side, so re-evaluate `endsAt` locally. Invitation record shape is `app/Support/Invitations/Invitations.php:412-449` (`id,type,typeLabel,email,name,role,offer,status,client,company,invitedBy,sentAt,expiresAt,acceptedAt,cancelledAt,sendCount,lastError,delivery,canResend,canCancel`); resend/cancel/link go to `/portal/invitations/{uuid}/…` (`routes/web.php:831-840`).

### 4. Companies — `/portal/companies` (`routes/web.php:842-866`, `app/Http/Controllers/CompaniesController.php`)

All routes gate on `clients.view` (writes included — `CompaniesController.php:478-484`); member writes need `clients.manage`; staff writes need `clients.assign`.

| Method + path | Body / notes | Response |
|---|---|---|
| `GET /portal/companies` | viewer-scoped (`CompanyScope`); cached 60 s for full-book viewers | `{companies:[company]}` |
| `POST /portal/companies` | `name` required; `uid, website, notes, logoUrl, companyType, registrationNumber, taxNumber, industry, email, phone, address{}, billing{}, status(active|prospect|archived), cipCode(alpha ≤8)` | **201** `{company}` |
| `GET /portal/companies/{uid}` | — | `{company}` |
| `PATCH /portal/companies/{uid}` | same keys, all optional; renaming rewrites linked clients' `profile.work.company` | `{company}` |
| `DELETE /portal/companies/{uid}` | optional `withPeople=true` deletes its contacts + referred clients; **422** if it backs a CIP provider | `{status:"ok"}` |
| `GET …/members` | — | `{members, removed, roles:[{value,label}], abilities:[flag]}` |
| `POST …/members` | `role` required (`primary,finance,event,signatory,viewer,member`), `name,email,jobTitle,primary,clientUid,invite,abilities{}`; email or clientUid required | **201** `{member, members, invitation}` |
| `POST …/members/{uuid}/invite` | — | `{invitation, members}` |
| `PATCH …/members/{uuid}` | `role, primary, abilities{}` | `{member, members}` |
| `DELETE …/members/{uuid}` | — | `{members}` |
| `GET …/staff` | — | `{assignments, history, assignable, roles, scopes:[{value,label}]}` |
| `POST …/staff/preview` | `{appliesToClients}` | `{preview:{appliesToClients,label,companyName,contactsCovered,contactsWithLogins,includesFuture,memberCount}}` |
| `POST …/staff` | `userId, level` required; `role, appliesToClients(company_only|existing|existing_future), primary, endsAt, notes` | `{assignments, assignable, applied}` |
| `DELETE …/staff/{userId}` | — | `{assignments, assignable}` |

Company shape (`app/Models/Company.php:123-183`): `id(uid), name, logoUrl, cipCode, companyType, companyTypeLabel, registrationNumber, taxNumber, industry, website, email, phone, address, billing, status, notes, memberCount, peopleCount, referredCount, referred:[{id,name,initial,email}] (max 12), people:[{id,name,initial,initialColor,email,hasLogin}]`. Member record (`app/Models/CompanyMember.php:135-157`): `id(uuid),name,email,jobTitle,role,roleLabel,primary,status(invited|active|removed),hasAccount,avatar,clientUid,abilities{can_view_bookings,can_manage_bookings,can_view_files,can_upload_files,can_view_invoices,can_view_contracts,can_sign_contracts,can_invite_others},addedAt,removedAt` plus `inviteSent`, `inviteError` from the controller. Staff-assignment record adds `appliesToClients`, `appliesLabel` (`app/Models/CompanyStaffAssignment.php:114-133`).

### 5. CIP — `/portal/cip` (`routes/web.php:384-580`, `app/Http/Controllers/Cip/*`)

Scope (`app/Support/Cip/ApplicationScope.php`): admin = all; officer = applications where they hold a live application **or client** assignment; plain staff = nothing; external = applications of their provider firm(s) or where the client row is theirs. Out-of-scope = 404.

#### 5.1 Read endpoints

| Method + path | Gate | Params | Response |
|---|---|---|---|
| `GET /portal/cip/dashboard` | reach | — | `{cip:false,buckets:[]}` or `{cip:true, staff, card, dashboard(administrator|reviewing_officer|service_provider), buckets:[{key,label,short,count,statuses,scope(all|mine),tone,filter:{bucket},aggregate}], total}` (`Buckets.php:304-360`). Never cached. |
| `GET /portal/cip/applications` | reach | `q`≤120, `status`, `bucket`, `assignee`, `provider` (comma lists ≤400), `page`, `perPage`≤200 (default 50), `sort` ∈ `number,applicant,provider,contact,email,investment,family,status,assigned`, `dir`, `phase` ∈ `pre_approval,post_approval,closed` | `{applications:[row], page, lastPage, perPage, total, statuses:[{value,label,tone}], personStatuses, assignees, providers, phaseCounts:{all,pre_approval,post_approval,closed}}`. Unknown bucket = **404**. |
| `GET /portal/cip/applications/sync?since&after` | reach | same pair-cursor contract as §2.3, page **50**, full `record`s | `{applications:[record], cursor:{since,after}, more}` |
| `GET /portal/cip/applications/{uuid}` | scope | — | `{application: record}` (materialises checklist; provisions folder) |
| `GET /portal/cip/clients/{uid}/application` | reach | — | `{application: record|null, client: clientRecord|null}` — the door for provider contacts who get 403 on `/portal/clients/{uid}` |
| `GET /portal/cip/applications/form?phase=` | create | — | `{providers:[{id,name,code}], providerFixed, countries:[{value,label,region}], investmentTypes:[{value,label}], genders:["Male","Female"], requirements:{principal,sponsor,spouse,dependent_under_16,dependent_16_over:[{key,field,label,help,required,realEstateOnly,atFiling}]}, phase, photoRequired{...}, dependentAgeCutoff}` |
| `GET …/{uuid}/events?limit≤500` | scope | — | `{events:[{id,action,when,who:{name,avatar},what}]}` |
| `GET …/{uuid}/messages?peek=1` | reach | `peek` skips mark-read | `{canPostInternal, lanes:[internal|provider], messages:[{id,body,lane,laneLabel,author:{name,email,avatar},mine,createdAt}]}` |
| `GET …/{uuid}/assignments` | scope | — | `{assignments:[{userId,name,email,avatar,role,roleLabel,assignedAt}], canAssign, assignable:[{id,name,email,avatar,accountType,role}], roles}` |
| `GET /portal/cip/documents/{uuid}/comments` | canJoin | — | `{comments:[{id,body,author,mine,canEdit,edited,resolved,resolvedBy,repliesCount,createdAt,replies}]}` |
| `GET /portal/cip/people/{uuid}/passport-photo?v=` | scope | — | image bytes, `Cache-Control: private, max-age=3600` |
| `GET /portal/cip/requirements`, `/letters`, `/distribution` | reach (writes: admin / `cip.configure`) | — | config screens; see controllers |

Table row (`CipApplicationController.php:767-810`): `id, clientUid, attention:{comments,mentionsMe,messages}|null, number, internalNumber, cipNumber, submittedAt, photo, applicantName, provider, contactPerson, contactEmail, investmentType, familySize, familyLabel("F6"), status, statusLabel, statusTone, locked, corLocked, cor/nic/passport…At dates, stageAction, phase, phaseLabel, availableTransitions:[{value,label,tone}], availableOverrides, assignedTo:[{name,first,email,avatar,userId,roles}], familyMembers` (post-approval only).

Full record (`:1324-1420`): the row fields plus `queryReceivedAt, acceptedAt, decision, decidedAt, decisionLetter:{fileId,fileName}, postApprovalAt, personStatuses, locked, lockedAt, corLocked, corLockedAt, canConfirm, additionalDocumentsFolder, providerId, providerCode, investmentTypeValue, investmentTypeOther, sponsored, applicant, sponsor, dependents:[person], milestones:[{key,label,date,reached,canEdit,canRecord}], assignedOfficer:{name,email,avatar}|null, createdAt, clientUid, updatedAt`. Person (`:1524-1668`): `id, role(main_applicant|sponsor|dependent), label, relationship, dependentOrdinal, name, firstName, lastName, gender, dateOfBirth, countryOfBirth, countryOfResidence, region, occupation, passportNumber, photo, passportPhotoUrl, photoFile, applicantType, applicantTypeLabel, documents:[slot], outstanding:[label], availableStatuses, availableStatusOverrides` (+ post-approval status fields). Slot: `id, type, label, required, help, carriedForward, uploaded, status(pending_upload|application_review|update_required|ready_for_submission), statusLabel, statusTone, updateReason, canReview, canUpload, fileId, comments, fileName, fileSize, fileExt, thumbUrl, previewUrl, downloadUrl, fileMime, fileCategory`.

Statuses (`app/Support/Cip/Status.php`): `draft, new, review_application, assessment_feedback, update_required, ready_to_submit, pending_review, non_compliant, background_check, delayed, granted, post_approval, apply_for_cor, pending_cor, apply_for_nic, pending_nic, apply_for_passport, pending_passport, ready_for_delivery, closed, denied`; labels/tones there (e.g. `granted` → "Approved"/`success`). Transition map is `app/Support/Cip/Engine.php:27-45`; **never** compute it locally — draw `availableTransitions`/`availableOverrides`. Milestone keys: `filed, locked, submitted, query_received, accepted, decision, cor_submitted, cor_received, nic_submitted, nic_received, passport_submitted, passport_received, passport_delivered` (`Milestones.php`). Stage keys = the last seven (`Stages.php`).

#### 5.2 Write endpoints

| Method + path | Gate | Body | Response |
|---|---|---|---|
| `POST /portal/cip/applications` | create | **multipart** (§5.3) | **201** `{application}`; **200** on idempotent replay; **409** `{duplicate:{id,internalNumber,name}}` for admins (resend with `allowDuplicate=1`), **422** for others |
| `POST …/{uuid}` (update, not PATCH) | create; 422 if locked | multipart, same fields optional | `{application}` |
| `POST …/{uuid}/status` | engine decides | `{status, note≤2000}` | `{application}` — **reduced** shape (`CipTransitionController.php:236-270`), re-read the full record after |
| `POST …/{uuid}/submit` (draft→new) | reach | — | `{application}` or 422 `{message, outstanding:[label]}` |
| `POST …/{uuid}/confirm` | submitting party/admin | `{lockedAt?}` | `{application}` |
| `POST …/{uuid}/submission` | reach | `{cipNumber, submittedAt(date)}` | `{application}` full |
| `PATCH …/{uuid}/cip-number` | reach | `{cipNumber}` | full |
| `POST …/{uuid}/query` | status rules | `{queryReceivedAt, override?, note?}` | reduced |
| `POST …/{uuid}/acceptance` | | `{acceptedAt, override?, note?}` | reduced |
| `POST …/{uuid}/decision` | | multipart `decision(granted|denied), decidedAt, note?, decisionLetter (PDF, required on first decision)` | reduced |
| `POST …/{uuid}/stage` | | `{stage, date}` | reduced |
| `POST …/{uuid}/post-approval` | canChangeApplicationStatus (403) | — | full |
| `PATCH …/{uuid}/milestones/{key}` | per-key capability | `{date}` | full |
| `POST …/{uuid}/messages` | reach | `{body≤4000, lane?}` | **201** message |
| `POST/DELETE …/{uuid}/assignments[/{userId}]` | cip.assign (403) | `{userId, role?}` | **201**/200 assignments payload |
| `POST /portal/cip/documents/{uuid}/file` | create | multipart `file` (photo slot: image ≤8 MB; else `pdf,jpg,jpeg,png,webp,heic` ≤10 MB) | `{document:{id,uploaded,status,…,canUpload}, application:{id,status,…,locked,canConfirm}}` |
| `POST /portal/cip/documents/{uuid}/approve` / `request-changes` | cip.review (403) | `{comment}` for changes | `{document:{id,status,statusLabel,statusTone,openComments}, application:{…}, progress:{total,required,outstanding,complete,counts}}` |
| `POST/PATCH/DELETE …/documents/{uuid}/comments[/{c}]`, `POST …/resolve` | canJoin | `{body, parent?}` | comment record |
| `POST /portal/cip/people/{uuid}/status` | canChangeApplicationStatus; post-approval only (422) | `{status ∈ not_started,documents_pending,documents_in_review,update_required,ready_for_submission,processing,completed, note?}` | `{application}` full |

#### 5.3 Intake multipart (`app/Support/Cip/Intake.php:170-384`, `public/js/cip-intake.js:1132-1225`)

Field names are bracketed paths: top-level `firstName,lastName,gender,dateOfBirth,countryOfBirth,countryOfResidence,occupation,passportNumber,investmentType,investmentTypeOther,sponsored(1|0),providerId,phase,submissionId,allowDuplicate`, `passportPhoto` (file), document slots as `{camelKey}[]` (max 10 files each), `sponsor[firstName]`…`sponsor[passportPhoto]`, `dependents[0][firstName]`, `dependents[0][relationship](spouse|qualified)`, `dependents[0][id]` (uuid on edit). Pre-approval filing demands only the principal's `passportPhoto`, `passportBioPage[]`, `birthCertificate[]` (`Intake.php:62-66`). `submissionId` is a client-minted key that makes retries idempotent (`CipApplicationController.php:153-171`). The web queues this whole request offline through `TMAQueue.add({kind:'cip.application', method:'POST', url, parts})` (`cip-intake.js:1353-1368`), replaying on reconnect and firing `tma:queue-applied`.

### 6. CBI (Smartsheet mirror) — `/portal/cbi` (`routes/web.php:1277-1287`, `app/Http/Controllers/Cbi/CbiController.php`)

Admin + `FEATURE_CBI` only, else 404. `GET /summary` → `{stages, total, needsReview, facets:{statuses,referredBy,investmentOptions,assigned,nationalities:[{value,n}]}, sync:{configured,lastSuccessAt,sheets,sheetsWithErrors,syncing}, documents}`. `GET /applications?stage(applications|assessment|tracker|closed)&status&referred_by&investment_option&nationality&assigned_to&needs_review=1&received_from&received_to&q&sort(recent|name|received|status)&per_page(10–100)&page` → `{items:[{uuid,applicantName,applicantNumber,stage,status,progress,referredBy,people,investmentOption,nationality,dependents,receivedAt,decisionReceivedAt,modifiedAt,needsReview,granted}], total, page, lastPage}`. `GET /applications/{uuid}` → `{application (detailPayload :299-366), sources, attachments, pendingDocuments, folderUuid, comments, events, assessment}`. `POST /applications/{uuid}/comments {body≤8000}`; `GET/POST /sync`; `GET /attachments/{id}` redirects to Smartsheet. Read-only mirror otherwise — treat as low priority for Android.

### 7. Templates — `/portal/templates` (`routes/web.php:878-893`, `app/Http/Controllers/TemplatesController.php`)

Middleware `capability:templates.view` on system emails; `capability:templates.email` on compose templates. `GET /system-emails` → `{canEdit, fieldLabels, fieldOrder:[subject,preheader,eyebrow,greeting,title,lead,body,quote,button,footNote], htmlFields:[body,footNote], templates:[{key,name,category,when,customized,updatedAt,editor,subjectFixed,fields,defaults,editable,variables:[{token,meaning}]}]}`; `PATCH /{key} {fields{}}`, `POST /{key}/restore`, `POST /{key}/preview {fields?}` → `{subject, html}`. Compose: `GET /email-templates` → `{canShareDefaults, templates:[{id,name,subject,body,bodyHtml,shared,mine,canEdit,updatedAt,editor}]}`; `POST` `{name≤191, subject≤500, body≤20000, shared?}` → 201; `PATCH /{uuid}`; `DELETE /{uuid}` → `{ok:true}`; `POST /preview {subject,body}` → `{subject, html}`.

### 8. Client onboarding — `/onboarding` (`routes/web.php:1368-1376`, `app/Http/Controllers/ClientOnboardingController.php`)

**Not a JSON API.** Blade-rendered forms with redirects, gated by `auth, verified, account.approved` only (runs *before* `onboarded`). Steps `welcome (optional), you, contact, calendar (optional), terms` (`app/Support/Onboarding/ClientFlow.php:23-28`); `POST /onboarding/{step}` accepts form fields (`you`: `first_name,middle_name,last_name,photo`; `contact`: `email_confirmed,phone,uses_whatsapp,preferred_contact ∈ Email|Phone|WhatsApp|Portal messages`; `terms`: `accept_terms`) and redirects; `POST /onboarding-complete` finishes. A native client must either drive these as form POSTs with `Accept: application/json` (expect 302s) or leave onboarding to a one-time browser step — no JSON contract was found.

### 9. Deep links and page gating

Hub pages live at `/citizenship-applications[/…]` (`app/Support/Cip/Pages.php`); `/clients/*` 302-redirects there (`app/Http/Controllers/LegacyPageController.php:200-219`). Path grammar (`public/js/clients.js:1170-1207`): `''` list, `/new`, `/{uid}`, `/{uid}/edit`, `/companies/new`, `/companies/{uid}`, `/companies/{uid}/edit`, `/applications/new[?phase=post_approval]`, `/applications/{id}/edit`. Notification `action_url`s use `Pages::application(uid)`. List tabs: `all_applications, pre_approval, post_approval, closed, providers, people` (`clients.js:174-181`); profile tabs: `info, folders(Documents), assigned, messages, access`, and for CIP applicants `overview, applicant, sponsor?, dependents?, …, activity` (`:356-367, 6075-6095`).

### 10. Gotchas for a native client

1. Send `Accept: application/json` everywhere or a lapsed session returns HTML; 419 means refresh the XSRF cookie and retry.
2. CIP update is `POST`, not `PATCH/PUT` (PHP parses multipart only on POST — `routes/web.php:395-398`).
3. Transition verbs return a **reduced** application; re-read `GET /portal/cip/applications/{uuid}` before painting the profile.
4. Bare `status` posts to `submit-draft`, `pending_review`, `non_compliant`, `background_check`, `delayed`, `granted/denied`, or any stage destination are refused with 422 — use the dedicated verb (`CipTransitionController.php:44-66`).
5. Both sync cursors re-deliver the boundary row; persist `cursor` verbatim and upsert by `id`. Sync pages do **not** materialise checklists; only `show`/`forClient` do.
6. `hasLogin`/`contact` hide the email of a binned account; do not derive from `profile.emails`.
7. Assignment liveness depends on wall-clock `startsAt/endsAt`; recompute locally.
8. Directory row `id` **is** the uid slug; company `id` is its uid; CIP ids are uuids; person/document ids are uuids; assignment addressing uses integer `userId`.
9. Passport-photo URLs carry a `?v=` revision and are cache-private for an hour; the file thumb/preview/download URLs are signed revisioned routes from the File Library.
10. `attention` is `null` when nothing waits — absence means draw nothing.

---

### A5. Mailbox

All paths relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Facts come from code; anything not seen is marked **not found**.

### 1. Where it lives

| Concern | File |
|---|---|
| Routes (`/portal/mail/*`, all behind `capability:mail.use`) | `routes/web.php:895–956` |
| Controller (every endpoint) | `app/Http/Controllers/MailController.php` (2657 lines) |
| Capability gate | `app/Http/Middleware/EnsureCapability.php` → `Role::can`; `mail.use` is granted to `EMPLOYEE` only (`app/Support/Access/Role.php:226`). Clients never get the mailbox. 403 body: `You do not have access to this.` |
| Account lookup / folders | `app/Support/Mail/Mailbox.php` (`FOLDERS = ['inbox','sent','draft','spam','trash','archive']`, `accountFor`, `requireAccountFor`) |
| Provider abstraction | `app/Support/Mail/MailProvider.php`; `GmailProvider.php`, `GraphProvider.php` |
| Models / JSON shapes | `app/Models/MailMessage.php` (`toRow`, `toRecord`), `MailAttachment.php`, `MailLabel.php`, `MailDraft.php`, `MailSyncProgress.php` |
| Outbound helpers | `app/Support/Mail/OutboundFiles.php`, `OutboundImages.php`, `InlineImages.php`, `DraftContent.php`, `RecipientSuggester.php`, `SignatureImporter.php` |
| 409 reconnect exception | `app/Support/Mail/MailAuthException.php`; rendered in `bootstrap/app.php:93–101` |
| Web client | `public/js/email-api.js` (the fetch layer, every endpoint), `public/js/email.js` (14.4k lines of UI), `public/js/email-templates.js` (system-email postcards, NOT compose templates) |
| Search drawer / site search consumer | `public/js/portal-search-index.js:442–444` |
| Notifications emitted by sync | `app/Support/Mail/MailSynchronizer.php:535–595`; types in `app/Support/Notifications/NotificationType.php:26–33` |

### 2. Transport contract (from `public/js/email-api.js:17–55`)

- Base URL: `{SITE_ROOT}/portal/mail`. Session-cookie auth (`credentials: 'same-origin'`), no bearer tokens exist for this API.
- Every request sends `Accept: application/json` and `X-Requested-With: XMLHttpRequest`. Non-GET adds `X-XSRF-TOKEN` = URL-decoded value of the `XSRF-TOKEN` cookie. JSON bodies use `Content-Type: application/json`.
- Error shape: non-2xx with a JSON body `{ "message": "..." }`; the client throws `Error` with `.status`, `.data`, and `.reconnect = !!data.reconnect`.
- **409 = reconnect.** Any `MailAuthException` on `portal/mail*` (or an `Accept: application/json` request) renders `{ "message": "<reason>", "reconnect": true }` with HTTP 409 (`bootstrap/app.php:93–101`). `requireAccountFor` throws it with the message `No mailbox is connected. Connect Google or Microsoft to use email.` (`Mailbox.php:45–47`). The UI stops polling entirely while `reconnectNeeded` is set (`email.js:3069–3081`) and shows a banner "This mailbox needs to be reconnected." + "Fix it" (`email.js:5332–5341`).
- Validation failures are Laravel's standard 422 `{message, errors}`; `bulk`/`send` limits produce these.
- Reconnect/connect URL: `{ROOT}/auth/social/{google|microsoft}/redirect?sync_all=1&return=email` (`email-api.js:238–241`; server accepts `return=email`, `SocialAuthController.php:74,111`). This is a browser OAuth flow; a native app must open it in a Custom Tab against the same session.

### 3. Endpoint table

| Method & path | Body / query | Response (keys) | Notes |
|---|---|---|---|
| `GET /portal/mail` | – | `{connected:false, folders:[], labels:[]}` when no mailbox; else `{connected:true, account:{provider,email,name,canWrite,status,error,syncedAt}, folders:{<folder>:{total,unread}}, preferences:{…}, labels:[Label]}` | Bootstrap. Also pokes `SyncMailbox`/`AnalyzeMailbox` at most once per 60s per account (`MailController.php:78–149`). `folders` covers the six real folders plus `important`, `starred`, `pinned`, `snoozed` (`folderCounts`, lines 2485–2557). Drafts badge = total, others = unread. |
| `GET /portal/mail/messages` | `folder` (inbox\|sent\|draft\|spam\|trash\|archive\|important\|starred\|pinned\|snoozed, default inbox), `q` (≤200), `label` (uuid), `page` (≥1), `perPage` (25\|50\|100\|200, default 100), `limit` (1–50, search only), `live` (bool, search only) | Folder: `{messages:[Row], total, hasMore, page, perPage, lastPage, perPageOptions:[25,50,100,200]}`. Search (`q` non-empty): `{messages:[Row]}` only — no paging keys. | `perPage` other than the four options is a 422 (`MailController.php:152–242`). Sort: pinned first, then `sent_at` desc. With `preferences.conversationView` true, one row per thread (newest in that folder). |
| `GET /portal/mail/messages/{uuid}` | – | `{message: Record}` | Hydrates body from provider on first open then caches (`show`, 819–846). |
| `GET /portal/mail/messages/{uuid}/thread` | – | `{threadId, subject, messages:[Record]}` oldest first, drafts excluded | Only the opened uuid is hydrated; others carry `bodyLoaded:false` until fetched via `GET /messages/{id}` (848–898). `subject` is the first message's subject. |
| `GET /portal/mail/messages/{uuid}/conversation` | – | `{threadId, messages:[Row]}` newest first | Never touches the provider; for the list's expand arrow (747–776). |
| `GET /portal/mail/window/{uuid}` | – | server-rendered HTML | Pop-out window; not JSON. |
| `PATCH /portal/mail/messages/{uuid}` | `{read?, starred?, important?, pinned?, snooze?}`; `snooze` = ISO date **after now** or `null` | `{message: Row}` | read/starred hit provider first; `important` only if provider supports it (Gmail); pinned/snooze are portal-only (1183–1230). |
| `POST /portal/mail/messages/{uuid}/move` | `{folder: inbox\|archive\|spam\|trash}` | `{message: Row, folders}`; trash-while-in-trash → permanent delete, `{folders}` only | 1232–1257 |
| `DELETE /portal/mail/messages/{uuid}` | – | `{folders}` | Permanent, bypasses Trash (1259–1272). |
| `POST /portal/mail/messages/{uuid}/labels` | `{label: uuid, applied: bool}` | `{message: Row}` | 1385–1413 |
| `POST /portal/mail/bulk` | `{ids:[uuid] (≤100), action: read\|unread\|star\|unstar\|pin\|unpin\|archive\|trash\|spam\|inbox\|delete}` | `{applied, failed, folders}` | Applied one by one; failures counted not thrown (1318–1383). |
| `POST /portal/mail/hydrate-attachments` | `{ids:[uuid] (≤40)}` | `{messages:[{id, attachmentsPreview:[Attachment], attachmentCount}]}` | Fills chips for rows with `hasAttachments && attachmentsPreview.length==0` (1274–1316; client `email.js:3020–3035`). |
| `GET /portal/mail/attachments/{uuid}` | `?inline=1` optional | bytes | See §6. |
| `GET /portal/mail/sender-photo/{sha256hex}` | – | image bytes, `Cache-Control: private, max-age=86400`; 404 = draw initials | Never blocks on provider (510–550). `avatarUrl` in rows already points here or to a portal photo. |
| `POST /portal/mail/labels` | `{name (≤100), tone: blue\|green\|purple\|orange\|red\|indigo\|gray}` | 201 `{label: Label}`; 422 `You already have a label with that name.` | Portal-only labels (`remote_id` prefixed `local:`), 1415–1450 |
| `PATCH /portal/mail/labels/{uuid}` | `{name?, tone?}` | `{label}` | 1452–1497 |
| `DELETE /portal/mail/labels/{uuid}` | – | `{deleted:true}` | 1499–1527 |
| `GET /portal/mail/suggest?q=` | `q` ≤200 | `{suggestions:[Suggestion]}` | ≤12 rows (`RecipientSuggester.php:33`). |
| `POST /portal/mail/send` | see §7 | `{sent:true, message: Row\|null}`; 502 `{message}` on provider failure; 409 on dead grant | 1544–1683 |
| `GET /portal/mail/drafts` | – | `{drafts:[Draft]}` | Defined but **not called by email.js** (only continue/save/delete are). |
| `POST /portal/mail/drafts` | see §7 | `{draft: Draft}` | Autosave; creates on first call (1750–1835). |
| `POST /portal/mail/messages/{uuid}/continue` | – | `{draft: Draft + attachments:[{name,mime,content(base64),size}]}`; 422 `Only drafts can be continued.` | Opens a Drafts-folder row in compose (1837–1891). |
| `DELETE /portal/mail/drafts/{uuid}` | – | `{deleted:true}` | 1929–1946 |
| `POST /portal/mail/sync` | `?fast=1` optional | fast: `{synced:int, fast:true, folders}` or `{synced:0, fast:true, error:'unavailable'}`; full: `{synced:0, queued:true, folders, syncedAt}` | Fast = one inbox request via `quickCheck` (`MailSynchronizer.php:101–141`); full is queued (2090–2120). Dead grant → 409 even on fast. |
| `GET /portal/mail/sync-status` | – | see §8 | 245–315 |
| `POST /portal/mail/sync/retry` | – | same as sync-status | 437–468 |
| `POST /portal/mail/sign-out` | – | `{signedOut:true, provider}`; 422 `No mailbox is connected.` | Sets `sync_email=false` only; imported mail kept (470–508). |
| `GET /portal/mail/settings` | – | `{accounts:[{provider,email,name,syncEnabled,canWrite,status,error,syncedAt}], preferences}` | 2122–2142 |
| `PUT /portal/mail/settings` | `{provider?, syncEnabled?, preferences?:{…}}` | same as GET | Preference keys/limits in §9 (2144–2216). |
| `POST /portal/mail/settings/import-signature` | – | `{choices:[{name,html}], reconnect, preferences}`; 422 with `choices:[]` and message `No signature was found in this mailbox yet. Send a few messages with your signature, sync mail, then try again.` | 2218–2252 |
| `POST /portal/mail/settings/import-signature/apply` | `{html (≤4,000,000), name? (≤80)}` | `{signature, preferences}`; 422 `That signature could not be used. Pick another, or paste it into the editor.` | 2254–2333 |
| `GET /portal/mail/templates` | – | `{templates:[{id,name,subject,bodyHtml,shared}]}` | Compose templates (firm + own), `ComposeTemplates::mailboxRecord` (`app/Support/Templates/ComposeTemplates.php:86–97`). |

### 4. JSON shapes (verbatim keys)

**Row** — `MailMessage::toRow()` (`app/Models/MailMessage.php:62–121`), plus `avatarUrl` and `threadCount` added by the controller (`withAvatars` 552–616, `withThreadCounts` 714–745):

```
id (uuid), threadId, folder, sender, email, subject, body (snippet), time, dateLabel,
sentAt (ISO-8601, authoritative), unread, starred, important, pinned, snoozedUntil (ISO|null),
hasAttachments, to:[{name,email}], labels:[label uuid], attachmentsPreview:[Attachment] (≤8),
attachmentCount (int|null), avatarUrl (string|null), threadCount (≥1)
```
`time`/`dateLabel` are formatted from a **UTC** Carbon (`M j, Y, g:i A`, `H:i` today, `M j` this year) — the model comment says to render `sentAt` in the reader's zone instead (lines 74–81). Drafts show first To as `sender` or the literal `Draft`; empty draft subject is `(no subject)` (156–210).

**Record** — `toRecord()` (124–147) = Row + `bodyHtml, bodyText, cc:[], bcc:[], replyTo, fromName, attachments:[Attachment], bodyLoaded (bool)`.

**Attachment** — `MailAttachment::toRecord()` (`app/Models/MailAttachment.php:32–45`): `{id, name, mime, size, inline}`. `inline` never hides an attachment; it only groups embedded pictures (comment 36–42).

**Label** — `MailLabel::toRecord()` (`app/Models/MailLabel.php:50–61`): `{id, name, tone, count (int|null), localOnly}`. The bootstrap only returns user-created `local:` labels; `email.js:3346–3348` further filters to `localOnly`.

**Draft** — `MailDraft::toRecord()` (`app/Models/MailDraft.php:33–47`): `{id, to, cc, bcc, subject, bodyHtml, mode, inReplyTo, threadId, updatedAt}`.

**Address** — everywhere `{name: string|null, email: string}` (`GraphProvider.php:1063–1073`, `GmailProvider.php:486–488`). The web composer serialises addresses as `Name <addr>` strings in fields and parses back with `parseAddresses` (`email.js:6721–6732`).

**Suggestion** (`RecipientSuggester.php:213–223, 258–268, 306–316, 331–339`): `{email (null for group), name, source: staff|client|group|prior, sourceLabel ('Organization'|'Client'|'Group · N people'|'Previous email'), avatarUrl, initial, initialColor, emails:[{email,name}]|null}`. Groups expand to all member emails client-side.

### 5. Lists, folders, paging, search

- Folder rail order in the web UI (`email.js:2166–2176`): inbox, important, starred, pinned?, snoozed, sent, draft, spam, trash, archive, templates. `important/starred/pinned/snoozed` are virtual (flag columns, `MailController.php:64–73, 623–651`): they exclude trash/spam/draft and snoozed rows; a snoozed message hides from its real folder until it wakes.
- Conversation grouping is a **server anti-join** (`onlyNewestInThread`, 661–712) gated by `preferences.conversationView`; the client never groups. Expand arrow uses `threadCount > 1` and `GET …/conversation`.
- Paging is classic page/perPage (Laravel `paginate`), not a cursor. Cache/warm start in the web client stores only page 1 of a plain folder (`writeMailCache`, `email.js:2681–2688`) in `sessionStorage` keyed to the boot user id.
- Search: `GET /messages?q=…&limit=N[&live=0]`. Server unions a mirror LIKE match on subject/from_name/from_email/snippet with the provider's full-text hits, skipping spam/trash, newest first, folded per thread in conversation view (2559–2648). `live=0` answers from the mirror only — the search drawer / site search send `limit=8&live=0` (`portal-search-index.js:442–444`); Enter/header search omit `live`. `limit` max 50; `perPage` is ignored for searches (sending `perPage=8` is a 422).

### 6. Bodies, lazy loading, inline images, attachments

- Bodies are absent from list rows; `GET /messages/{id}` or `/thread` fetches from the provider on first open and caches server-side (`hydrate`, 984–1059). A thread hydrates only the opened message; the client calls `getMessage` per card when `bodyLoaded === false` (`email.js:3611–3631`).
- `cid:` references in `body_html` are rewritten server-side to `{route mail.attachment}?inline=1` URLs (`embedInlineImages`, 1137–1181), i.e. absolute `/portal/mail/attachments/{uuid}?inline=1`. These require the authenticated session cookie — a native HTML renderer must attach cookies to image loads.
- The web client renders HTML bodies in `<iframe sandbox="allow-same-origin" srcdoc=…>` (`email.js:6485–6487`) and splits quoted history client-side using `QUOTE_SELECTORS` (`.gmail_quote`, `.gmail_extra`, `blockquote[type="cite"]`, `#divRplyFwdMsg`, `#appendonsend`, `.OutlookMessageHeader`, `div[name="quote"]`, `.yahoo_quoted`, `.protonmail_quote`, `.moz-cite-prefix`) plus a trailing `<hr>` in the back half (`splitQuotedHtml`, 6277–6328). Toggle copy: `Show quoted text` / `Hide quoted text` (6479). On phones quoted text is clamped to 14px/1.5 (6263–6269). Plain-text fallback preserves newlines (5461–5470).
- Attachment download: `GET /portal/mail/attachments/{uuid}` streams from the provider; 502 `This attachment could not be downloaded from the mail provider.` on failure. `?inline=1` returns `Content-Disposition: inline` only for image/*, audio/*, video/*, application/pdf, text/plain, text/csv (SVG sanitised); everything else is `streamDownload` with the original filename (1948–2013).
- Outbound: `bodyHtml` containing `data:image/*` URIs is converted to `cid:` inline parts by `InlineImages::extract` (`app/Support/Mail/InlineImages.php:26–72`); `/portal/mail/attachments/…` URLs quoted from a reply are re-fetched and re-embedded by `OutboundImages::embed` (≤3 MB each). Signatures held as data: URIs therefore send correctly.

### 7. Compose, drafts, reply/forward, send

**Send** (`MailController.php:1544–1683`, payload built in `email.js:8729–8742`):
```
{ to:[{email, name?}] (required, ≥1), cc:[…], bcc:[…], subject (≤998), bodyHtml,
  draftId (uuid|null), mode: new|reply|reply-all|forward, inReplyTo (message uuid|null),
  attachments:[{name (≤255), mime?, content (base64)}] (≤10 files, ≤100 MB each, OutboundFiles.php:15–17) }
```
Reply threading is by `inReplyTo` message uuid; the server resolves the provider id and `threadId` itself (1600–1612). `inReplyTo` without `mode` is treated as `reply`. The response `message` is the just-sent Row so the conversation can show it immediately; `SyncMailbox` is dispatched. Files travel base64 inside the JSON body — there is no multipart upload path (**not found**).

**Undo send** is purely client-side: `preferences.undoSendSeconds` (0–30, default 5) delays the POST with a countdown toast `Sending in N…`; the server has no undo (`email.js:8590–8710`). Success toast: `Message sent`; missing recipient: `Add at least one recipient`.

**Drafts** (`POST /drafts`, 1750–1835): `{id?, to, cc, bcc, subject, bodyHtml, mode, inReplyTo, threadId, attachments}`. Autosave debounces 800 ms and the first save waits until the draft has substance (`email.js:8496–8510`); the server also refuses to mint a provider draft for a signature-only body (`DraftContent::isBlank`). Send consumes `draftId` and deletes the provider draft. The Drafts folder lists mirrored provider rows; opening one calls `POST /messages/{uuid}/continue`, which returns a Draft plus its non-inline files as base64.

**Recipient pills**: To/Cc/Bcc are pill fields; typeahead calls `GET /suggest?q=` and `Name <email>` strings are parsed to `{name,email}` before send (`email.js:6721–6732, 6734+`).

**Templates**: `GET /portal/mail/templates` feeds the compose "Templates" picker; picked body = `<div class="tma-dash__email-compose-template-body">{bodyHtml}</div>` + signature (`email.js:2548–2567`). `public/js/email-templates.js` is the *system email postcard gallery* (`window.TMAEmailTemplates.list/get/renderBody`) and is not a mailbox API.

**Signatures**: `preferences.signatures[] {id,name,html}` + `activeSignatureId`; `signature` mirrors the active HTML (`normalizeSignatureLibrary`, 2408–2472; max 10, each ≤4,000,000 chars). Import flow: `POST …/import-signature` → chooser → `POST …/apply`.

### 8. Sync status and live updates

- `GET /sync-status` returns `{connected, running, done, failed, status, error, errorCode, synced, total|null, folders:[{folder,synced,total|null,done}], syncedAt, progress|null}`; `progress` = `{stage, stageLabel, stageNumber, stageCount(10), status, estimated, totalMessages, processedMessages, totalConversations, totalAttachments, attachmentsFound, totalImages, totalDocuments, failedMessages, currentFolder, percentage|null, startedAt, lastProgressAt, completedAt, elapsedSeconds, etaSeconds|null, stalled, stallReason (auth|queue|job-failed|job-missing|unknown), retried}` (245–369). Stage labels: Connecting account, Verifying permissions, Reading mailbox folders, Counting messages, Counting attachments, Preparing import, Importing messages, Building conversations, Finalizing synchronization, Mailbox up to date (`MailSyncProgress.php:28–39`). Stall = no progress for 45 s. Web polls every 3 s while running, 10 s when failed, 15 s after a poll error, hides 6 s after done (`email.js:4696–4722`).
- **There is no Reverb/`Live` signal for mail** — `app/Support/Realtime/Live.php` has no mail resource. The web page polls: every 2 s it re-reads the current list (`GET /messages`); it POSTs `/sync?fast=1` on every tick for Gmail and every 3rd tick for Microsoft (Graph webhooks push server-side); every 30th tick it POSTs `/sync` (full, queued). Polling pauses when hidden, disconnected, on the Templates view, or after a 409 (`email.js:3053–3238`). Fresh `folders` counts arrive on every sync response and drive the badges.
- New-mail notifications are created by the synchronizer (`email.received`, batched as `N new emails` when >3, `action_url: '/email?message={uuid}'`, metadata `{from_email, from_name, message_uuid}`; `MailSynchronizer.php:535–595`); they flow through the portal notification store (other brief). Other types: `email.reply`, `email.attachment`, `email.send_failed`, `email.sync_failed`, `email.shared_activity`, `email.connection_expired`, `email.snooze_due` (`NotificationType.php:26–33`). Deep link `?message=` opens that message, switching to `snoozed` if it is resting (`email.js:3371–3410`).
- Snooze wake-ups are a scheduled command `mail:wake-snoozed` (`routes/console.php:334,369`).

### 9. Preferences (`mailPreferences`, `MailController.php:2355–2406`)

Defaults: `signature ''`, `signatures []`, `activeSignatureId null`, `readReceipts false`, `conversationView true`, `previewPane true`, `undoSendSeconds 5`, `sidebarMode 'hidden'` (full|icons|hidden), `layout 'split'` (split|single), `inboxCategories ['important','starred','pinned']`, `showInboxCategories true`. Stored under `users.preferences.mail`; `PUT /settings` merges onto stored values so a single-key save does not reset the rest.

### 10. No-mailbox and reconnect states (copy verbatim)

- Bootstrap `connected:false` → list empty state title `No emails yet`, body `Connect your email account to get started.`, button `Connect email account` (`email.js:5440–5446`).
- Settings › Mailbox with no accounts: `No mailbox connected` / `Connect your work email to read and send it here.` with `Connect Google` and `Connect Microsoft` buttons (`email.js:9174–9190`).
- Connected read-only (`syncEnabled && !canWrite`): `Connected for reading only. Reconnect to send and organise mail.`; `Last synced …` / `Not synced yet` / `Mail sync is off`; buttons `Sync now`, `Reconnect` (9195–9224).
- Sign-out toast when nothing is connected: `No mailbox is connected.` (4736).
- Thread load failure: `This conversation could not be loaded.`; per-message: `This message could not be loaded.`; bootstrap failure: `Could not reach the mailbox` (3390, 3509, 3626).

### 11. Mobile layout (web reference)

`isEmailMobile()` = `(max-width: 1024px)` (`email.js:612–640`). Mobile: panel gets `--mobile`, reading pane replaces the list (`--mobile-reading`, 5065–5072); category strip hidden and refresh/bulk/label menus move into the list head (5240–5248); message head uses `DETAIL_MESSAGE_ACTIONS_MOBILE` (4340–4345); nav and search live in a slide-in sidebar (`mobileNavOpen`, `mobileSearchOpen`, 299–465).

### 12. Gotchas for a native client

1. Every write goes to the provider first; expect 400–2000 ms latency and design optimistic UI with rollback (the web flips read/star immediately, `email.js:3566, 3646–3657`).
2. 409 must be treated as terminal until OAuth reconnect; do not retry-loop.
3. `sentAt` is the only trustworthy time; ignore `time`/`dateLabel` (UTC-formatted).
4. Attachment and inline-image URLs are session-authenticated and relative; inline `cid:` images inside `bodyHtml` are already rewritten to `/portal/mail/attachments/{uuid}?inline=1`.
5. `snooze` must be a date strictly after server `now` (validation `after:now`); send ISO-8601 with offset.
6. Search results have no paging and cap at 50; `perPage` must be one of 25/50/100/200 or the request 422s.
7. Bulk = ≤100 ids; hydrate-attachments = ≤40 ids; send attachments = ≤10 files, base64 in JSON.
8. Labels shown in the app are only portal-created ones (`localOnly`); provider labels/categories are not exposed.
9. Pinned/snooze are portal-only and never reach Gmail/Outlook; `important` is a no-op on Microsoft.
10. There is no realtime mail channel — replicate the 2 s/6 s/60 s polling cadence, and pause it in background.

---

### A6. Calendar, Groups and Feed

All paths are relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Routes: `routes/web.php` lines 983–1176. Every endpoint below sits inside the authenticated group at `routes/web.php:162` (`auth, verified, profile.complete, account.approved, onboarded, mfa.enforced`) — session-cookie auth, not tokens. Nothing in this area is versioned or namespaced under `/api`; the URLs are `/portal/calendar/...`, `/portal/groups/...`, `/portal/feed/...`.

### 0. Transport rules shared by all three areas

| Fact | Source |
|---|---|
| Web client sends `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, and on non-GET `X-XSRF-TOKEN` = URL-decoded value of the `XSRF-TOKEN` cookie; `Content-Type: application/json` when a JSON body is sent; `credentials: same-origin`. | `public/js/feed-api.js:15-56`, `public/js/portal-upload-manager.js` (`fetchJSON`, the helper `calendar.js` calls via `window.TMAFilesNet.fetchJSON`, `calendar.js:87-92`) |
| On non-GET the client also sends `X-Socket-ID` (the Reverb socket id) so `broadcast(...)->toOthers()` can skip the sender. Without it the caller receives its own `feed.post.changed` / `data.changed` echo. | `feed-api.js:22-31,41-43`; `portal-upload-manager.js` fetchJSON |
| Error body: Laravel validation → `422 {message, errors:{field:[msg]}}`; `abort(403/404/422,'text')` → `{message}`. Client picks first `errors[*][0]`, else `message`, else a generic string. Feed treats 404 as "gone" (channel no longer visible) rather than an error. | `feed-api.js:57-84` |
| Calendar routes 403 when the caller lacks access; Feed routes **404** for any channel/post/comment/attachment the caller cannot see (existence is information). | `routes/web.php:974-976, 1076-1081`; `app/Support/Feed/FeedAccess.php:237-240` |
| Feed prefix is gated by `capability:feed.view` (middleware `EnsureCapability`, `bootstrap/app.php:40`); the capability belongs to Employee-like staff, never clients (`Role::MATRIX 'feed.view' => [EMPLOYEE]`). Groups: `groups.view` (Employee). Calendar has no route-level capability; `CalendarAccess::isStaff` / `isAdmin` are checked per action. | `app/Http/Middleware/EnsureCapability.php`; `app/Support/Access/Role.php:230-240, 286-294` |
| All timestamps on the wire are ISO-8601 with offset (`Carbon::toIso8601String()`, e.g. `2026-09-05T13:00:00+00:00`). Calendar instants are stored in UTC, so they come back with `+00:00`; the authoring zone is a separate `timezone` field. | `app/Models/CalendarEvent.php:105-108`; `CalendarEventController.php:707-752` |
| Multipart uploads (ICS files, feed attachments, channel images) go as `FormData` with field `file`; the web client uses XHR for feed attachments to get upload progress. | `feed-api.js:187-224`; `calendar.js:2901,2942` |

### 1. Calendar

#### 1.1 Access model (server-side, `app/Support/Calendar/CalendarAccess.php`)

Role ladder, weakest first: `availability` < `titles` < `details` < `contributor` < `editor` < `manager` < `owner` (`CalendarAccess.php:28-56`). Capabilities per role (`:58-70`): availability→`view_availability`; titles adds `view_titles`; details adds `view_details`; contributor adds `add_events`; editor adds `edit_events, delete_events`; manager adds `manage_sharing, edit_calendar`; owner adds `delete_calendar, archive_calendar`. A user's role = strongest of: owner (`owner_id`), admin (for any non-`personal` calendar; admins do NOT see colleagues' personal calendars, `:93-104`), explicit `calendar_members` grant (user or group, `:107-140`), or the calendar's `visibility='all_staff'` default (`default_role`, staff only, `:150-160`). Archived calendars are read-only except `archive_calendar` for the owner (`:225-233`). Contributors may edit/delete only events they created (`CalendarEventController.php:596-604`).

**Members vs subscriptions**: `calendar_members` = permission; `calendar_subscriptions` = the user's own sidebar list (visible flag + personal colour override, `app/Models/CalendarSubscription.php`). Subscribing never grants access (`CalendarController.php:181-194`). `GET /events` returns only calendars whose subscription has `is_visible=true` (`CalendarEventController.php:59-63`), so hide/show is server-driven.

#### 1.2 Endpoints (`/portal/calendar`)

| Method & path | Who | Request | Response |
|---|---|---|---|
| GET `/calendars` | any (provisions personal calendar on first call) | — | `{calendars:[CalendarRecord], sections:[{key,label}], defaultCalendar:uuid, timezone, canCreate:bool, colours:[keys], preferences:{view, sidebarOpen}}`. `view` ∈ `week|month|agenda|day|work_week`, default `month`. `CalendarController.php:50-104` |
| POST `/calendars` | staff; `organization` type admin-only | `name*` (≤255), `description` (≤2000), `colour` (palette key), `calendar_type` (`personal|shared|group|department|project|client|organization`), `visibility` (`private|shared|all_staff`), `timezone` (IANA), `default_role` (ladder value), `is_archived` | `{calendar}` `:106-133, :547-563` |
| PATCH `/calendars/{uuid}` | `edit_calendar` | same, partial; system calendar ignores type/visibility | `{calendar}` `:135-160` |
| DELETE `/calendars/{uuid}` | `delete_calendar`; 422 for personal | — | `{status:'ok'}` (soft delete) `:162-176` |
| POST `/calendars/{uuid}/subscribe` | must already have a role | — | `{calendar}` `:182-194` |
| DELETE `/calendars/{uuid}/subscribe` | any; 422 for personal | — | `{status:'ok'}` `:200-212` |
| PUT `/calendars/{uuid}/subscription` | any with a role | `visible:bool`, `colour:key|null` — owner/manager sets the official colour, others store a personal override | `{calendar}` `:218-261` |
| GET `/discover?q=` | staff | — | `{calendars:[CalendarRecord unsubscribed], people:[{id,name,email,avatarUrl,jobTitle}], groups:[{id:uuid,name,type}]}` (limits 50/20/20) `:267-330` |
| GET `/calendars/{uuid}/members` | `manage_sharing` | — | `{members:[{type:'user',userId,name,email,avatarUrl,role}|{type:'group',groupId,name,groupType,role}], owner:{userId,name}, roles:[...], roleLabels:{role:label}}` `:333-367` |
| POST `/calendars/{uuid}/members` | `manage_sharing`; `owner` role only by owner/admin; clients rejected 422 | exactly one of `userId:int` / `groupId:uuid`, plus `role*` | `{status:'ok'}` `:373-440` |
| DELETE `/calendars/{uuid}/members/{userId}` (numeric) / `/group-members/{groupUuid}` | `manage_sharing` | — | `{status:'ok'}` `:442-499` |
| GET `/calendars/{uuid}/history` | `manage_sharing` | — | `{history:[{id,action,label,actor,calendar,event,context,at}]}` last 100; actions listed in `app/Support/Calendar/CalendarAudit.php:19-57` |
| GET `/events?from&to[&calendars[]=uuid]` | any | `from*`,`to*` dates (≤400 days apart, else 422) | `{events:[EventRecord]}` sorted by `startsAt`; overlap semantics (`starts_at < to && ends_at > from`); recurring masters expanded server-side into virtual occurrences. `CalendarEventController.php:42-166` |
| POST `/events` | `add_events` on target calendar (defaults to personal) | see §1.4 | `{event}` `:168-203` |
| GET `/events/{uuid}` | any role | — | `{event}` with `attendees` and `myInvitation` `:376-385` |
| PATCH `/events/{uuid}` | canWrite | partial body + optional `scope` (`this|following|all`, default all) | `{event}` `:205-311` |
| DELETE `/events/{uuid}` | canWrite | optional JSON body `{scope}` | `{status:'ok'}` `:313-355` |
| POST `/events/{uuid}/complete` | canWrite | — (toggles) | `{event}` `:358-369` |
| POST `/events/{uuid}/attendees` | canWrite | `userIds[]` (≤256), `groupIds[]` uuids (≤64), `emails[]` (≤256), `optional:bool`, `notify:bool` (default true) | `{event}` with attendees `:392-471` |
| DELETE `/events/{uuid}/attendees/{attendeeId}` | canWrite | — | `{event}` `:473-483` |
| POST `/events/{uuid}/respond` | invitee (direct or via group) | `response*` ∈ `accepted|tentative|declined` | `{event}`; 403 "You were not invited to this event." `:493-539` |
| GET `/availability?from&to&userIds[]&groupIds[]&slotMinutes` | any | ≤31 days; `slotMinutes` 5–1440 | `{availability:[{userId,name,avatarUrl,status:'free'|'busy'|'unknown',blocks:[{startsAt,endsAt,status:'busy'|'tentative',allDay}]}], suggestion:{startsAt,endsAt}|null}` `:547-589`; `app/Support/Calendar/Availability.php` |

ICS (`app/Http/Controllers/CalendarIcsController.php`): GET `/ics/{uuid}/export[?from&to|events[]]` and GET `/ics/events/{uuid}/export` return `text/calendar` with `Content-Disposition: attachment` (needs `details` role; private events only to organizer/creator). POST `/ics/preview` (`file*`, ≤12 MB per `IcsReader::MAX_BYTES`) → `{events:[..., key, recurrenceLabel], failed, calendarName, summary:{total,recurring,allDay,unreadable}}`; POST `/ics/import` (`calendarId*`, `file*`, `onDuplicate` ∈ `skip|update`, `keys[]`, `withAttendees`) → `{result:{imported,updated,skipped,failed,errors[]}}`; POST `/ics/subscribe` (`url*`,`name*`,`colour`,`frequency` ∈ 60|360|720|1440 minutes) → `{calendar}`; POST `/ics/{uuid}/refresh`; PUT `/ics/{uuid}/enabled` `{enabled}`. Staff only for import/subscribe. Refresh happens in a queued job on a 15-minute schedule (`routes/console.php:381-411`).

Provider sync (`CalendarSyncController.php`): GET `/sync/accounts` → `{accounts:[{id,provider:'google'|'microsoft',email,canRead,canWrite}], googleEnabled, microsoftEnabled}`; GET `/sync/accounts/{id}/calendars` → `{calendars:[provider list], canWrite}`; POST `/sync/accounts/{id}/connect` (`externalId*`,`name*`,`colour`,`direction` ∈ `two_way|import|export`,`monthsBack` 1–60); POST `.../connect-all` (`direction`,`monthsBack`) → `{calendarsFound, calendarsAdded, calendarsSkipped, calendarsFailed, calendars, account}`; GET `/sync/status` or `/sync/accounts/{id}/status` → `{stage:'idle'|'importing'|'partial'|'failed'|'complete', calendarsFound, calendarsAdded, calendarsSyncing, calendarsOk, calendarsPartial, calendarsError, eventsImported, lastSyncedAt, calendars:[{id,name,status,error,eventCount,syncedAt,attemptedAt}]}`; PUT `/sync/{uuid}` (`direction`, `syncCancelled`); POST `/sync/{uuid}/run`; DELETE `/sync/{uuid}[?purge=1]` (without purge the calendar becomes local and keeps its events, `:355-380`); GET `/sync/{uuid}/conflicts` → `{conflicts:[{id, current:{title,startsAt,endsAt,location}, yours:snapshot, at}]}`; POST `/events/{uuid}/resolve-conflict` `{keep:'yours'|'theirs'}`. Sync runs are queued; a `syncing` status older than 30 min is treated as stale (`app/Models/Calendar.php:66-98`).

#### 1.3 CalendarRecord (`app/Models/Calendar.php:250-313`)

`id` (uuid), `name`, `description`, `colour` (viewer's effective), `officialColour`, `type`, `source` (`local|google|microsoft|ics_import|ics_subscription`), `section` (`mine|people|group|shared|connected|imported`, computed per viewer `:213-243`), `visibility`, `timezone`, `role`, `isOwner`, `isSystem`, `isArchived`, `canDelete`, `ownerName`, `clientId`, `subscribed`, `visible`, `sync` (null or `{status,error,syncedAt,frequency,url,provider,direction,canWrite,readOnly,accountEmail}`). Colour keys: `blue, purple ("Deep blue", maps to --color-primary-dark), green, teal, pink, red` (`app/Support/Calendar/CalendarColours.php`; JS twin `public/js/calendar-colours.js`). There is no purple in the design system — `purple` renders as deep brand blue.

#### 1.4 Event payloads and time semantics

Create/update body (`CalendarEventController.php:757-785`): `calendarId` (uuid, optional → personal), `title*` (≤255), `description` (≤20000), `location` (≤255), `startsAt*`, `endsAt*` (any Carbon-parsable date), `allDay:bool`, `timezone` (IANA; defaults to the calendar's zone), `status` ∈ `confirmed|tentative|cancelled`, `visibility` ∈ `default|public|private`, `colour` (palette key or null = inherit), `meetingUrl` (url ≤2048), `recurrence:{freq:'NONE'|'DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY', interval:1..366, byDay:['MO'..'SU'], count:1..1000|null, until:date|null}` (COUNT and UNTIL mutually exclusive, `app/Support/Calendar/RecurrenceRule.php:39-113`), `scope`.

`resolveTimes` (`:727-752`): `startsAt`/`endsAt` are parsed **in the event timezone** (an explicit offset in the string wins), all-day events are snapped to midnight→next midnight in that zone with an exclusive end, non-all-day requires end > start (422 "The end time must be after the start time."), then stored in UTC. The web client sends `new Date(y,m,d,h,m).toISOString()` (device-local wall time → UTC `Z` string) and never sends `timezone` (`calendar.js:2296-2306`, `toIso`). A native client should do the same (send an instant with offset) or send wall time plus `timezone`.

EventRecord (`app/Models/CalendarEvent.php:100-142`): `id`, `calendarId`, `startsAt`, `endsAt`, `allDay`, `timezone`, `status`, `colour`; if the viewer may read details: `title, description, location, visibility, meetingUrl, organizerId, organizerName, clientId, completed, recurring, recurrenceRule (RRULE string), seriesId, attendees (null unless eager-loaded — only on show/invite/respond), external, private:false, canEdit`. Otherwise only `title:'Busy', private:true, canEdit:false` (availability-only role, or another person's `private` event). Virtual occurrences add `isOccurrence:true, recurring:true, seriesId:<master uuid>, completed:false` and have composite ids `<masterUuid>@<YYYY-MM-DDTHH:MM:SSZ>` (`app/Support/Calendar/RecurrenceExpander.php:184-187`). PATCH/DELETE accept that composite id — URL-encode the `@` — and `scope` decides: `this` materialises one detached row, `following` splits the series, `all` edits the master (`CalendarEventController.php:205-240`; `SeriesEditor.php`). Exporting an occurrence exports the master (`calendar.js:2884-2888`).

Attendee (`app/Models/CalendarEventAttendee.php:81-96`): `{id:int, type:'user'|'group'|'email', userId, groupId(uuid), email, name, avatarUrl, response:'needs_action'|'accepted'|'tentative'|'declined', optional, respondedAt}`. `myInvitation` on show: `{attendeeId, response, viaGroup}` or null (`CalendarEventController.php:657-677`).

#### 1.5 Web client behaviour worth mirroring (`public/js/calendar.js`)

Views `month, week, work_week, day, agenda` (`:38-45`); the chosen view and sidebar state are persisted via `TMAPrefs` keys `calendarView` / `calendarSidebarOpen` and served back in `GET /calendars.preferences` (`:301-309, :3274, :3305`). Event fetch window = anchor month −1 to +2 months (`:277-286`). Saves splice the returned event into state and then background-refresh (`:2317-2360`); deletes are optimistic with rollback (`:2378-2400`). Guests are invited **after** create (`:2340-2348`). Availability for the draft's guests is polled via `/availability` with `slotMinutes` = draft length (`:2850-2870`). The Today badge counts events from a same-day `/events` call and emits `tma-calendar-count` (`:4243-4290`). The week grid uses `schedule.js` (`TMASchedule`, 8:00–19:00 grid, Monday start; `public/js/schedule.js:16-20`) — it is a pure render helper with no network.

#### 1.6 Realtime for calendar

There is no calendar-specific broadcast event. `Calendar` and `CalendarEvent` model writes fire `CalendarLiveObserver` → `Live::staff('calendar')` → `PortalDataChanged` (`broadcastAs 'data.changed'`, payload `{resource:'calendar'}`) on private channel `portal.staff` (staff-only auth, `routes/channels.php:29-31`), sent `toOthers()` (`app/Observers/LiveResourceObserver.php`; `app/Support/Realtime/Live.php:79-83,161`; `app/Events/PortalDataChanged.php`). The page registers `TMALive.register('calendar', () => load(true))` (`calendar.js:4302-4307`). Consequence: **clients (non-staff) get no live calendar signal** — the observer has no owner column, so nothing is sent to `App.Models.User.{id}` for calendar.

### 2. Groups (`/portal/groups`, `app/Http/Controllers/GroupsController.php`)

Staff-only (`groups.view`); create/delete admin-only; a group `manager` curates members. Types: `team|department|project|committee|organization` (`app/Models/Group.php:23-33`). `auto_join` groups take every approved staff account as members (`app/Support/Calendar/GroupMembership.php:81-90`).

| Method & path | Request | Response |
|---|---|---|
| GET `/?q=&includeArchived=` | — | `{groups:[{id:uuid,name,description,type,autoJoin,isArchived,memberCount,createdAt,myRole:'manager'|'member'|null}], types:[...], canManage:bool}` |
| GET `/staff?q=` | — | `{staff:[{id,name,email,avatarUrl,jobTitle}]}` (≤200) |
| POST `/` (admin) | `name*` ≤120, `description` ≤1000, `group_type`, `auto_join`, `memberIds[]` ≤512 | `{group}` (creator becomes manager unless auto_join) |
| PATCH `/{uuid}` (manager/admin) | `name, description, group_type, auto_join (admin), is_archived` | `{group}` |
| DELETE `/{uuid}` (admin) | — | `{status:'ok'}` |
| GET `/{uuid}/members` | — | `{members:[{userId,name,email,avatarUrl,jobTitle,role}], autoJoin, canManage}` |
| POST `/{uuid}/members` | `memberIds*[]`, `role` ∈ `member|manager` | `{status:'ok', memberCount}`; 422 on auto_join groups; new members are emailed |
| DELETE `/{uuid}/members/{userId}` | — | `{status:'ok'}`; 422 if removing the last manager |

### 3. Feed (`/portal/feed`)

#### 3.1 Access (`app/Support/Feed/FeedAccess.php`)

Channel visibility `org` (any staff can see and, if `join_policy='anyone'`, join), `private` (members only), `client` (members only, client's people belong) (`app/Models/FeedChannel.php:50-60`; `FeedAccess.php:81-108`). Member roles `member < moderator < admin < owner`; `feed.moderate` capability holders rank as admin everywhere (`:17-67`). `post_policy` / `comment_policy` are the minimum role required (`:120-147`). `canEngage` (react, vote, bookmark, share, acknowledge) = can view and channel not archived. Authors edit their own posts/comments; moderators delete anyone's, pin, lock, view acknowledgements (`:155-205`). Drafts/scheduled posts are visible only to their author (or a moderator) and otherwise 404 (`FeedPostController.php:1046-1073`). Every payload carries a `can` object — render from it, never re-derive (`feed.js:13-17`).

#### 3.2 Channel endpoints (`app/Http/Controllers/Feed/FeedChannelController.php`)

| Method & path | Request | Response |
|---|---|---|
| GET `/channels?includeArchived=` | — | `{channels:[Channel], can:{createChannel, analytics, moderateAll}}`; ordered by `last_activity_at` desc; `unread` = published posts by others after `membership.lastReadAt` (`:46-116`) |
| POST `/channels` (`feed.createChannel`) | `name*` ≤120, `description`, `type*` ∈ `company|department|team|project|client|private|public`, `visibility*`, `colour` (default `blue`; UI offers `blue green orange red pink yellow`, `feed.js:56`), `icon` (default `Hash`), `tags[]` ≤12, `clientId`, `groupId`, `postPolicy`, `commentPolicy` (roles), `joinPolicy` ∈ `anyone|invite`, `memberIds[]` ≤500 | `{channel}` |
| GET / PATCH / DELETE `/channels/{uuid}` | PATCH: same fields partial (admin+) | `{channel}` / `{deleted:true}` |
| POST `/channels/{uuid}/image/{avatar|cover}` | multipart `file` image ≤10 MB | `{channel}`; GET same path streams it (`?v=` cache-buster in `avatar`/`cover` URLs) |
| GET `/channels/{uuid}/members` | — | `{members:[{user:Person, role, muted, emailFrequency, joinedAt}], can:{manage}}` |
| POST `/channels/{uuid}/members` | `userIds*[]`, `role` (not `owner`) | `{added:int, channel}` |
| PATCH / DELETE `/channels/{uuid}/members/{userId}` | `{role}` | `{member}` / `{removed:true}` |
| POST `/join`, `/leave`, `/archive`, `/restore` | — | `{channel}` |
| POST `/channels/{uuid}/read` | — | `{ok:true}` (sets `last_read_at`) |
| PATCH `/channels/{uuid}/membership` | `muted:bool`, `emailFrequency` ∈ `all|mentions|none` | `{member}` |
| POST `/channels/{uuid}/attachments` | multipart `file`; ≤ min(100 MB, php upload limit); blocked types rejected 422 | `{attachment}` staged (`status='staged'`), claimed on post/comment save; ≤20 per post, ≤5 per comment (`app/Support/Feed/FeedAttachmentIntake.php:32-38,98-150`) |

Channel shape (`app/Support/Feed/FeedPresenter.php:36-97`): `id, name, slug, description, type, visibility, colour, icon, avatar, cover, tags[], owner:Person, clientId, groupId, postsCount, memberCount, lastActivityAt, isArchived, isSystem, isDefault, createdAt, membership:{role,muted,emailFrequency,lastReadAt,joinedAt}|null, isMember, unread, policies:{post,comment,join}, can:{post,join,leave,moderate,manage,delete,analytics}`. Person = `{id, name, photo, role (job title), accountType}` (`:335-348`).

#### 3.3 Posts (`app/Http/Controllers/Feed/FeedPostController.php`)

GET `/posts` params (`:61-75`): `channel` (uuid; omit for everything visible), `before` (int seq cursor), `type`, `author` (id), `hashtag`, `hasAttachments`, `hasPoll`, `from`, `to`, `q`, `view` ∈ `all|bookmarks|mentions|pinned|drafts|scheduled|archived`. Response `{posts:[Post], pinned:[Post], hasMore:bool, cursor:int|null}`; page size 20, ordered by `id` desc; `pinned` (≤10) only on page one of a single channel in `all` view (`:76-125`). Paging: pass the returned `cursor` as `before`. The sidebar's "My channels" (`mine`) view is client-side (channels with `isMember`, `feed.js:595`).

POST `/posts` (201) / PATCH `/posts/{uuid}` body (`:800-830`): `channelId*` (create only; **prohibited** on update), `type` ∈ `discussion|question|praise|poll|announcement`, `title` ≤255, `body` (sanitised HTML, ≤100000), `status` ∈ `draft|scheduled|published|archived` (default draft), `scheduledFor` (must be future when scheduled), `timezone`, `requiresAcknowledgement`, `expiresAt`, `notifyPortal`, `emailAudience` ∈ `none|everyone|members|mentioned|groups` (beyond `members` needs moderator), `emailGroups[]` ≤50, `attachments[]` (staged uuids), `poll:{question*, options*[2..12], multipleChoice, anonymous, closesAt, hideResults}`. A published post must have body, poll or files (422 `body: "A post needs something in it."`). Mentions are **only** recognised from `data-mention="user:<id>"` / `data-mention="group:<uuid>"` markers in the HTML body; bare `@name` is ignored (`app/Support/Feed/FeedContent.php:322-379`). Hashtags come from `data-hashtag` markers or bare `#word` (`:382-400`). Tokens come from GET `/mentionable?q&channel` → `{results:[{token,kind:'user'|'group',name,photo,meta,isMember}]}` and GET `/hashtags?q` → `{results:[{tag,count}]}` (`FeedSearchController.php:200-277`). The web composer payload is at `feed.js:3598-3632`.

Other post routes: GET `/posts/{uuid}` (records a view) → `{post}`; DELETE → `{deleted:true}`; PUT `/autosave` `{body,title}` (drafts/scheduled only) → `{savedAt}`; POST `/publish` → `{post}`; POST `/duplicate` (201, always a draft, poll copied without votes) → `{post}`; POST `/pin`, `/lock` (moderator) → `{post}`; POST `/bookmark` → `{bookmarked}`; POST `/share` → `{shares}`; POST `/acknowledge` → `{acknowledged:true,count}` (422 if not required); GET `/acknowledgements` (moderator) → `{acknowledged:[{user,at}], outstanding:[Person], total}`.

Post shape (`FeedPresenter.php:113-196`): `id, seq, type, status, title, body (HTML), excerpt, channel:{id,name,slug,colour,icon}, author:Person, publishedAt, createdAt, scheduledFor, timezone, edited, editedAt, visibility, isPinned, isAnnouncement, requiresAcknowledgement, expiresAt, isExpired, commentsLocked, counts:{views,comments,reactions,shares}, reactions:{total, mine:emoji|null, groups:[{emoji,count,mine,people:[Person ≤12]}]}, attachments:[Attachment], poll:Poll|null, hashtags:[string], mentions:[{user,group}], bookmarked, acknowledged, email:{audience,sentAt}|null (moderators), can:{comment,react,edit,delete,pin,lock,viewAcknowledgements}`. Attachment: `{id,name,mime,extension,size,width,height,durationMs,kind:'image'|'video'|'audio'|'file',url,thumbUrl}`; `url` = GET `/attachments/{uuid}` (inline for image/video/audio, `attachment` disposition otherwise, `FeedAttachmentController.php:67-88`), `thumbUrl` = `/attachments/{uuid}/thumb` — both authenticated. Poll: `{id,question,multipleChoice,anonymous,closesAt,closedAt,isClosed,resultsVisible,totalVotes|null,hasVoted,options:[{id,label,votes|null,chosen}]}` — counts are `null` (not 0) while hidden.

#### 3.4 Comments, reactions, polls

GET `/posts/{uuid}/comments` → `{comments:[Comment with replies[]], can:{comment}}` — whole tree in one call, one level deep, oldest first (`FeedCommentController.php:29-51`). POST body `{body ≤20000, parentId, attachments[] ≤5}` → `{comment, commentsCount}`; PATCH `/comments/{uuid}` `{body*}`; DELETE → `{deleted, commentsCount}`. Comment shape: `id, seq, body, author, createdAt, edited, parentId, repliesCount, reactions, attachments, replies[], can:{edit,delete,reply,react}`.

Reactions toggle: POST `/posts/{uuid}/reactions` `{emoji ≤32 chars}` → `{reactions}` (same emoji again removes); POST `/comments/{uuid}/reactions` → `{comment}`; GET `/posts/{uuid}/reactions` → `{groups:[{emoji,count,people}], total}`. Quick picks in UI: 👍 ❤️ 🎉 👏 😄 🤔 👀 (`feed.js:47`).

Polls: POST `/posts/{uuid}/poll/vote` `{optionIds:[uuid]}` (`present`, may be empty to clear; single-choice enforces one) → `{poll}`; POST `/poll/close` → `{poll}`; GET `/poll/voters` → `{options:[{id,label,people}]}`, 403 for anonymous polls.

Search: GET `/search?q(≥2)&channel&author&type&from&to&hasAttachments&hasPoll` → `{posts, comments, channels, people, hashtags, attachments}` (12 each). Analytics: GET `/analytics?channel&days(1..365)` → `{range, totals, topContributors, mostViewed, mostReacted, activity:[{date,posts}], channels}` (`FeedAnalyticsController.php`).

#### 3.5 Realtime and notifications

Every post/comment/reaction/vote mutation dispatches `FeedPostChanged` (`ShouldBroadcastNow`) on private channel `feed.channel.{uuid}`, event name `feed.post.changed`, payload `{channelId, action, postId}` with `action` ∈ `created|updated|deleted|commented|reacted|voted` (`app/Events/FeedPostChanged.php`). Channel auth = `FeedAccess::canView` (`routes/channels.php:90-94`). The signal carries no content: the client refetches `GET /posts/{postId}` and patches the card, drops it on `deleted`, and reloads the open comment thread on `commented` (`feed.js:4696-4735`). The web page subscribes only to the currently open channel. Portal notifications (`feed.post|feed.announcement|feed.poll|feed.acknowledgement|feed.mention|feed.reply|feed.comment|feed.reaction|feed.channel_invite|feed.scheduled_published|feed.schedule_failed`) are raised through the shared `Notifier` (`app/Support/Feed/FeedNotifier.php`), deduped per post. Scheduled posts publish via `feed:publish-scheduled` every minute — needs the scheduler and a queue worker (`routes/console.php:473-495`).

### 4. Gotchas for a native client

1. Occurrence ids contain `@` — percent-encode in paths; strip the suffix before exporting.
2. `DELETE /events/{uuid}` takes its `scope` as a JSON body, not a query param (`calendar.js:2389-2392`).
3. `GET /events` silently drops hidden calendars; a client-side "show all" must first PUT `/subscription {visible:true}`.
4. Calendar 403s carry a `message`; Feed hides everything behind 404 — treat feed 404 as "remove locally".
5. `channelId` on PATCH `/posts/{uuid}` is `prohibited` → 422.
6. Attachments must be staged (POST `/channels/{uuid}/attachments`) before the post/comment that references them; unclaimed stages are pruned after 24 h (`FeedAttachmentIntake::pruneStaged`).
7. Attachment and channel image URLs require the session cookie; they are not public.
8. Poll counts of `null` mean hidden, not zero.
9. Calendar realtime reaches staff only; clients must poll.
10. Link previews / URL unfurling: **not found** in feed code (no endpoint, no `og:` handling in `feed.js`).
11. Feed views `mine` is client-side; everything else is the `view` query param.
12. ICS export is a plain navigation download (`text/calendar`); on Android fetch with the cookie and save.

---

### A7. Messaging, calls, recordings, presence and availability

All paths are relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Everything below was read from code; "not found" means the code does not contain it.

### 1. Transport contract every native call must honour

| Concern | Fact | Source |
|---|---|---|
| Auth | Session-cookie only (Laravel `auth` middleware). No Sanctum/API-token layer exists in the repo (`config/` has no sanctum file; no `HasApiTokens` / `auth:sanctum` anywhere). | `routes/web.php:161`, grep |
| Middleware on every messaging/availability route | `auth, verified, profile.complete, account.approved, onboarded, mfa.enforced` | `routes/web.php:161` |
| Required headers | `Accept: application/json`, `X-Requested-With: XMLHttpRequest`; on non-GET: `X-XSRF-TOKEN` = URL-decoded value of the `XSRF-TOKEN` cookie; `X-Socket-ID` = the Reverb `socket_id` when connected. | `public/js/messaging-api.js:15-42` |
| Why X-Socket-ID matters | Server uses `broadcast()->toOthers()`; without the header the client receives its own echoes and (historically) marked its own message "delivered". | `messaging-api.js:21-30`, `app/Support/Messaging/Broadcaster.php:22-31` |
| JSON bodies | `Content-Type: application/json`; multipart only for attachments, group photo, recording chunks. | `messaging-api.js:43-46,169-215,283-310` |
| Error shape | Non-2xx JSON `{ message, errors?: { field: [..] } }` (Laravel validation = 422). The web client treats **404 as "gone"** (drop the conversation) because a non-member gets 404, never 403. | `messaging-api.js:52-64`, `app/Http/Controllers/MessagingController.php:48-52,1722-1729` |
| 403s that do exist | Blocked pair (`assertNotBlocked`), edit window expired, not group admin, contact out of scope. | `MessagingController.php:938,964,1780-1791`; `MessagingGroupController.php:340-349` |
| Dates | `sentAt`/`timestamp`/`lastSeenAt`/`statusExpiresAt` etc. are ISO-8601 instants. `time`, `date`, `lastSeen` strings are **pre-formatted in the viewer's own timezone** (`UserTime`). A native client should render from the ISO fields and treat the strings as fallbacks. | `app/Support/Messaging/MessagingPresenter.php:204-208,260-262,552-566` |
| Broadcast auth | Default Laravel `POST /broadcasting/auth` (registered by `withRouting(channels:)`), body `{socket_id, channel_name}` with the same cookie + XSRF headers; returns `{auth, channel_data?}`. | `bootstrap/app.php:24`, `public/js/messaging-realtime.js:419-435` |

### 2. Endpoint table — `/portal/messaging` (`routes/web.php:1177-1258`)

| Method & path | Request | Response | Notes / source |
|---|---|---|---|
| GET `/conversations` | – | `{conversations:[Conversation], me:{id,name,photo}, settings:Settings, tabCounts:{calls}, realtime:{enabled,key,host,port,scheme}, limits:{maxAttachmentBytes,maxAttachmentLabel,maxAttachmentsPerMessage}}` | Bootstrap call. Also self-heals org-chat membership and client links. Sorted pinned first then `timestamp` desc. `MessagingController.php:62-137,218-233` |
| POST `/conversations` | `{userId:int}` | 201 `{conversation}` | Open/reuse direct thread. 422 if self, 403 if blocked or outside `ContactScope`. `:1625-1653` |
| GET `/contacts?q=` | – | `{contacts:[{id,name,email,photo,accountType}]}` | Max 50, approved users, blocked pairs excluded; clients only see assigned staff + admins. `:1583-1620`, `app/Support/Access/ContactScope.php` |
| GET `/conversations/{uuid}/messages?before=&around=` | `before` = oldest loaded `seq`; `around` = a seq | `{messages:[Message], hasMore:bool, conversation:Conversation}`; with `around`: adds `hasNewer, around` | Page size **30**, oldest-first, id-cursor, respects personal clear marker. `:56,237-315` |
| POST `/conversations/{uuid}/messages` | `{body?:≤20000, replyTo?:messageUuid, nonce?:uuid, attachments?:[stagedUuid]≤10}` | `{message:Message}` | **Idempotent on `nonce`** (retry returns original). Needs text or a file. Type = voice/attachment/text. Sender's read mark + draft cleared. `:319-420` |
| POST `/conversations/{uuid}/attachments` | multipart `file`, optional `voice=1`, `durationMs`, `waveform[]` (≤200 numbers) | 201 `{attachment:Attachment}` | Staged (not sent) until claimed by a send. Limit = min(100 MB, php ini). `:802-833`, `app/Support/Messaging/AttachmentIntake.php` |
| DELETE `/attachments/{uuid}` | – | `{removed:true}` | Only uploader, only while staged. `:841-857` |
| GET `/attachments/{uuid}` / `/thumb` | – | bytes, `Content-Disposition` inline for image/audio/video else attachment; thumb is JPEG | Membership checked; requires session cookie. No public URL exists. `app/Http/Controllers/MessagingAttachmentController.php` |
| GET `/conversations/{uuid}/photo` | – | JPEG bytes | Group photo. same file |
| PATCH `/messages/{uuid}` | `{body}` | `{message}` | Only own **text** messages within **10 min**. `app/Models/Message.php` (`EDIT_WINDOW_MINUTES=10`), `:934-955` |
| DELETE `/messages/{uuid}` | – | `{deleted:true,id}` | Soft delete; own messages, or group admin. `:958-978` |
| POST `/messages/{uuid}/reactions` | `{emoji}` (≤32 chars, must be emoji) | `{message}` | One reaction per user per message: same emoji toggles off, different replaces. `:870-909` |
| POST `/messages/{uuid}/star` | – | `{starred:bool,id}` | Per-viewer. `:981-1015` |
| POST `/messages/{uuid}/forward` | `{conversationId}` | `{message, conversation}` | Text only, prefixed `Forwarded: `; attachments not copied. `:1021-1067` |
| POST `/conversations/{uuid}/call` | `{type, payload?, media?, initiatorId?, answered?}` | `{ok:true}` | Call signalling relay (see §5). `:1078-1163` |
| POST `/conversations/{uuid}/read` | – | `{unread:0}` | Advances read mark, clears bell notifications, broadcasts `conversation.read` only if `readReceipts` on. `:1264-1291` |
| POST `/conversations/{uuid}/delivered` | – | `{delivered:seq}` | Delivery ack (not gated by privacy). `:1300-1320` |
| POST `/delivered` | – | `{delivered:n}` | Bulk ack for all conversations; call after loading the list. `:1332-1375` |
| POST `/conversations/{uuid}/unread` | – | `{markedUnread:true}` | `:1377-1386` |
| POST `/conversations/{uuid}/typing` | `{typing:bool}` | `{ok,broadcast:bool}` | Nothing stored; suppressed if user disabled `typingIndicator` or pair blocked. `:1689-1714` |
| PUT `/conversations/{uuid}/draft` | `{draft?:≤20000}` | `{saved:true}` | Server-side draft per participant. `:1390-1406` |
| PATCH `/conversations/{uuid}` | `{pinned?:bool, archived?:bool, muteMinutes?:int|null}` | `{conversation}` | `muteMinutes:null` = mute 10 years, `0` = unmute. Broadcasts `messaging.inbox` reason `state` to own other devices. `:1410-1448` |
| POST `/conversations/{uuid}/clear` | – | `{cleared:true,before:seq}` | One-sided clear marker. `:1459-1475` |
| DELETE `/conversations/{uuid}` | – | `{left:true}` | Leave (sets `left_at`); 422 for org chat. `:1483-1509` |
| POST `/conversations/{uuid}/block` / `/unblock` | – | `{blocked:bool}` | Direct only (422 otherwise). `:1511-1533` |
| GET `/conversations/{uuid}/export` | – | `text/plain` attachment | `:1539-1578` |
| GET `/conversations/{uuid}/info` | – | `{conversation, profile:{name,photo,email,accountType,about,jobTitle,presence,workStatus,memberCount,members:[{id,name,photo,role,workStatus}]}, counts:{media,documents,links}, can:{block,openClientRecord}}` | `:461-544` |
| GET `/conversations/{uuid}/gallery?shelf=media|documents|links&before=` | – | `{items:[Attachment + {messageId,seq,senderName,date}]}` or links `[{url,domain,title,imageUrl,messageId,seq,senderName,date}]` | Max 120. `:551-601` |
| GET `/media?shelf=` | – | same items + `conversationId, conversationName` | Pooled across conversations. `:622-686` |
| GET `/search?q=` (≤200) | – | `{results:{people,conversations,messages,files,links}}` | 12 per group; message item `{id,seq,conversationId,conversationName,senderName,excerpt,sentAt,date}`. `app/Support/Messaging/MessagingSearch.php:27,95-240` |
| GET `/link-preview?url=` | – | `{preview:{url,siteName,title,description,imageUrl,domain,faviconUrl}|null}` | Server-cached. `:782-795`, `app/Models/LinkPreview.php:22-33` |
| GET `/calls` | – | `{calls:[{id,conversationId,name,photo,label,event,media,answered,initiatorId,actorId,actorName,time}]}` | Last 50 call system lines (`call_ended`/`call_missed`/`call_started`). `:1191-1260` |
| GET `/tab-counts` / POST `/tab-counts/seen` `{tab:'calls'}` | – | `{tabCounts:{calls:int}}` | Missed calls not placed by me since marker stored in `users.preferences.messagingSeen.callId`. `app/Support/Messaging/TabCounts.php` |
| GET/PUT `/settings` | PUT: any subset of Settings | `{settings}` | Stored in `users.preferences.messaging`. `app/Support/Messaging/MessagingSettings.php` |
| POST `/heartbeat` | – | `{ok:true}` | Presence touch (see §6). `:1673-1678` |
| POST `/groups` | `{name≤120, description?≤1000, memberIds:[int]}` | 201 `{conversation}` | Creator becomes `admin`. Max 256 members. `MessagingGroupController.php:26-83` |
| PATCH `/groups/{uuid}` | `{name?, description?}` | `{conversation}` | Admin only (403). `:89-127` |
| POST `/groups/{uuid}/photo` | multipart `photo` ≤10 MB image | `{conversation}` | `:129-171` |
| POST `/groups/{uuid}/members` | `{memberIds:[int]}` | `{conversation}` | Org chat accepts staff only. `:175-244` |
| PATCH `/groups/{uuid}/members/{userId}` | `{role:'member'|'admin'}` | `{conversation}` | Cannot demote last admin (422). `:266-297` |
| DELETE `/groups/{uuid}/members/{userId}` | – | `{conversation}` | `:246-264` |
| POST `/conversations/{uuid}/recordings` | `{media?:'audio'|'video'}` | 201 `{recording:{id}}` **or** 200 `{recording:null}` | See §7. `app/Http/Controllers/CallRecordingController.php:74-135` |
| POST `/recordings/{uuid}/chunks` | multipart `seq` (0..100000), `chunk` (≤16 MB) | `{ok:true}` | Duplicate seq overwrites harmlessly. `:142-166` |
| POST `/recordings/{uuid}/finish` | `{durationMs?, media?, failed?:bool}` | `{ok:true}` | Assembles chunks into the Vault. `:169-207` |

Recordings area (`routes/web.php:1266-1269`, capability `callRecordings.view`, **404** to others): GET `/portal/call-recordings?clientId&from&to&q&page` → `{recordings:[{id,clientId,clientUid,clientName,participants:[{id,name,accountType}],media,status:'recording'|'ready'|'failed'|'interrupted',size,durationMs,startedAt,endedAt,conversationId}], clients:[{id,name}], total, page, perPage:50}`; GET `/portal/call-recordings/{uuid}/media?download=1` streams `audio/webm`/`video/webm` with single-range `Range` support (206) (`CallRecordingController.php:222-379`). Employees see only their own recordings; admins see all (`:232-235`).

### 3. Payload shapes (verbatim keys)

**Conversation** (`MessagingPresenter.php:168-243`): `id(uuid), type:'direct'|'group', name, subtitle, subject:'provider'|'person'|null, about:{kind,clientUid,clientName,companyName}|null, photo, members:[{id,name,photo,online,lastSeenAt}] (groups, ≤5), memberCount, preview, reactionNote, time, timestamp(ISO), unread, pinned, archived, muted, markedUnread, draft, role:'member'|'admin', presence, workStatus, counterpartId, description, isDefault, canManage, canLeave, blocked`.
`presence` for a direct thread = availability shape (§6); for a group = `{label:'N online'|'N members', onlineCount}`.

**Message** (`:246-285`): `id(uuid), seq(int, monotonic — page & dedupe on this), type:'text'|'voice'|'attachment'|'system', direction:'in'|'out', body, deleted, edited, sender:{id,name,photo}|null, sentAt(ISO), time, replyTo:{id,seq,senderName,preview,type,attachmentName,thumbUrl}|null, attachments:[Attachment], reactions:[{emoji,count,mine,users:[{id,name}]}], starred, systemEvent:{event,...}|null, status:'sent'|'delivered'|'read'|null (own messages only; group needs everyone), can:{edit,delete}`.
System events (`:517-537`): `group_created, case_opened, member_added, member_removed, member_left, admin_granted, admin_revoked, name_changed, photo_changed, call_ended, call_missed, call_started`; call events carry `{actorName, actorId, label:'Voice call'|'Video call', media, answered, initiatorId}` (`MessagingController.php:1130-1141`).

**Attachment** (`:350-377`): `id, name, mime, size, width, height, durationMs, waveform:[0-100]≤60, shelf:'voice'|'media'|'documents', kind:'voice'|'image'|'video'|'audio'|'file', url, thumbUrl`.

**Settings** defaults (`MessagingSettings.php:22-52`): `onlineStatus:'everyone'|'contacts'|'nobody', lastSeen: same, readReceipts:true, typingIndicator:true, notificationSounds:true, messageTone:'chime'|'system'|'beep'|'none', ringtone:'ringtone-1'|'ringtone-2'|'none', desktopNotifications:true, notificationPreview:true, enterToSend:true, mediaAutoDownload:true, voicePlaybackSpeed:0.5–2.0, callDisplay:'island'|'compact'|'modal'`. Sound files: `public/audio/{message-chime,notification-system,message-sent,ringtone-1,ringtone-2}.mp3`.

### 4. Realtime (Reverb / Pusher protocol 7)

- Config comes from `GET /conversations` → `realtime` (`enabled,key,host,port,scheme`); `enabled:false` when `BROADCAST_CONNECTION != reverb` → the web client falls back to polling `/conversations` every 10 s (`messages.js:5943-5960`).
- URL: `ws(s)://host:port/app/{key}?protocol=7&client=tma-portal&version=1.0&flash=false` (`messaging-realtime.js:294-300`). Wait for `pusher:connection_established` → `data.socket_id` (event `data` arrives as a **JSON string**, parse it) (`:332-348`). Answer `pusher:ping` with `pusher:pong` (`:351-354`). Server ping interval 60 s (`config/reverb.php:86`); client treats 90 s silence as a zombie (`:33`). Backoff 1 s→30 s with jitter (`:23-24,473-486`). `pusher:error` codes 4000-4099 are fatal (stop reconnecting) (`:371-395`).
- Subscribe: POST `/broadcasting/auth` `{socket_id, channel_name}` then send `{event:'pusher:subscribe', data:{channel, auth, channel_data}}`; wait for `pusher_internal:subscription_succeeded` (`:419-460`).
- Channels (all private, prefix `private-`): `conversation.{uuid}` (member-gated), `messaging.user.{id}` (own), `portal.staff` (staff only), `App.Models.User.{id}` (`routes/channels.php:13-56`). Web subscribes to **every** conversation in the list plus its own channel (`messages.js:5936-5939,6200-6260`).

| Event (`broadcastAs`) | Channel(s) | Payload | Client behaviour |
|---|---|---|---|
| `message.sent` | conversation | `{conversationId, messageId, seq, senderId, sentAt}` | Signal-not-payload: refetch `/messages` (open) or refresh the row; then POST `/delivered`; POST `/read` only if visible. Sender is excluded, **except** call system lines which go to everyone. `messages.js:6266-6300`; `MessagingController.php:1143-1145` |
| `message.updated` | conversation | `{conversationId, messageId, seq, body, editedAt}` | patch body |
| `message.deleted` | conversation | `{conversationId, messageId, seq}` | mark deleted |
| `message.reacted` | conversation | `{conversationId, messageId, seq, reactions:[{emoji,count,users}]}` | derive `mine` locally |
| `conversation.delivered` | conversation | `{conversationId, recipientId, lastDeliveredSeq}` | ignore own id; `sent→delivered` for out msgs ≤ seq |
| `conversation.read` | conversation | `{conversationId, readerId, lastReadSeq}` | `→read`, never downgrade |
| `messaging.typing` | conversation | `{conversationId, userId, name, typing}` | TTL 7 s; sender re-announces every 3 s, idle stop 4 s (`messages.js:380-385`) |
| `messaging.presence` | up to 50 most recent conversations of that user | `{userId, online, lastSeenLabel}` | `app/Events/PresenceChanged.php`, `PresenceService.php:44-72` |
| `messaging.inbox` | messaging.user | `{reason:'read'|'unread'|'state', totalUnread, conversationId, detail:{pinned,archived,muted}}` | own other devices only |
| `call.signal` | conversation **and** each recipient's `messaging.user` | `{signalId, conversationId, fromUserId, type, payload}` | dedupe on `signalId` (2-min window). `app/Events/CallSignal.php` |
| `presence.status` | `portal.staff` + `App.Models.User.{id}` | `{userId, status, label, source, message, icon, expiresAt}` | availability change. `app/Events/UserStatusChanged.php` |

### 5. Call protocol (WebRTC, signalled through `POST /conversations/{uuid}/call`)

Server (`MessagingController.php:1078-1163`): validates `type in ring,offer,answer,ice,hangup,reject,accept,state,upgrade,upgrade-accept,upgrade-decline,downgrade`, `payload` array, `media`, `initiatorId`, `answered`; injects `payload.media`, `payload.fromName`, `payload.fromPhoto`; fans out `call.signal` to others. On `hangup`/`reject` it writes the system line (`call_ended` if `answered` and not reject, else `call_missed`), broadcasts it to **everyone**, and sends a `call.missed` notification to the non-initiator (`MessageNotifier.php:66-100`). 1:1 only in practice (group rings reach all members but the JS is single-peer).

ICE config: **STUN only** `stun:stun.l.google.com:19302`; no TURN anywhere (`messaging-calls.js:43`). Both an audio and a video transceiver are added up front by the caller; all later switches are `replaceTrack`, never renegotiation (`:747-757`). Constraints: `{audio:true|{deviceId:{ideal}}, video:true|{deviceId:{ideal}}|false}` (`:535-541`).

Sequence (A = caller, B = callee):
1. A: `getUserMedia` → build `RTCPeerConnection` → **`ring`** `{media}` → `createOffer` → `setLocalDescription` → **`offer`** `{media, payload:{sdp:{type,sdp}}}` (`:2918-2937`). A rings locally with `settings.ringtone`, 15 s timeout (`:388-409`).
2. B (on `ring`/`offer`, session created from `ring`; `offer.payload.sdp` stored as `remoteOffer`): shows incoming UI + OS notification, starts a local-only preview, timeout 30 s, replies **`state`** `{payload:{ringing:true}}` so A shows "Ringing…" (`:3181-3205`).
3. B accepts: **`accept`** `{media}` (A stops ringing, "Connecting…"), then `setRemoteDescription(offer)` → `createAnswer` → **`answer`** `{media, payload:{sdp}}` (`:3040-3160`). Decline = **`reject`** `{media, initiatorId, answered:false}` (`:3113-3125`).
4. Both: `onicecandidate` → **`ice`** `{payload:{candidate:RTCIceCandidateInit}}`; remote candidates buffered until a remote description exists (`:703-716,767-770,3226-3231`).
5. On `connectionState==='connected'`: timer starts, **`state`** `{payload:{muted,cameraOff,media,screenSharing,recording}}` published (also on every toggle), and `maybeStartRecording()` asks the server (§7) (`:838-870,514-524`).
6. Mid-call: mute/camera toggles send `state`; voice→video = **`upgrade`** `{media:'video'}` → peer **`upgrade-accept`** or **`upgrade-decline`**; video→voice = **`downgrade`** `{media:'audio'}`; screen share = `replaceTrack` on the video sender + `state.screenSharing` (`:2281-2380,2650-2775`). Disconnected → "Reconnecting…"; `failed` → error (`:773-793`).
7. End: **`hangup`** `{media, initiatorId, answered:bool}` (`:493-506`); recorder stopped **before** `pc.close()`. Ring timeout on A sends hangup with `answered:false` (missed). Reporting on-call to availability: `POST /me/availability/call {active}` (`presence-status.js:1012-1014,1084-1100`).

Presentation: modes `incoming|modal|compact|island`; answered call lands in `settings.callDisplay`; floating window uses Document Picture-in-Picture (`:1262-1290`) — on Android replace with a foreground service + system PiP. Desktop shell reads `data-tma-call` / `data-tma-call-info` `{name,avatar,media}` to ring its own panel and calls `TMAMessagingCalls.accept(true)/decline()` (`desktop/main.js:873-920`).

### 6. Presence, last-seen and availability

- Heartbeat `POST /portal/messaging/heartbeat` every **30 s** while visible; server sets `online_until = now+45 s` (`messages.js:9281-9288`, `app/Models/UserPresence.php` `ONLINE_TTL_SECONDS=45`). Logout calls `PresenceService::release` (`app/Listeners/RecordAuthEvent.php:151`). No other offline path exists — a killed app just expires.
- `PresenceService::forViewer` (`PresenceService.php:76-101`): `{online:true}` or `{online:false, lastSeen:'Last seen …', lastSeenAt?}`; honours `onlineStatus`/`lastSeen` privacy (`everyone|contacts|nobody`; `contacts` = shares a conversation) — hidden gives `'Last seen recently'`. Client-side label rules mirror `app/Support/Presence/LastSeen.php` / `public/js/last-seen.js` (just now / N minutes ago / N hours ago same day / yesterday at / weekday at / date at; short form for lists).
- `AvailabilityService::forViewer` adds `status, statusLabel, statusSource, statusMessage, statusStartedAt, statusExpiresAt, statusIcon` (`AvailabilityService.php:236-270`). Status ids/labels/icon keys and priority order in `app/Support/Presence/AvailabilityStatus.php` (`on_call > do_not_disturb > at_meeting > away > in_office > working_remote > available > online > offline`; icons `green|gray|red|calendar|dnd|office|home|away|…`; `MANUAL_PICKS` = available, on_call, at_meeting, do_not_disturb, in_office, working_remote, away).
- `/me/availability` (`routes/web.php:245-258`, `AvailabilityController.php`):

| Method & path | Body | Returns |
|---|---|---|
| GET `/` | – | `{primary:{status,source,message,label,icon,startedAt,expiresAt}, states:[{status,source,message,startsAt,expiresAt,meta}], locations:[{type:'office'|'remote',label,address,latitude,longitude,radiusM,enabled}], schedules:[{id,status,message,startsAt,endsAt,recurrence,enabled}], manualPicks:[…], allStatuses:{id:label}}` |
| PUT `/status` | `{status, message?≤140, startsAt?, expiresAt?(after startsAt)}` | same payload; `online`/`available` clears manual+scheduled |
| DELETE `/status` | `{status}` | same |
| PUT `/message` | `{message?}` | same |
| POST `/location` | `{lat,lng,accuracyM?}` | same; geofence → `in_office`/`working_remote`, coords not stored. Web polls every 5 min while visible when a location is enabled (`presence-status.js:1020-1079`) |
| GET `/geocode?q=` / `/reverse-geocode?lat&lng` | – | `{lat,lng,label}`; 503/422 on failure (Nominatim proxy) |
| PUT `/locations` / DELETE `/locations/{office|remote}` | `{type,label?,address?,latitude,longitude,radiusM?(25-5000),enabled?}` | same payload |
| POST `/schedules` / DELETE `/schedules/{id}` | `{id?,status,message?,startsAt,endsAt,recurrence?,enabled?}` | same payload |
| POST `/call` | `{active:bool}` | `{ok:true}` (sets/clears `on_call`) |

- Team board: GET `/portal/dashboard/staff` → `{staff:bool, employees:[{id,name,firstName,jobTitle,avatar,accountType,self,online,lastSeen,lastSeenAt,status,statusLabel,statusSource,statusMessage,statusIcon,workStatus}], canManage}`; `{staff:false}` for non-`presence.view` (`app/Http/Controllers/StaffPresenceController.php`, `routes/web.php:171`).

### 7. Client-call recordings (auto-record rules)

- Decision is **server-side only**: `start` returns `{recording:null}` unless caller is staff AND (conversation has `client_id` OR counterpart is a client). Only the staff side ever gets an id; the client side receives `null` (`CallRecordingController.php:74-135`). Both peers call start on connect; a 4xx/null means "not recorded", 5xx/network gets one retry after 4 s (`messaging-calls.js:2424-2469`).
- Consent: banner + `state.recording:true` are sent **1.5 s before** the recorder starts (`:2421,2456-2460`). Peer shows "This call is being recorded" on `state.recording` (`:3277-3281`).
- Capture: local + remote audio mixed to one track (Web Audio), plus the **remote** video track on video calls; `MediaRecorder` mime `video/webm;codecs=vp8,opus` or `audio/webm;codecs=opus`, 48 kbps audio, 650 kbps video, `timeslice` 10 s (`:2472-2560`). Chunks uploaded sequentially with one retry; `finish {durationMs, media, mime}` after the last chunk; `finish {failed:true}` on abort (`:2564-2645`). Recording stops before teardown so the final chunk survives.
- Row states: `recording` → `ready`/`failed`; a `recording` row untouched >5 min lists as `interrupted` (`app/Models/CallRecording.php`).

### 8. Voice notes

`public/js/messaging-recorder.js`: `getUserMedia({audio:true})`, `MediaRecorder` with first supported of `audio/webm;codecs=opus, audio/webm, audio/ogg;codecs=opus, audio/mp4, audio/mpeg`; max **10 min** (`MAX_MS`); 60 waveform peaks 0-100 from an analyser. Upload via `POST /conversations/{uuid}/attachments` with `voice=1, durationMs, waveform[]`, then `POST /messages {nonce, attachments:[id]}` (`messages.js:7300-7308`). Server caps duration at 10 min and 60 points (`AttachmentIntake.php:151-186`); bubble `kind:'voice'`, playback speed from `settings.voicePlaybackSpeed`.

### 9. Native-client gotchas

1. Every write needs the cookie session **and** `X-XSRF-TOKEN`; a missing/expired session on an XHR returns 401/419 JSON only when `Accept: application/json` is set — otherwise an HTML redirect to sign-in (attachment `<img>` fetches must carry the cookie; there are no signed public URLs).
2. Always send `X-Socket-ID` with writes once the socket is up, or the app will process its own `message.sent`/`conversation.delivered` echoes and show false double ticks.
3. `seq` (int) is the ordering/dedupe key, not `sentAt`. Paging is `before=<oldest seq>`, 30 per page; `around=<seq>` for search jumps.
4. Send with a client-generated UUID `nonce` and persist it in the offline write queue — the server returns the original message on retry, so replaying a queue after reconnect is safe. Attachments must be staged (uploaded) first; staged uuids are scoped to uploader + conversation, so queue them per conversation and re-upload if `422 attachments` says they expired (24 h prune, `AttachmentIntake.php:130`).
5. Unread = messages after `last_read_message_id` and after the clear marker, excluding own and system messages; `markedUnread` forces a badge of 1 (`MessagingController.php:167-195`, `MessagingPresenter.php:461-472`).
6. Delivery ticks: POST `/delivered` (bulk) after loading the list; POST `/conversations/{uuid}/delivered` on each arrival even when the thread isn't open; POST `/read` only when the thread is actually on screen.
7. Typing: throttle outbound to one POST per 3 s, send `typing:false` on idle (4 s) and when the app backgrounds; expire inbound after 7 s.
8. Realtime data field is a JSON string; parse before use. Subscribe to `messaging.user.{id}` **first** — incoming calls only reliably arrive there (`messages.js:6206-6230`). Reconnect must re-auth every channel and then refetch (`realtime.onState('connected')`).
9. Call signalling carries the SDP inside `payload.sdp` as `{type,sdp}`; ICE inside `payload.candidate`. Dedupe on `signalId`. No TURN means calls across symmetric NAT/cellular may fail — flag to the firm; adding TURN means changing `ICE` in `messaging-calls.js:43` (there is no server-provided ICE config endpoint — not found).
10. Recordings are WebM; Android's `MediaRecorder` cannot natively write WebM/Opus from WebRTC tracks — the vibe coder will need a custom Opus/VP8 muxer (or the firm accepts a format change on the server: `finish()` forces `mime` to `audio/webm`/`video/webm`, `CallRecordingController.php:196-198`).
11. Time strings (`time`, `date`, `lastSeen`) are already in the account's preferred zone; prefer ISO fields and format locally, but keep the server labels for parity on lists.
12. `desktopNotifications`, `notificationSounds`, `messageTone`, `ringtone`, `callDisplay` are account settings via `/settings`; device preferences (camera/mic ids, floating window) are local-only in the web app (`messaging-calls.js:75-93`).
13. Muted conversations still count in badges but never notify (`MessageNotifier.php:106-113`); missed-call notifications use type `call.missed`, messages `message.received|message.reply|message.attachment|message.group`, deep link `/social/messages?conversation={uuid}`.

---

### A8. Realtime over Reverb: connection, channel auth, channels, events

All paths are relative to `/Users/vernonfrancis/Github/TMA-PORTAL`. Everything below was read from code; "not found" means it does not exist in the repo.

### 1. Where the client gets its connection details

There is no build-time config. The portal shells are static and read the Reverb details from JSON responses:

| Source | Key | Shape | File |
|---|---|---|---|
| `GET /me` | `realtime` | `{enabled:bool, key?, host?, port?:int, scheme?}` | `app/Http/Controllers/MeController.php:58`, `app/Support/RealtimeConfig.php:16-31` |
| `GET /portal/messaging/conversations` (messaging bootstrap) | `realtime` | identical shape | `app/Http/Controllers/MessagingController.php:137, 225-241` |

`enabled` is `false` whenever `config('broadcasting.default') !== 'reverb'` (`RealtimeConfig.php:18-20`); every JS surface then falls back to loads/polls and never opens a socket (`public/js/portal-live.js:263-268`, `public/js/notify-realtime.js:66-70`). `key` is the public `REVERB_APP_KEY`; the secret never leaves the server (`RealtimeConfig.php:7-9`). `host`/`port`/`scheme` come from `broadcasting.connections.reverb.options` = `REVERB_HOST`, `REVERB_PORT` (default 443), `REVERB_SCHEME` (default https) (`config/broadcasting.php:33-42`).

Production values (`.env:119-124`): `REVERB_HOST=ws-a2504f51-381e-4915-888b-90ad4ab4795d-reverb.laravel.cloud`, `REVERB_PORT=443`, `REVERB_SCHEME=https`, `REVERB_APP_ID=10001`. The app key is in `.env:120`; do not hard-code it, read it from `/me`. `.env.example:111-116` defaults to `localhost:8080` `http`. Docker: nginx proxies `location ^~ /app/` and `^~ /apps/` to `reverb:8080` with websocket upgrade headers, 3600s read/send timeouts, no buffering (`docker/nginx/templates/app.conf.template:92-104`, `docker/nginx/reverb-proxy.inc`), so in Docker the socket host is the app host itself.

Server-side app options (`config/reverb.php:63-87`): `allowed_origins ['*']`, `ping_interval 60`, `activity_timeout 30`, `max_message_size 10000`, `accept_client_events_from 'members'`, rate limiting off by default. `.env` sets `BROADCAST_CONNECTION=reverb` (`.env:41`).

### 2. Exact WebSocket URL and handshake

Built in `public/js/messaging-realtime.js:295-301`:

```
{ws|wss}://{host}:{port}/app/{encodeURIComponent(key)}?protocol=7&client=tma-portal&version=1.0&flash=false
```

`wss` when `scheme === 'https'`, else `ws`. Reverb routes the socket at `GET /app/{appKey}` (`vendor/laravel/reverb/src/Servers/Reverb/Factory.php:98`). Unknown key: server sends `pusher:error` code 4001 "Application does not exist" (`vendor/laravel/reverb/src/Protocols/Pusher/Http/Controllers/PusherController.php:59`).

Protocol (plain Pusher v7, no library on the web side; `messaging-realtime.js:1-13`):

1. Socket `open` is not "connected". Wait for `pusher:connection_established`; its `data` carries `socket_id` and `activity_timeout` (`vendor/laravel/reverb/src/Protocols/Pusher/EventHandler.php:50-52`; client `messaging-realtime.js:337-345`).
2. **`data` is a JSON string, not an object** on every frame from Reverb; parse the envelope, then parse `data` again (`messaging-realtime.js:326-334`).
3. Reply to `{event:"pusher:ping"}` with `{event:"pusher:pong",data:{}}` (`messaging-realtime.js:347-350`). Reverb runs a 60s loop that pings connections with no traffic inside `ping_interval` (60s) and prunes ones that were pinged and stayed silent (`vendor/laravel/reverb/src/Servers/Reverb/Console/Commands/StartServer.php:96-100`, `Contracts/Connection.php:130-149`). A client may also send `{event:"pusher:ping"}` and gets `pusher:pong` back (`EventHandler.php:39`); the browser uses server pings plus a 90s "no frame = zombie" rule (`STALE_MS`, `messaging-realtime.js:32-34, 111-116`).
4. `pusher_internal:subscription_succeeded` marks a channel subscribed (`messaging-realtime.js:357-360`).
5. Any other frame: dispatch by `payload.channel` + `payload.event` (`messaging-realtime.js:362`). Event names are exactly the `broadcastAs()` strings, e.g. `message.sent`, no leading dot (raw protocol, not Echo).

`pusher:error` codes (`messaging-realtime.js:365-400`; server codes in `vendor/laravel/reverb/src/Protocols/Pusher/Exceptions/*.php`, `Server.php:130-137`, `ClientEvent.php:38,57`): 4000-4099 fatal, stop reconnecting (4001 no app, 4004 connection limit, 4009 origin/unauthorised); 4100-4199 reconnect with backoff; 4200-4299 reconnect immediately (4200 "Invalid message format"); 4301 client-event rate limit. On a fatal code the web client emits state `refused` and the Messages page switches to a 10s poll of `/portal/messaging/conversations` (`public/js/messages.js:5928-5940, 5946-5987`).

### 3. Private-channel authorisation

Every channel is `private-*`. Authorisation is done by the Laravel app, not Reverb (`messaging-realtime.js:414-418`):

```
POST {ROOT}/broadcasting/auth
Content-Type: application/json
Accept: application/json
X-Requested-With: XMLHttpRequest
X-XSRF-TOKEN: <url-decoded XSRF-TOKEN cookie>
Cookie: <session cookie>, XSRF-TOKEN
{"socket_id":"<from connection_established>","channel_name":"private-conversation.<uuid>"}
```
(`messaging-realtime.js:419-435`). Success body is `{"auth":"<key>:<hmac>"}` (plus `channel_data` for presence channels, none exist here) (`vendor/laravel/framework/src/Illuminate/Broadcasting/Broadcasters/PusherBroadcaster.php:104-113`). Then send `{event:"pusher:subscribe",data:{channel,auth,channel_data}}` (`messaging-realtime.js:452-459`). Leave with `{event:"pusher:unsubscribe",data:{channel}}` (`messaging-realtime.js:487-491`).

Route wiring: `bootstrap/app.php:24` passes `channels:` to `withRouting`, which calls `Broadcast::routes()` (`vendor/laravel/framework/src/Illuminate/Foundation/Configuration/ApplicationBuilder.php:128-139, 183-184`). That registers `GET|POST /broadcasting/auth` under the `web` middleware group only, **without** the CSRF middleware (`withoutMiddleware(PreventRequestForgery)`) and without `auth` (`vendor/laravel/framework/src/Illuminate/Broadcasting/BroadcastManager.php:79-93`). Consequences:

- No session / expired session: `retrieveUser` is null, so `AccessDeniedHttpException` → **403**, not 401/419 (`PusherBroadcaster.php:82-95`). A 403 on auth therefore means "signed out OR not allowed"; re-check `/me` (401 → re-login) before deciding.
- Channel rule false → 403 (`vendor/.../Broadcaster.php:109-121`; browser test asserts 403 for a foreign conversation, `tests/Browser/messaging-realtime.mjs:151-172`).
- The XSRF header is harmless but not required on this one route. It IS required on every other POST/PUT/PATCH/DELETE (see §7).

Channel rules (`routes/channels.php`; wire names carry the `private-` prefix, the patterns do not):

| Channel (wire name) | May subscribe | Rule | Line |
|---|---|---|---|
| `private-App.Models.User.{id}` | that user only | `user->id === id` | 14-16 |
| `private-portal.staff` | staff only | `Role::isStaff($user)` | 30-32 |
| `private-conversation.{uuid}` | current participants | `Conversation::forUser($user)->where('uuid')->exists()` | 41-46 |
| `private-messaging.user.{id}` | that user only | `user->id === id` | 53-55 |
| `private-file.{uuid}` | anyone who may view the file (trashed included) | `FileAccess::can($user,'view',$file)` | 75-79 |
| `private-cip.application.{uuid}` | staff and provider side within scope | `ApplicationScope::query($user)->where('uuid')->exists()` | 88-90 |
| `private-feed.channel.{uuid}` | readers of the channel | `FeedAccess::canView($channel,$user)` | 92-96 |

`portal-live.js:222-232`: a non-staff account must **not** request `private-portal.staff`; it 403s. Use `me.isStaff` from `/me`. Presence channels (`presence-*`): not found.

### 4. Event catalogue

All events implement `ShouldBroadcastNow` (sent inside the request, never queued) and are best-effort: failures are swallowed or logged (`app/Support/Messaging/Broadcaster.php:20-31`, `app/Support/Realtime/Live.php:152-167`). Dates are ISO-8601 strings via `toIso8601String()`.

| Event (`broadcastAs`) | Channel(s) | Payload keys | Client action | Source |
|---|---|---|---|---|
| `data.changed` | `portal.staff` and/or `App.Models.User.{id}` | `{resource}` | refetch that surface through its normal endpoint; 300 ms debounce | `app/Events/PortalDataChanged.php`, `Live.php` |
| `notification.created` | `App.Models.User.{id}` | `{notification:{id,type,level,module,priority,title,message,icon,image,isSystem,actor,actionUrl,actionLabel,subjectType,subjectId,read,readAt,requiresAction,completed,createdAt,meta}, unread:int}` | prepend item, set badge to absolute `unread`, raise OS notification | `PortalNotificationCreated.php`, `app/Support/Notifications/NotificationPresenter.php:23-48`, `Notifier.php:236-256` |
| `presence.status` | `portal.staff` + `App.Models.User.{id}` | `{userId,status,label,source,message,icon,expiresAt}` | update availability pill of that user; own id → reload `/me/availability` | `UserStatusChanged.php`, `AvailabilityService.php:516-523`, `presence-status.js:1104-1117` |
| `message.sent` | `conversation.{uuid}` | `{conversationId,messageId,seq,senderId,sentAt}` | no body: fetch `GET /portal/messaging/conversations/{uuid}/messages`, merge, then `POST .../delivered`, `POST .../read` only if visible, notify if `senderId != me` and not muted | `MessageSent.php`, `messages.js:6262-6330` |
| `message.updated` | `conversation.{uuid}` | `{conversationId,messageId,seq,body,editedAt}` | patch body, mark edited | `MessageUpdated.php`, `messages.js:6015-6021` |
| `message.deleted` | `conversation.{uuid}` | `{conversationId,messageId,seq}` | placeholder, clear body/attachments | `MessageDeleted.php`, `messages.js:6023-6030` |
| `message.reacted` | `conversation.{uuid}` | `{conversationId,messageId,seq,reactions:[{emoji,count,users:[{id,name}]}]}` | replace reactions; derive `mine` locally | `MessageReacted.php`, `messages.js:6032-6050` |
| `conversation.delivered` | `conversation.{uuid}` | `{conversationId,recipientId,lastDeliveredSeq}` | ignore if `recipientId == me`; own `out` messages with `seq <= lastDeliveredSeq` and status `sent` → `delivered` | `ConversationDelivered.php`, `messages.js:6052-6074` |
| `conversation.read` | `conversation.{uuid}` | `{conversationId,readerId,lastReadSeq}` | ignore if `readerId == me`; `seq <= lastReadSeq` → `read`, never downgrade | `ConversationRead.php`, `messages.js:6076-6091` |
| `messaging.typing` | `conversation.{uuid}` | `{conversationId,userId,name,typing}` | show/hide indicator; expire on a local timer if stop is lost | `UserTyping.php`, `messages.js:6093-6095` |
| `messaging.presence` | up to 50 most-recent `conversation.{uuid}` of that user | `{userId,online,lastSeenLabel}` | update dot on every row whose counterpart is `userId`; only on transitions | `PresenceChanged.php`, `PresenceService.php:30,84-108` |
| `messaging.inbox` | `messaging.user.{id}` | `{reason:'read'|'unread'|'state', totalUnread, conversationId, detail:{pinned?,archived?,muted?}}` | sync own personal state across devices; `state` carries the three booleans | `InboxUpdated.php`, `MessagingController.php:1283,1386,1442-1446,1758-1766`, `messages.js:6232-6252` |
| `call.signal` | `conversation.{uuid}` AND each recipient's `messaging.user.{id}` | `{signalId,conversationId,fromUserId,type,payload}`; `type` ∈ ring,offer,answer,ice,hangup,reject,accept,state,upgrade,upgrade-accept,upgrade-decline,downgrade; server adds `payload.media`, `payload.fromName`, `payload.fromPhoto` | dedupe by `signalId` (120 s window); ring arrives on the user channel even when the thread is not open | `CallSignal.php`, `MessagingController.php:1085-1118`, `messaging-calls.js:3357-3370` |
| `feed.post.changed` | `feed.channel.{uuid}` | `{channelId,action,postId}`; `action` ∈ created,updated,deleted,commented,reacted,voted | `deleted` → remove; else refetch that one post and upsert; refresh open comment thread on `commented` | `FeedPostChanged.php`, `feed.js:4697-4730` |
| `file.comment.changed` | `file.{uuid}` | `{fileId,commentId,rootId,action}`; action ∈ created,updated,deleted | drop comment cache, refetch thread | `FileCommentChanged.php`, `portal-files.js:3407-3412` |
| `file.detail.changed` | `file.{uuid}` | `{fileId,section}`; section ∈ details,versions,approvals,activity | invalidate that panel, refetch the one on screen | `FileDetailChanged.php`, `app/Observers/FileDetailObserver.php:76-104`, `portal-files.js:3424-3440` |
| `file.presence.changed` | `file.{uuid}` | `{fileId,action}`; action ∈ joined,left | refetch `GET /portal/files/{uuid}/presence` | `FilePresenceChanged.php`, `app/Support/Files/Presence.php:56,72,85,164-170` |
| `cip.thread.changed` | `cip.application.{uuid}` | `{applicationId,action}` (only `created` seen) | refetch thread if that tab is open, else mark application stale | `CipThreadChanged.php`, `app/Support/Cip/Threads.php:79`, `clients.js:8848-8867` |

`data.changed` resource names, shared verbatim by `app/Support/Realtime/Live.php:31-73` and `public/js/portal-live.js:26-39`: `files, clients, users, contacts, calendar, companies, projects, signatures, activity, workflows, cip, identity`. Reach per call: `Live::staff()` → `portal.staff`; `Live::user()/users()` → `App.Models.User.{id}`; `Live::staffAnd()` both (`Live.php:81-108`). Signals are coalesced per request and flushed on terminate / after a queued job (`Live.php:138-167`, `app/Providers/AppServiceProvider.php:195-196`). `identity` goes only to the affected user's own channel (`app/Observers/UserAccountObserver.php:45`); the browser reloads if the `capabilities` array from `/me` differs (`portal-live.js:243-304`).

### 5. Self-echo and the `X-Socket-ID` rule

`broadcast(...)->toOthers()` is used for all messaging events, file comments/presence/details, and every `data.changed` (`Live.php:158-161`, `Broadcaster.php:22-25`, `Comments.php:414`, `Presence.php:169`, `FileDetailObserver.php:89`). It can only exclude the actor when the write request carried the header **`X-Socket-ID: <socket_id>`**. Every web write path adds it: `portal-live.js:52-67` (`TMALive.headers()`), `messaging-api.js:29-41,207-208,306-307`, `notify-store.js:22-35`, `feed-api.js:28-41`, `presence-status.js:57-58`, `portal-upload-manager.js:40-41`, `portal-queue.js:290-296` (offline replays too), `clients.js:466-467`, `cip-intake.js:1119-1120`, `portal-home.js:1535`. Rule for Android: attach `X-Socket-ID` to every non-GET request whenever a socket is connected; omit when disconnected.

Events that deliberately reach the sender too: `presence.status` (`Broadcaster::to`, `AvailabilityService.php:522`), `notification.created` (`event()`, `Notifier.php:246`), `feed.post.changed` (`::dispatch`, e.g. `FeedPostController.php:355`), `cip.thread.changed` (`Threads.php:79`). Handlers must be idempotent; the Messages client additionally ignores its own `recipientId`/`readerId`/`userId` (`messages.js:6052-6060, 6076-6080, 6097-6100`).

### 6. Connection lifecycle the web/desktop clients implement

- One socket per client, many subscriptions; a channel registry keeps handlers so a reconnect re-authorises and re-subscribes every channel (`messaging-realtime.js:92-108, 461-466`).
- Backoff: `min(30000, 1000 * 2^retries) * (0.7..1.3)` jitter (`messaging-realtime.js:22-24, 495-510`). `retries` resets on socket `open`.
- Health: `isHealthy()` = connected, has socketId, readyState 1, last frame < 90 s ago; checked every 30 s while visible and on visibility/focus/online (`messaging-realtime.js:111-140`). `ensureAlive()` reconnects if unhealthy.
- On state `connected`: `TMALive.refreshAll()` refetches every registered surface (`portal-live.js:234-239`); notifications `catchUp({forceLoad:true})` (`notify-realtime.js:80-86`); Messages reloads conversations on visibility (`messages.js:9291-9300`). Anything missed while down is never replayed by the server.
- Hidden tab: `data.changed` refreshes are marked dirty and run on return (`portal-live.js:150-160, 210-215`). Notifications poll `/portal/notifications` count every 60 s only when the socket is not healthy (`notify-store.js:669-711`).
- Parking (browser multi-tab only): a tab hidden 5 min hands its socket to a sibling tab via `BroadcastChannel('tma-realtime-tabs')`; never while a call is active (`messaging-realtime.js:36-49, 157-289`). Not applicable to a single-process app.
- Desktop: Electron disables `backgroundThrottling` so the socket heartbeat and badge keep running while the window is hidden (`desktop/main.js:152-156`); window-policy keeps one window so the socket is never dropped (`desktop/window-policy.js:6`).
- Push notifications (FCM/APNs) for a closed app: not found anywhere in the repo.

### 7. HTTP side-channels the socket depends on

All under the portal group `['auth','verified','profile.complete','account.approved','onboarded','mfa.enforced']` (`routes/web.php:162`), messaging prefix `/portal/messaging` (`routes/web.php:1177`):

| Endpoint | Body | Purpose | File |
|---|---|---|---|
| `POST /portal/messaging/heartbeat` | none | keeps user online; every 30 s while visible, plus on focus; `ONLINE_TTL_SECONDS = 45` | `MessagingController.php:1688-1693`, `messages.js:9282-9288`, `app/Models/UserPresence.php:18` |
| `POST /portal/messaging/conversations/{uuid}/typing` | `{typing:bool}` | broadcasts `messaging.typing` unless the typist's `typingIndicator` setting is off or the pair is blocked; returns `{ok,broadcast}` | `MessagingController.php:1705-1729` |
| `POST /portal/messaging/conversations/{uuid}/delivered` | none | returns `{delivered:<seq>}`; broadcasts `conversation.delivered` only if newer | `MessagingController.php:1299-1323` |
| `POST /portal/messaging/delivered` | none | bulk ack for every conversation; `{delivered:<count>}` | `MessagingController.php:1333-1380` |
| `POST /portal/messaging/conversations/{uuid}/read` | see messaging brief | broadcasts `conversation.read` only when the reader publishes receipts | `MessagingController.php:1260-1283` |
| `POST /portal/messaging/conversations/{uuid}/call` | `{type, payload?, media?:'audio'|'video', initiatorId?, answered?}` | WebRTC signalling relay; writes a `call_ended`/`call_missed` history line on hangup/reject | `MessagingController.php:1085-1140` |
| `POST /portal/files/{uuid}/presence` / `DELETE` | `{session (≤64), action? (viewing|commenting|editing), device?}` | file presence heartbeat; pruned after 10 min silence | `routes/web.php:724-726`, `FilePresenceController.php:34-51`, `Presence.php:160-162` |
| `POST /me/availability/call` | `{active:bool}` | on-a-call availability | `presence-status.js:1012-1013`, `routes/web.php:245-248` |

Session and CSRF for a native client: the session cookie is named `Str::slug(APP_NAME).'-session'` (`config/session.php:141-144`), lifetime `SESSION_LIFETIME` default 120 min (`:46`), `same_site` lax (`:213`). Laravel 13's `PreventRequestForgery` accepts a request when `Sec-Fetch-Site: same-origin`, **or** `_token`/`X-CSRF-TOKEN` equals the session token, **or** `X-XSRF-TOKEN` decrypts to it (`vendor/laravel/framework/src/Illuminate/Foundation/Http/Middleware/PreventRequestForgery.php:95-103, 143-195`). The browser sends the URL-decoded `XSRF-TOKEN` cookie value as `X-XSRF-TOKEN` (`messaging-realtime.js:27-30`). A native client must persist the cookie jar and send the same header on every write; `Accept: application/json` makes failures render as JSON (`bootstrap/app.php:63-65`).

### 8. Recommended Android implementation

1. **Transport**: either `com.pusher:pusher-java-client` (`PusherOptions().setHost(host).setWsPort(port).setWssPort(port).setUseTLS(scheme=="https")`; bind event names exactly as in §4, no dot prefix) or a hand-rolled OkHttp `WebSocket` mirroring `messaging-realtime.js` (six frame types). Build the URL exactly as §2; Reverb ignores `client`/`version`/`flash`.
2. **Authorizer**: implement `com.pusher.client.util.Authorizer` (or the OkHttp equivalent) that POSTs JSON `{socket_id, channel_name}` to `{baseUrl}/broadcasting/auth` through the **same OkHttp client and CookieJar** as the REST layer, with `Accept: application/json`, `X-Requested-With: XMLHttpRequest`, and returns the raw body `{"auth":"..."}`. Treat 403 as "not allowed or signed out"; confirm with `GET /me` (401 → re-authenticate).
3. **Bootstrap**: read `me.realtime`; if `enabled` is false, run the poll fallbacks only. Restart the socket if `key` changes on a later `/me` (`notify-realtime.js:57-66`).
4. **Always-on subscriptions**: `private-App.Models.User.{id}` (`data.changed`, `notification.created`, `presence.status`), `private-messaging.user.{id}` (`messaging.inbox`, `call.signal`), and `private-portal.staff` only when `me.isStaff`. Subscribe per-conversation channels for every conversation in the inbox (the web subscribes all rows, `messages.js:5941-5943`), and per-file / per-feed-channel / per-CIP-application channels while that screen is open, leaving them on exit (`feed.js:4823-4825`, `portal-files.js:6088-6090`, `clients.js:8869-8877`).
5. **Store the `socket_id`** from `connection_established` and send it as `X-Socket-ID` on every write, including replays of the offline write queue (`portal-queue.js:290-296`).
6. **Reconnect**: jittered exponential backoff capped at 30 s; treat 4000-4099 as fatal and switch Messages to a 10 s poll; on every `connected` transition, re-auth all channels and run a full refetch (Live resources, notifications with `forceLoad`, conversations, open thread). Also refetch on app foreground and on network regain; nothing is replayed by the server.
7. **Presence**: post `/portal/messaging/heartbeat` every 30 s while the Messages/app UI is foreground; stop when backgrounded so the 45 s TTL lets the user go offline, matching the web.
8. **Debounce** `data.changed` by resource for 300 ms; refresh through the same authorised list endpoint; never expect rows in the payload.
9. **Background**: no push provider exists; the only way to hear a ring or a notification while backgrounded is to keep the socket alive (foreground service) or catch up on resume. Decide this explicitly; the web/desktop only guarantee delivery while a window holds a socket.

---

## Part B. Every route the backend registers

Generated from `php artisan route:list --json` on 6 Sep 2026 (620 routes; `design/*` and `dev/*` preview routes omitted). The base middleware on the portal group is `web, auth, verified, profile.complete, account.approved, onboarded, mfa.enforced`; the Middleware column lists only what differs from that base (`+capability:x`, `+throttle:...`, or the full list when the route is outside the group). Action is `Controller@method`; open it for the `validate()` rules and response keys.


### `auth/desktop` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/desktop/claim` | web, throttle:20,1 | `DesktopAuthController@claim` |
| GET | `/auth/desktop/finish` | web, auth | `DesktopAuthController@finish` |
| GET | `/auth/desktop/start` | web, throttle:20,1 | `DesktopAuthController@start` |

### `auth/email` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/email/confirm/{id}/{hash}` | web, signed, throttle:6,1 | `UnsignedVerifyEmailController` |
| POST | `/auth/email/verification-notification` | web, auth:web, throttle:6,1 | `Laravel\\Fortify\\Http\\Controllers\\EmailVerificationNotificationController@store` |
| GET | `/auth/email/verification-status` | web, auth | `EmailVerificationStatusController` |
| GET | `/auth/email/verify` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\EmailVerificationPromptController@__invoke` |
| GET | `/auth/email/verify/{id}/{hash}` | web, auth:web, signed, throttle:6,1 | `Laravel\\Fortify\\Http\\Controllers\\VerifyEmailController@__invoke` |

### `auth/forgot-password` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/forgot-password` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\PasswordResetLinkController@create` |
| POST | `/auth/forgot-password` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\PasswordResetLinkController@store` |

### `auth/getting-started` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/getting-started` | web, auth, verified, profile.complete, account.approved | `GettingStartedController@show` |
| POST | `/auth/getting-started` | web, auth, verified, profile.complete, account.approved | `GettingStartedController@finish` |

### `auth/login` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/login` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\AuthenticatedSessionController@create` |
| POST | `/auth/login` | web, guest:web, throttle:login | `Laravel\\Fortify\\Http\\Controllers\\AuthenticatedSessionController@store` |

### `auth/login-code` (4 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/login-code` | web, guest | `EmailTwoFactorController@show` |
| POST | `/auth/login-code` | web, guest, throttle:two-factor | `EmailTwoFactorController@store` |
| POST | `/auth/login-code/from-app` | web, guest | `EmailTwoFactorController@fromApp` |
| POST | `/auth/login-code/resend` | web, guest | `EmailTwoFactorController@resend` |

### `auth/logout` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/auth/logout` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\AuthenticatedSessionController@destroy` |

### `auth/pending` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/pending` | web, auth, verified | `closure in routes/web.php` |

### `auth/pending-status` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/pending-status` | web, auth, verified | `closure in routes/web.php` |

### `auth/profile-setup` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/profile-setup` | web, auth, verified | `ProfileSetupController@show` |
| POST | `/auth/profile-setup` | web, auth, verified | `ProfileSetupController@store` |

### `auth/register` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/register` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\RegisteredUserController@create` |
| POST | `/auth/register` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\RegisteredUserController@store` |

### `auth/reset-password` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/auth/reset-password` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\NewPasswordController@store` |
| GET | `/auth/reset-password/{token}` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\NewPasswordController@create` |

### `auth/role-pending` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/role-pending` | web, auth, verified | `closure in routes/web.php` |

### `auth/setup` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/setup/two-factor/qr` | web, auth, verified, account.approved | `AccountSetupController@twoFactorQr` |
| GET | `/auth/setup/two-factor/recovery-codes` | web, auth, verified, account.approved | `AccountSetupController@twoFactorRecoveryCodes` |
| GET | `/auth/setup/{step}` | web, auth, verified, account.approved | `AccountSetupController@show` |
| POST | `/auth/setup/{step}` | web, auth, verified, account.approved | `AccountSetupController@store` |
| POST | `/auth/setup/{step}/skip` | web, auth, verified, account.approved | `AccountSetupController@skip` |

### `auth/sign-in` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/auth/sign-in` | web | `Illuminate\\Routing\\RedirectController` |

### `auth/sign-up` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/auth/sign-up` | web | `Illuminate\\Routing\\RedirectController` |

### `auth/social` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/social/{provider}/callback` | web | `SocialAuthController@callback` |
| POST | `/auth/social/{provider}/disconnect` | web, auth, verified | `SocialAuthController@disconnect` |
| GET | `/auth/social/{provider}/redirect` | web | `SocialAuthController@redirect` |

### `auth/stay-signed-in` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/stay-signed-in` | web, auth | `StaySignedInController@show` |
| POST | `/auth/stay-signed-in` | web, auth | `StaySignedInController@store` |

### `auth/two-factor-challenge` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/two-factor-challenge` | web, guest:web | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorAuthenticatedSessionController@create` |
| POST | `/auth/two-factor-challenge` | web, guest:web, throttle:two-factor | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorAuthenticatedSessionController@store` |

### `auth/user` (12 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/auth/user/confirm-password` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\ConfirmablePasswordController@show` |
| POST | `/auth/user/confirm-password` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\ConfirmablePasswordController@store` |
| GET | `/auth/user/confirmed-password-status` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\ConfirmedPasswordStatusController@show` |
| POST | `/auth/user/confirmed-two-factor-authentication` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\ConfirmedTwoFactorAuthenticationController@store` |
| PUT | `/auth/user/password` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\PasswordController@update` |
| PUT | `/auth/user/profile-information` | web, auth:web | `Laravel\\Fortify\\Http\\Controllers\\ProfileInformationController@update` |
| POST | `/auth/user/two-factor-authentication` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorAuthenticationController@store` |
| DELETE | `/auth/user/two-factor-authentication` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorAuthenticationController@destroy` |
| GET | `/auth/user/two-factor-qr-code` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorQrCodeController@show` |
| GET | `/auth/user/two-factor-recovery-codes` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\RecoveryCodeController@index` |
| POST | `/auth/user/two-factor-recovery-codes` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\RecoveryCodeController@store` |
| GET | `/auth/user/two-factor-secret-key` | web, auth:web, password.confirm | `Laravel\\Fortify\\Http\\Controllers\\TwoFactorSecretKeyController@show` |

### `me` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/me` | base | `MeController@show` |

### `me/authenticator-nudge` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/me/authenticator-nudge` | base | `AuthenticatorNudgeController@shown` |

### `me/availability` (12 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/me/availability` | base | `AvailabilityController@show` |
| POST | `/me/availability/call` | base | `AvailabilityController@reportCall` |
| GET | `/me/availability/geocode` | base | `AvailabilityController@geocode` |
| POST | `/me/availability/location` | base | `AvailabilityController@reportLocation` |
| PUT | `/me/availability/locations` | base | `AvailabilityController@upsertLocation` |
| DELETE | `/me/availability/locations/{type}` | base | `AvailabilityController@deleteLocation` |
| PUT | `/me/availability/message` | base | `AvailabilityController@updateMessage` |
| GET | `/me/availability/reverse-geocode` | base | `AvailabilityController@reverseGeocode` |
| POST | `/me/availability/schedules` | base | `AvailabilityController@storeSchedule` |
| DELETE | `/me/availability/schedules/{id}` | base | `AvailabilityController@destroySchedule` |
| PUT | `/me/availability/status` | base | `AvailabilityController@updateStatus` |
| DELETE | `/me/availability/status` | base | `AvailabilityController@clearStatus` |

### `me/avatar` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/me/avatar` | base | `MeController@updateAvatar` |

### `me/onedrive` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/me/onedrive/pause` | base | `MeOneDriveController@pause` |
| POST | `/me/onedrive/resume` | base | `MeOneDriveController@resume` |

### `me/preferences` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/me/preferences` | base | `PreferencesController@show` |
| PUT | `/me/preferences` | base | `PreferencesController@update` |

### `me/profile` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/me/profile` | base | `MeController@profile` |

### `me/sync-status` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/me/sync-status` | base | `MeSyncStatusController@show` |

### `portal/activity` (4 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/activity` | base | `ActivityController@index` |
| GET | `/portal/activity/count` | base | `ActivityController@count` |
| GET | `/portal/activity/filters` | base | `ActivityController@filters` |
| POST | `/portal/activity/seen` | base | `ActivityController@markSeen` |

### `portal/admin` (4 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/admin/recycle-bin` | base | `AdminRecycleBinController@index` |
| POST | `/portal/admin/recycle-bin/empty` | base | `AdminRecycleBinController@empty` |
| DELETE | `/portal/admin/recycle-bin/{kind}/{id}` | base | `AdminRecycleBinController@purge` |
| POST | `/portal/admin/recycle-bin/{kind}/{id}/restore` | base | `AdminRecycleBinController@restore` |

### `portal/calendar` (41 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/calendar/availability` | base | `CalendarEventController@availability` |
| GET | `/portal/calendar/calendars` | base | `CalendarController@index` |
| POST | `/portal/calendar/calendars` | base | `CalendarController@store` |
| PATCH | `/portal/calendar/calendars/{uuid}` | base | `CalendarController@update` |
| DELETE | `/portal/calendar/calendars/{uuid}` | base | `CalendarController@destroy` |
| DELETE | `/portal/calendar/calendars/{uuid}/group-members/{groupUuid}` | base | `CalendarController@removeGroupMember` |
| GET | `/portal/calendar/calendars/{uuid}/history` | base | `CalendarController@history` |
| GET | `/portal/calendar/calendars/{uuid}/members` | base | `CalendarController@members` |
| POST | `/portal/calendar/calendars/{uuid}/members` | base | `CalendarController@addMember` |
| DELETE | `/portal/calendar/calendars/{uuid}/members/{userId}` | base | `CalendarController@removeMember` |
| POST | `/portal/calendar/calendars/{uuid}/subscribe` | base | `CalendarController@subscribe` |
| DELETE | `/portal/calendar/calendars/{uuid}/subscribe` | base | `CalendarController@unsubscribe` |
| PUT | `/portal/calendar/calendars/{uuid}/subscription` | base | `CalendarController@updateSubscription` |
| GET | `/portal/calendar/discover` | base | `CalendarController@discover` |
| GET | `/portal/calendar/events` | base | `CalendarEventController@index` |
| POST | `/portal/calendar/events` | base | `CalendarEventController@store` |
| GET | `/portal/calendar/events/{uuid}` | base | `CalendarEventController@show` |
| PATCH | `/portal/calendar/events/{uuid}` | base | `CalendarEventController@update` |
| DELETE | `/portal/calendar/events/{uuid}` | base | `CalendarEventController@destroy` |
| POST | `/portal/calendar/events/{uuid}/attendees` | base | `CalendarEventController@invite` |
| DELETE | `/portal/calendar/events/{uuid}/attendees/{attendeeId}` | base | `CalendarEventController@removeAttendee` |
| POST | `/portal/calendar/events/{uuid}/complete` | base | `CalendarEventController@complete` |
| POST | `/portal/calendar/events/{uuid}/resolve-conflict` | base | `CalendarSyncController@resolveConflict` |
| POST | `/portal/calendar/events/{uuid}/respond` | base | `CalendarEventController@respond` |
| GET | `/portal/calendar/ics/events/{uuid}/export` | base | `CalendarIcsController@exportEvent` |
| POST | `/portal/calendar/ics/import` | base | `CalendarIcsController@import` |
| POST | `/portal/calendar/ics/preview` | base | `CalendarIcsController@preview` |
| POST | `/portal/calendar/ics/subscribe` | base | `CalendarIcsController@subscribe` |
| PUT | `/portal/calendar/ics/{uuid}/enabled` | base | `CalendarIcsController@setEnabled` |
| GET | `/portal/calendar/ics/{uuid}/export` | base | `CalendarIcsController@export` |
| POST | `/portal/calendar/ics/{uuid}/refresh` | base | `CalendarIcsController@refresh` |
| GET | `/portal/calendar/sync/accounts` | base | `CalendarSyncController@accounts` |
| GET | `/portal/calendar/sync/accounts/{accountId}/calendars` | base | `CalendarSyncController@providerCalendars` |
| POST | `/portal/calendar/sync/accounts/{accountId}/connect` | base | `CalendarSyncController@connect` |
| POST | `/portal/calendar/sync/accounts/{accountId}/connect-all` | base | `CalendarSyncController@connectAll` |
| GET | `/portal/calendar/sync/accounts/{accountId}/status` | base | `CalendarSyncController@syncStatus` |
| GET | `/portal/calendar/sync/status` | base | `CalendarSyncController@syncStatus` |
| PUT | `/portal/calendar/sync/{uuid}` | base | `CalendarSyncController@updateSync` |
| DELETE | `/portal/calendar/sync/{uuid}` | base | `CalendarSyncController@disconnect` |
| GET | `/portal/calendar/sync/{uuid}/conflicts` | base | `CalendarSyncController@conflicts` |
| POST | `/portal/calendar/sync/{uuid}/run` | base | `CalendarSyncController@sync` |

### `portal/call-recordings` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/call-recordings` | base | `CallRecordingController@index` |
| POST | `/portal/call-recordings/{uuid}/hold` | base | `CallRecordingController@hold` |
| GET | `/portal/call-recordings/{uuid}/media` | base | `CallRecordingController@media` |

### `portal/cbi` (7 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/cbi/applications` | base | `Cbi\\CbiController@applications` |
| GET | `/portal/cbi/applications/{uuid}` | base | `Cbi\\CbiController@application` |
| POST | `/portal/cbi/applications/{uuid}/comments` | base | `Cbi\\CbiController@storeComment` |
| GET | `/portal/cbi/attachments/{attachment}` | base | `Cbi\\CbiController@downloadAttachment` |
| GET | `/portal/cbi/summary` | base | `Cbi\\CbiController@summary` |
| GET | `/portal/cbi/sync` | base | `Cbi\\CbiController@syncStatus` |
| POST | `/portal/cbi/sync` | base | `Cbi\\CbiController@triggerSync` |

### `portal/cip` (46 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/cip/applications` | base | `Cip\\CipApplicationController@index` |
| POST | `/portal/cip/applications` | base | `Cip\\CipApplicationController@store` |
| GET | `/portal/cip/applications/form` | base | `Cip\\CipApplicationController@form` |
| GET | `/portal/cip/applications/sync` | base | `Cip\\CipApplicationController@sync` |
| GET | `/portal/cip/applications/{uuid}` | base | `Cip\\CipApplicationController@show` |
| POST | `/portal/cip/applications/{uuid}` | base | `Cip\\CipApplicationController@update` |
| POST | `/portal/cip/applications/{uuid}/acceptance` | base | `Cip\\CipTransitionController@accept` |
| GET | `/portal/cip/applications/{uuid}/assignments` | base | `Cip\\CipAssignmentController@index` |
| POST | `/portal/cip/applications/{uuid}/assignments` | base | `Cip\\CipAssignmentController@store` |
| DELETE | `/portal/cip/applications/{uuid}/assignments/{userId}` | base | `Cip\\CipAssignmentController@destroy` |
| PATCH | `/portal/cip/applications/{uuid}/cip-number` | base | `Cip\\CipApplicationController@correctNumber` |
| POST | `/portal/cip/applications/{uuid}/confirm` | base | `Cip\\CipTransitionController@confirm` |
| POST | `/portal/cip/applications/{uuid}/decision` | base | `Cip\\CipTransitionController@decide` |
| GET | `/portal/cip/applications/{uuid}/events` | base | `Cip\\CipEventController@index` |
| GET | `/portal/cip/applications/{uuid}/messages` | base | `Cip\\CipThreadController@index` |
| POST | `/portal/cip/applications/{uuid}/messages` | base | `Cip\\CipThreadController@store` |
| PATCH | `/portal/cip/applications/{uuid}/milestones/{key}` | base | `Cip\\CipApplicationController@correctMilestone` |
| POST | `/portal/cip/applications/{uuid}/post-approval` | base | `Cip\\CipApplicationController@enterPostApproval` |
| POST | `/portal/cip/applications/{uuid}/query` | base | `Cip\\CipTransitionController@query` |
| POST | `/portal/cip/applications/{uuid}/stage` | base | `Cip\\CipTransitionController@stage` |
| POST | `/portal/cip/applications/{uuid}/status` | base | `Cip\\CipTransitionController@update` |
| POST | `/portal/cip/applications/{uuid}/submission` | base | `Cip\\CipApplicationController@submit` |
| POST | `/portal/cip/applications/{uuid}/submit` | base | `Cip\\CipTransitionController@submit` |
| GET | `/portal/cip/clients/{uid}/application` | base | `Cip\\CipApplicationController@forClient` |
| GET | `/portal/cip/dashboard` | base | `Cip\\CipDashboardController` |
| GET | `/portal/cip/distribution` | base | `Cip\\CipDistributionController@show` |
| PATCH | `/portal/cip/distribution` | base | `Cip\\CipDistributionController@update` |
| POST | `/portal/cip/documents/{uuid}/approve` | base | `Cip\\CipReviewController@approve` |
| GET | `/portal/cip/documents/{uuid}/comments` | base | `Cip\\CipDocumentCommentController@index` |
| POST | `/portal/cip/documents/{uuid}/comments` | base | `Cip\\CipDocumentCommentController@store` |
| PATCH | `/portal/cip/documents/{uuid}/comments/{commentUuid}` | base | `Cip\\CipDocumentCommentController@update` |
| DELETE | `/portal/cip/documents/{uuid}/comments/{commentUuid}` | base | `Cip\\CipDocumentCommentController@destroy` |
| POST | `/portal/cip/documents/{uuid}/comments/{commentUuid}/resolve` | base | `Cip\\CipDocumentCommentController@resolve` |
| POST | `/portal/cip/documents/{uuid}/file` | base | `Cip\\CipDocumentUploadController@store` |
| POST | `/portal/cip/documents/{uuid}/request-changes` | base | `Cip\\CipReviewController@requestChanges` |
| GET | `/portal/cip/letters` | base | `Cip\\CipLetterController@index` |
| PATCH | `/portal/cip/letters/{uuid}` | base | `Cip\\CipLetterController@update` |
| POST | `/portal/cip/letters/{uuid}/restore` | base | `Cip\\CipLetterController@restore` |
| GET | `/portal/cip/people/{uuid}/passport-photo` | base | `Cip\\CipApplicationController@passportPhoto` |
| POST | `/portal/cip/people/{uuid}/status` | base | `Cip\\CipPersonStatusController@update` |
| GET | `/portal/cip/requirements` | base | `Cip\\CipRequirementController@index` |
| POST | `/portal/cip/requirements` | base | `Cip\\CipRequirementController@store` |
| POST | `/portal/cip/requirements/reorder` | base | `Cip\\CipRequirementController@reorder` |
| PATCH | `/portal/cip/requirements/{uuid}` | base | `Cip\\CipRequirementController@update` |
| DELETE | `/portal/cip/requirements/{uuid}` | base | `Cip\\CipRequirementController@destroy` |
| POST | `/portal/cip/requirements/{uuid}/restore` | base | `Cip\\CipRequirementController@restore` |

### `portal/clients` (21 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/clients` | base | `ClientsController@index` |
| POST | `/portal/clients` | base | `ClientsController@store` |
| GET | `/portal/clients/assigned-to-me` | base | `ClientAssignmentController@mine` |
| POST | `/portal/clients/bulk-delete` | base | `ClientsController@bulkDestroy` |
| GET | `/portal/clients/preview` | base | `ClientsController@preview` |
| GET | `/portal/clients/search` | base | `ClientsController@search` |
| GET | `/portal/clients/sync` | base | `ClientsController@sync` |
| GET | `/portal/clients/{uid}` | base | `ClientsController@show` |
| PATCH | `/portal/clients/{uid}` | base | `ClientsController@update` |
| DELETE | `/portal/clients/{uid}` | base | `ClientsController@destroy` |
| GET | `/portal/clients/{uid}/access` | base | `ClientInviteController@access` |
| GET | `/portal/clients/{uid}/assignments` | base | `ClientAssignmentController@index` |
| POST | `/portal/clients/{uid}/assignments` | base | `ClientAssignmentController@store` |
| PATCH | `/portal/clients/{uid}/assignments/{userId}` | base | `ClientAssignmentController@update` |
| DELETE | `/portal/clients/{uid}/assignments/{userId}` | base | `ClientAssignmentController@destroy` |
| POST | `/portal/clients/{uid}/assignments/{userId}/reassign` | base | `ClientAssignmentController@reassign` |
| GET | `/portal/clients/{uid}/conversations` | base | `ClientConversationController@index` |
| POST | `/portal/clients/{uid}/conversations` | base | `ClientConversationController@store` |
| POST | `/portal/clients/{uid}/duplicate` | base | `ClientsController@duplicate` |
| POST | `/portal/clients/{uid}/invite` | base | `ClientInviteController@send` |
| GET | `/portal/clients/{uid}/invite` | base | `ClientInviteController@status` |

### `portal/companies` (14 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/companies` | base | `CompaniesController@index` |
| POST | `/portal/companies` | base | `CompaniesController@store` |
| GET | `/portal/companies/{uid}` | base | `CompaniesController@show` |
| PATCH | `/portal/companies/{uid}` | base | `CompaniesController@update` |
| DELETE | `/portal/companies/{uid}` | base | `CompaniesController@destroy` |
| GET | `/portal/companies/{uid}/members` | base | `CompanyMemberController@index` |
| POST | `/portal/companies/{uid}/members` | base | `CompanyMemberController@store` |
| PATCH | `/portal/companies/{uid}/members/{member}` | base | `CompanyMemberController@update` |
| DELETE | `/portal/companies/{uid}/members/{member}` | base | `CompanyMemberController@destroy` |
| POST | `/portal/companies/{uid}/members/{member}/invite` | base | `CompanyMemberController@invite` |
| GET | `/portal/companies/{uid}/staff` | base | `CompanyStaffController@index` |
| POST | `/portal/companies/{uid}/staff` | base | `CompanyStaffController@store` |
| POST | `/portal/companies/{uid}/staff/preview` | base | `CompanyStaffController@preview` |
| DELETE | `/portal/companies/{uid}/staff/{userId}` | base | `CompanyStaffController@destroy` |

### `portal/contacts` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/contacts` | base | `ContactsController@index` |
| POST | `/portal/contacts` | base | `ContactsController@store` |
| POST | `/portal/contacts/bulk-delete` | base | `ContactsController@bulkDestroy` |
| PATCH | `/portal/contacts/{uuid}` | base | `ContactsController@update` |
| DELETE | `/portal/contacts/{uuid}` | base | `ContactsController@destroy` |

### `portal/dashboard` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/dashboard/metrics` | base | `DashboardMetricsController` |
| GET | `/portal/dashboard/staff` | base | `StaffPresenceController` |
| GET | `/portal/dashboard/work` | base | `DashboardWorkController` |

### `portal/feed` (49 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/feed/analytics` | +capability:feed.view | `Feed\\FeedAnalyticsController` |
| DELETE | `/portal/feed/attachments/{uuid}` | +capability:feed.view | `Feed\\FeedAttachmentController@destroy` |
| GET | `/portal/feed/attachments/{uuid}` | +capability:feed.view | `Feed\\FeedAttachmentController@show` |
| GET | `/portal/feed/attachments/{uuid}/thumb` | +capability:feed.view | `Feed\\FeedAttachmentController@thumb` |
| GET | `/portal/feed/channels` | +capability:feed.view | `Feed\\FeedChannelController@index` |
| POST | `/portal/feed/channels` | +capability:feed.view | `Feed\\FeedChannelController@store` |
| GET | `/portal/feed/channels/{uuid}` | +capability:feed.view | `Feed\\FeedChannelController@show` |
| PATCH | `/portal/feed/channels/{uuid}` | +capability:feed.view | `Feed\\FeedChannelController@update` |
| DELETE | `/portal/feed/channels/{uuid}` | +capability:feed.view | `Feed\\FeedChannelController@destroy` |
| POST | `/portal/feed/channels/{uuid}/archive` | +capability:feed.view | `Feed\\FeedChannelController@archive` |
| POST | `/portal/feed/channels/{uuid}/attachments` | +capability:feed.view | `Feed\\FeedAttachmentController@store` |
| POST | `/portal/feed/channels/{uuid}/image/{which}` | +capability:feed.view | `Feed\\FeedChannelController@updateImage` |
| GET | `/portal/feed/channels/{uuid}/image/{which}` | +capability:feed.view | `Feed\\FeedChannelController@image` |
| POST | `/portal/feed/channels/{uuid}/join` | +capability:feed.view | `Feed\\FeedChannelController@join` |
| POST | `/portal/feed/channels/{uuid}/leave` | +capability:feed.view | `Feed\\FeedChannelController@leave` |
| GET | `/portal/feed/channels/{uuid}/members` | +capability:feed.view | `Feed\\FeedChannelController@members` |
| POST | `/portal/feed/channels/{uuid}/members` | +capability:feed.view | `Feed\\FeedChannelController@addMembersRequest` |
| PATCH | `/portal/feed/channels/{uuid}/members/{userId}` | +capability:feed.view | `Feed\\FeedChannelController@updateMember` |
| DELETE | `/portal/feed/channels/{uuid}/members/{userId}` | +capability:feed.view | `Feed\\FeedChannelController@removeMember` |
| PATCH | `/portal/feed/channels/{uuid}/membership` | +capability:feed.view | `Feed\\FeedChannelController@updateMyMembership` |
| POST | `/portal/feed/channels/{uuid}/read` | +capability:feed.view | `Feed\\FeedChannelController@markRead` |
| POST | `/portal/feed/channels/{uuid}/restore` | +capability:feed.view | `Feed\\FeedChannelController@restore` |
| PATCH | `/portal/feed/comments/{uuid}` | +capability:feed.view | `Feed\\FeedCommentController@update` |
| DELETE | `/portal/feed/comments/{uuid}` | +capability:feed.view | `Feed\\FeedCommentController@destroy` |
| POST | `/portal/feed/comments/{uuid}/reactions` | +capability:feed.view | `Feed\\FeedReactionController@comment` |
| GET | `/portal/feed/hashtags` | +capability:feed.view | `Feed\\FeedSearchController@hashtagSuggestions` |
| GET | `/portal/feed/mentionable` | +capability:feed.view | `Feed\\FeedSearchController@mentionable` |
| GET | `/portal/feed/posts` | +capability:feed.view | `Feed\\FeedPostController@index` |
| POST | `/portal/feed/posts` | +capability:feed.view | `Feed\\FeedPostController@store` |
| GET | `/portal/feed/posts/{uuid}` | +capability:feed.view | `Feed\\FeedPostController@show` |
| PATCH | `/portal/feed/posts/{uuid}` | +capability:feed.view | `Feed\\FeedPostController@update` |
| DELETE | `/portal/feed/posts/{uuid}` | +capability:feed.view | `Feed\\FeedPostController@destroy` |
| POST | `/portal/feed/posts/{uuid}/acknowledge` | +capability:feed.view | `Feed\\FeedPostController@acknowledge` |
| GET | `/portal/feed/posts/{uuid}/acknowledgements` | +capability:feed.view | `Feed\\FeedPostController@acknowledgements` |
| PUT | `/portal/feed/posts/{uuid}/autosave` | +capability:feed.view | `Feed\\FeedPostController@autosave` |
| POST | `/portal/feed/posts/{uuid}/bookmark` | +capability:feed.view | `Feed\\FeedPostController@toggleBookmark` |
| GET | `/portal/feed/posts/{uuid}/comments` | +capability:feed.view | `Feed\\FeedCommentController@index` |
| POST | `/portal/feed/posts/{uuid}/comments` | +capability:feed.view | `Feed\\FeedCommentController@store` |
| POST | `/portal/feed/posts/{uuid}/duplicate` | +capability:feed.view | `Feed\\FeedPostController@duplicate` |
| POST | `/portal/feed/posts/{uuid}/lock` | +capability:feed.view | `Feed\\FeedPostController@toggleLock` |
| POST | `/portal/feed/posts/{uuid}/pin` | +capability:feed.view | `Feed\\FeedPostController@togglePin` |
| POST | `/portal/feed/posts/{uuid}/poll/close` | +capability:feed.view | `Feed\\FeedPollController@close` |
| POST | `/portal/feed/posts/{uuid}/poll/vote` | +capability:feed.view | `Feed\\FeedPollController@vote` |
| GET | `/portal/feed/posts/{uuid}/poll/voters` | +capability:feed.view | `Feed\\FeedPollController@voters` |
| POST | `/portal/feed/posts/{uuid}/publish` | +capability:feed.view | `Feed\\FeedPostController@publish` |
| POST | `/portal/feed/posts/{uuid}/reactions` | +capability:feed.view | `Feed\\FeedReactionController@post` |
| GET | `/portal/feed/posts/{uuid}/reactions` | +capability:feed.view | `Feed\\FeedReactionController@people` |
| POST | `/portal/feed/posts/{uuid}/share` | +capability:feed.view | `Feed\\FeedPostController@share` |
| GET | `/portal/feed/search` | +capability:feed.view | `Feed\\FeedSearchController` |

### `portal/file-library` (10 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/portal/file-library/adopt-folder` | base | `FileLibraryController@adoptFolder` |
| GET | `/portal/file-library/folder-templates` | base | `FileLibraryController@templates` |
| POST | `/portal/file-library/folder-templates` | base | `FileLibraryController@storeTemplate` |
| PUT | `/portal/file-library/folder-templates/{id}` | base | `FileLibraryController@updateTemplate` |
| DELETE | `/portal/file-library/folder-templates/{id}` | base | `FileLibraryController@destroyTemplate` |
| POST | `/portal/file-library/folder-templates/{id}/apply` | base | `FileLibraryController@applyTemplate` |
| POST | `/portal/file-library/organization-folders` | base | `FileLibraryController@storeOrganizationFolder` |
| PATCH | `/portal/file-library/organization-folders/{uuid}` | base | `FileLibraryController@updateOrganizationFolder` |
| GET | `/portal/file-library/settings` | base | `FileLibraryController@show` |
| PUT | `/portal/file-library/settings` | base | `FileLibraryController@updateSettings` |

### `portal/files` (80 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/files` | base | `Files\\BrowserController@index` |
| POST | `/portal/files/bulk` | base | `Files\\BulkController@handle` |
| POST | `/portal/files/favorites/toggle` | base | `Files\\FavoriteController@toggle` |
| POST | `/portal/files/files` | base | `Files\\FileController@store` |
| GET | `/portal/files/files/{uuid}` | base | `Files\\FileController@show` |
| PATCH | `/portal/files/files/{uuid}` | base | `Files\\FileController@update` |
| DELETE | `/portal/files/files/{uuid}` | base | `Files\\FileController@destroy` |
| GET | `/portal/files/files/{uuid}/access` | base | `Files\\FileViewerController@access` |
| GET | `/portal/files/files/{uuid}/activity` | base | `Files\\FileViewerController@activity` |
| GET | `/portal/files/files/{uuid}/comments` | base | `Files\\FileCommentController@index` |
| POST | `/portal/files/files/{uuid}/comments` | base | `Files\\FileCommentController@store` |
| PATCH | `/portal/files/files/{uuid}/comments/{comment}` | base | `Files\\FileCommentController@update` |
| DELETE | `/portal/files/files/{uuid}/comments/{comment}` | base | `Files\\FileCommentController@destroy` |
| POST | `/portal/files/files/{uuid}/comments/{comment}/resolve` | base | `Files\\FileCommentController@resolve` |
| POST | `/portal/files/files/{uuid}/copy` | base | `Files\\FileController@copy` |
| GET | `/portal/files/files/{uuid}/details` | base | `Files\\FileViewerController@details` |
| GET | `/portal/files/files/{uuid}/download` | base | `Files\\FileController@download` |
| DELETE | `/portal/files/files/{uuid}/force` | base | `Files\\FileController@forceDelete` |
| GET | `/portal/files/files/{uuid}/mentionable` | base | `Files\\FileCommentController@mentionable` |
| POST | `/portal/files/files/{uuid}/move` | base | `Files\\FileController@move` |
| GET | `/portal/files/files/{uuid}/presence` | base | `Files\\FilePresenceController@index` |
| POST | `/portal/files/files/{uuid}/presence` | base | `Files\\FilePresenceController@store` |
| DELETE | `/portal/files/files/{uuid}/presence` | base | `Files\\FilePresenceController@destroy` |
| GET | `/portal/files/files/{uuid}/preview` | base | `Files\\FileController@preview` |
| POST | `/portal/files/files/{uuid}/restore` | base | `Files\\FileController@restore` |
| PATCH | `/portal/files/files/{uuid}/review` | base | `Files\\FileReviewController@update` |
| GET | `/portal/files/files/{uuid}/thumb` | base | `Files\\ThumbnailController@show` |
| GET | `/portal/files/files/{uuid}/versions` | base | `Files\\FileVersionController@index` |
| POST | `/portal/files/files/{uuid}/versions` | base | `Files\\FileVersionController@store` |
| PATCH | `/portal/files/files/{uuid}/versions/{version}` | base | `Files\\FileVersionController@update` |
| GET | `/portal/files/files/{uuid}/versions/{version}/download` | base | `Files\\FileVersionController@download` |
| GET | `/portal/files/files/{uuid}/versions/{version}/preview` | base | `Files\\FileVersionController@preview` |
| POST | `/portal/files/files/{uuid}/versions/{version}/restore` | base | `Files\\FileVersionController@restore` |
| GET | `/portal/files/files/{uuid}/workflows` | base | `Files\\FileWorkflowController@index` |
| POST | `/portal/files/files/{uuid}/workflows` | base | `Files\\FileWorkflowController@store` |
| POST | `/portal/files/files/{uuid}/workflows/{workflow}/cancel` | base | `Files\\FileWorkflowController@cancel` |
| POST | `/portal/files/files/{uuid}/workflows/{workflow}/delegate` | base | `Files\\FileWorkflowController@delegate` |
| GET | `/portal/files/files/{uuid}/workflows/{workflow}/history` | base | `Files\\FileWorkflowController@history` |
| POST | `/portal/files/files/{uuid}/workflows/{workflow}/respond` | base | `Files\\FileWorkflowController@respond` |
| POST | `/portal/files/folders` | base | `Files\\FolderController@store` |
| GET | `/portal/files/folders/{uuid}` | base | `Files\\FolderController@show` |
| PATCH | `/portal/files/folders/{uuid}` | base | `Files\\FolderController@update` |
| DELETE | `/portal/files/folders/{uuid}` | base | `Files\\FolderController@destroy` |
| PATCH | `/portal/files/folders/{uuid}/colour` | base | `Files\\FolderController@colour` |
| POST | `/portal/files/folders/{uuid}/copy` | base | `Files\\FolderController@copy` |
| GET | `/portal/files/folders/{uuid}/download` | base | `Files\\FolderController@download` |
| DELETE | `/portal/files/folders/{uuid}/force` | base | `Files\\FolderController@forceDelete` |
| PATCH | `/portal/files/folders/{uuid}/icon` | base | `Files\\FolderController@icon` |
| POST | `/portal/files/folders/{uuid}/move` | base | `Files\\FolderController@move` |
| POST | `/portal/files/folders/{uuid}/restore` | base | `Files\\FolderController@restore` |
| POST | `/portal/files/recycle-bin/empty` | base | `Files\\RecycleBinController@empty` |
| GET | `/portal/files/requests` | base | `Files\\FileRequestController@index` |
| POST | `/portal/files/requests` | base | `Files\\FileRequestController@store` |
| GET | `/portal/files/requests/{uuid}` | base | `Files\\FileRequestController@show` |
| PATCH | `/portal/files/requests/{uuid}` | base | `Files\\FileRequestController@update` |
| DELETE | `/portal/files/requests/{uuid}` | base | `Files\\FileRequestController@destroy` |
| POST | `/portal/files/requests/{uuid}/send` | base | `Files\\FileRequestController@send` |
| GET | `/portal/files/shares` | base | `Files\\ShareController@index` |
| POST | `/portal/files/shares` | base | `Files\\ShareController@store` |
| GET | `/portal/files/shares/people` | base | `Files\\ShareController@people` |
| PATCH | `/portal/files/shares/{uuid}` | base | `Files\\ShareController@update` |
| DELETE | `/portal/files/shares/{uuid}` | base | `Files\\ShareController@destroy` |
| GET | `/portal/files/shortcuts` | base | `Files\\ShortcutController@index` |
| POST | `/portal/files/shortcuts` | base | `Files\\ShortcutController@store` |
| PUT | `/portal/files/shortcuts/reorder` | base | `Files\\ShortcutController@reorder` |
| DELETE | `/portal/files/shortcuts/{uuid}` | base | `Files\\ShortcutController@destroy` |
| GET | `/portal/files/sync` | base | `Files\\SyncController@index` |
| GET | `/portal/files/sync-status` | base | `Files\\SyncStatusController` |
| POST | `/portal/files/sync-status/pull` | base | `Files\\SyncStatusController@pull` |
| POST | `/portal/files/sync-status/retry` | base | `Files\\SyncStatusController@retry` |
| POST | `/portal/files/uploads` | base | `Files\\UploadController@init` |
| DELETE | `/portal/files/uploads/{uuid}` | base | `Files\\UploadController@abort` |
| POST | `/portal/files/uploads/{uuid}/chunk` | base | `Files\\UploadController@chunk` |
| POST | `/portal/files/uploads/{uuid}/complete` | base | `Files\\UploadController@complete` |
| GET | `/portal/files/uploads/{uuid}/status` | base | `Files\\UploadController@status` |
| GET | `/portal/files/workflows` | base | `Files\\WorkflowHubController@index` |
| GET | `/portal/files/workflows/comments` | base | `Files\\WorkflowHubController@comments` |
| POST | `/portal/files/workflows/comments/{comment}/read` | base | `Files\\WorkflowHubController@read` |
| GET | `/portal/files/workflows/counts` | base | `Files\\WorkflowHubController@counts` |
| GET | `/portal/files/workflows/updates` | base | `Files\\WorkflowHubController@updates` |

### `portal/groups` (8 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/groups` | base | `GroupsController@index` |
| POST | `/portal/groups` | base | `GroupsController@store` |
| GET | `/portal/groups/staff` | base | `GroupsController@staff` |
| PATCH | `/portal/groups/{uuid}` | base | `GroupsController@update` |
| DELETE | `/portal/groups/{uuid}` | base | `GroupsController@destroy` |
| GET | `/portal/groups/{uuid}/members` | base | `GroupsController@members` |
| POST | `/portal/groups/{uuid}/members` | base | `GroupsController@addMembers` |
| DELETE | `/portal/groups/{uuid}/members/{userId}` | base | `GroupsController@removeMember` |

### `portal/invitations` (8 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/invitations` | base | `InvitationController@index` |
| POST | `/portal/invitations` | base | `InvitationController@store` |
| GET | `/portal/invitations/{uuid}` | base | `InvitationController@show` |
| DELETE | `/portal/invitations/{uuid}` | base | `InvitationController@destroy` |
| POST | `/portal/invitations/{uuid}/cancel` | base | `InvitationController@cancel` |
| POST | `/portal/invitations/{uuid}/link` | base | `InvitationController@link` |
| PATCH | `/portal/invitations/{uuid}/recipient` | base | `InvitationController@updateRecipient` |
| POST | `/portal/invitations/{uuid}/resend` | base | `InvitationController@resend` |

### `portal/mail` (32 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/mail` | +capability:mail.use | `MailController@index` |
| GET | `/portal/mail/attachments/{uuid}` | +capability:mail.use | `MailController@attachment` |
| POST | `/portal/mail/bulk` | +capability:mail.use | `MailController@bulk` |
| GET | `/portal/mail/drafts` | +capability:mail.use | `MailController@drafts` |
| POST | `/portal/mail/drafts` | +capability:mail.use | `MailController@saveDraft` |
| DELETE | `/portal/mail/drafts/{uuid}` | +capability:mail.use | `MailController@deleteDraft` |
| POST | `/portal/mail/hydrate-attachments` | +capability:mail.use | `MailController@hydrateAttachments` |
| POST | `/portal/mail/labels` | +capability:mail.use | `MailController@createLabel` |
| PATCH | `/portal/mail/labels/{uuid}` | +capability:mail.use | `MailController@updateLabel` |
| DELETE | `/portal/mail/labels/{uuid}` | +capability:mail.use | `MailController@deleteLabel` |
| GET | `/portal/mail/messages` | +capability:mail.use | `MailController@messages` |
| GET | `/portal/mail/messages/{uuid}` | +capability:mail.use | `MailController@show` |
| PATCH | `/portal/mail/messages/{uuid}` | +capability:mail.use | `MailController@update` |
| DELETE | `/portal/mail/messages/{uuid}` | +capability:mail.use | `MailController@destroy` |
| POST | `/portal/mail/messages/{uuid}/continue` | +capability:mail.use | `MailController@continueDraft` |
| GET | `/portal/mail/messages/{uuid}/conversation` | +capability:mail.use | `MailController@conversation` |
| POST | `/portal/mail/messages/{uuid}/labels` | +capability:mail.use | `MailController@setLabel` |
| POST | `/portal/mail/messages/{uuid}/move` | +capability:mail.use | `MailController@move` |
| GET | `/portal/mail/messages/{uuid}/thread` | +capability:mail.use | `MailController@thread` |
| POST | `/portal/mail/send` | +capability:mail.use | `MailController@send` |
| GET | `/portal/mail/sender-photo/{hash}` | +capability:mail.use | `MailController@senderPhoto` |
| GET | `/portal/mail/settings` | +capability:mail.use | `MailController@settings` |
| PUT | `/portal/mail/settings` | +capability:mail.use | `MailController@updateSettings` |
| POST | `/portal/mail/settings/import-signature` | +capability:mail.use | `MailController@importSignature` |
| POST | `/portal/mail/settings/import-signature/apply` | +capability:mail.use | `MailController@applyImportedSignature` |
| POST | `/portal/mail/sign-out` | +capability:mail.use | `MailController@signOut` |
| GET | `/portal/mail/suggest` | +capability:mail.use | `MailController@suggest` |
| POST | `/portal/mail/sync` | +capability:mail.use | `MailController@sync` |
| GET | `/portal/mail/sync-status` | +capability:mail.use | `MailController@syncStatus` |
| POST | `/portal/mail/sync/retry` | +capability:mail.use | `MailController@retrySync` |
| GET | `/portal/mail/templates` | +capability:mail.use | `MailController@composeTemplates` |
| GET | `/portal/mail/window/{uuid}` | +capability:mail.use | `MailController@window` |

### `portal/messaging` (48 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| DELETE | `/portal/messaging/attachments/{uuid}` | base | `MessagingController@destroyStagedAttachment` |
| GET | `/portal/messaging/attachments/{uuid}` | base | `MessagingAttachmentController@show` |
| GET | `/portal/messaging/attachments/{uuid}/thumb` | base | `MessagingAttachmentController@thumb` |
| GET | `/portal/messaging/calls` | base | `MessagingController@calls` |
| GET | `/portal/messaging/contacts` | base | `MessagingController@contacts` |
| GET | `/portal/messaging/conversations` | base | `MessagingController@index` |
| POST | `/portal/messaging/conversations` | base | `MessagingController@store` |
| DELETE | `/portal/messaging/conversations/{uuid}` | base | `MessagingController@destroyConversation` |
| PATCH | `/portal/messaging/conversations/{uuid}` | base | `MessagingController@updateConversation` |
| POST | `/portal/messaging/conversations/{uuid}/attachments` | base | `MessagingController@uploadAttachment` |
| POST | `/portal/messaging/conversations/{uuid}/block` | base | `MessagingController@block` |
| POST | `/portal/messaging/conversations/{uuid}/call` | base | `MessagingController@callSignal` |
| POST | `/portal/messaging/conversations/{uuid}/clear` | base | `MessagingController@clearChat` |
| POST | `/portal/messaging/conversations/{uuid}/delivered` | base | `MessagingController@markDelivered` |
| PUT | `/portal/messaging/conversations/{uuid}/draft` | base | `MessagingController@saveDraft` |
| GET | `/portal/messaging/conversations/{uuid}/export` | base | `MessagingController@export` |
| GET | `/portal/messaging/conversations/{uuid}/gallery` | base | `MessagingController@gallery` |
| GET | `/portal/messaging/conversations/{uuid}/info` | base | `MessagingController@info` |
| GET | `/portal/messaging/conversations/{uuid}/messages` | base | `MessagingController@messages` |
| POST | `/portal/messaging/conversations/{uuid}/messages` | base | `MessagingController@send` |
| GET | `/portal/messaging/conversations/{uuid}/photo` | base | `MessagingAttachmentController@conversationPhoto` |
| POST | `/portal/messaging/conversations/{uuid}/read` | base | `MessagingController@markRead` |
| POST | `/portal/messaging/conversations/{uuid}/recordings` | base | `CallRecordingController@start` |
| POST | `/portal/messaging/conversations/{uuid}/typing` | base | `MessagingController@typing` |
| POST | `/portal/messaging/conversations/{uuid}/unblock` | base | `MessagingController@unblock` |
| POST | `/portal/messaging/conversations/{uuid}/unread` | base | `MessagingController@markUnread` |
| POST | `/portal/messaging/delivered` | base | `MessagingController@markAllDelivered` |
| POST | `/portal/messaging/groups` | base | `MessagingGroupController@store` |
| PATCH | `/portal/messaging/groups/{uuid}` | base | `MessagingGroupController@update` |
| POST | `/portal/messaging/groups/{uuid}/members` | base | `MessagingGroupController@addMembers` |
| PATCH | `/portal/messaging/groups/{uuid}/members/{userId}` | base | `MessagingGroupController@updateMember` |
| DELETE | `/portal/messaging/groups/{uuid}/members/{userId}` | base | `MessagingGroupController@removeMember` |
| POST | `/portal/messaging/groups/{uuid}/photo` | base | `MessagingGroupController@updatePhoto` |
| POST | `/portal/messaging/heartbeat` | base | `MessagingController@heartbeat` |
| GET | `/portal/messaging/link-preview` | base | `MessagingController@linkPreview` |
| GET | `/portal/messaging/media` | base | `MessagingController@media` |
| PATCH | `/portal/messaging/messages/{uuid}` | base | `MessagingController@updateMessage` |
| DELETE | `/portal/messaging/messages/{uuid}` | base | `MessagingController@destroyMessage` |
| POST | `/portal/messaging/messages/{uuid}/forward` | base | `MessagingController@forwardMessage` |
| POST | `/portal/messaging/messages/{uuid}/reactions` | base | `MessagingController@react` |
| POST | `/portal/messaging/messages/{uuid}/star` | base | `MessagingController@toggleStar` |
| POST | `/portal/messaging/recordings/{uuid}/chunks` | base | `CallRecordingController@chunk` |
| POST | `/portal/messaging/recordings/{uuid}/finish` | base | `CallRecordingController@finish` |
| GET | `/portal/messaging/search` | base | `MessagingController@search` |
| GET | `/portal/messaging/settings` | base | `MessagingController@settings` |
| PUT | `/portal/messaging/settings` | base | `MessagingController@updateSettings` |
| GET | `/portal/messaging/tab-counts` | base | `MessagingController@tabCounts` |
| POST | `/portal/messaging/tab-counts/seen` | base | `MessagingController@markTabSeen` |

### `portal/notifications` (10 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/notifications` | base | `NotificationController@index` |
| POST | `/portal/notifications/bulk` | base | `NotificationController@bulk` |
| GET | `/portal/notifications/count` | base | `NotificationController@count` |
| GET | `/portal/notifications/preferences` | base | `NotificationController@preferences` |
| PUT | `/portal/notifications/preferences` | base | `NotificationController@updatePreferences` |
| POST | `/portal/notifications/read-all` | base | `NotificationController@readAll` |
| DELETE | `/portal/notifications/{uid}` | base | `NotificationController@destroy` |
| POST | `/portal/notifications/{uid}/complete` | base | `NotificationController@complete` |
| POST | `/portal/notifications/{uid}/read` | base | `NotificationController@read` |
| POST | `/portal/notifications/{uid}/unread` | base | `NotificationController@unread` |

### `portal/people` (7 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/people/client-contacts` | base | `PeopleController@clientContacts` |
| GET | `/portal/people/employees` | base | `PeopleController@employees` |
| GET | `/portal/people/prospects` | base | `PeopleController@prospects` |
| DELETE | `/portal/people/prospects/{ref}` | base | `PeopleController@destroyProspect` |
| GET | `/portal/people/summary` | base | `PeopleController@summary` |
| POST | `/portal/people/welcome` | base | `PeopleController@sendWelcome` |
| GET | `/portal/people/welcome-candidates` | base | `PeopleController@welcomeCandidates` |

### `portal/sign-ins` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/sign-ins` | base | `SignInActivityController` |

### `portal/signatures` (14 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/signatures` | base | `Signatures\\SignatureRequestController@index` |
| POST | `/portal/signatures` | base | `Signatures\\SignatureRequestController@store` |
| GET | `/portal/signatures/documents` | base | `Signatures\\SignatureRequestController@documents` |
| GET | `/portal/signatures/people` | base | `Signatures\\SignatureRequestController@people` |
| GET | `/portal/signatures/{uuid}` | base | `Signatures\\SignatureRequestController@show` |
| PATCH | `/portal/signatures/{uuid}` | base | `Signatures\\SignatureRequestController@update` |
| DELETE | `/portal/signatures/{uuid}` | base | `Signatures\\SignatureRequestController@destroy` |
| POST | `/portal/signatures/{uuid}/cancel` | base | `Signatures\\SignatureRequestController@cancel` |
| GET | `/portal/signatures/{uuid}/document` | base | `Signatures\\SignatureFieldController@document` |
| GET | `/portal/signatures/{uuid}/fields` | base | `Signatures\\SignatureFieldController@index` |
| PUT | `/portal/signatures/{uuid}/fields` | base | `Signatures\\SignatureFieldController@store` |
| GET | `/portal/signatures/{uuid}/links` | base | `Signatures\\SignatureRequestController@links` |
| POST | `/portal/signatures/{uuid}/remind` | base | `Signatures\\SignatureRequestController@remind` |
| POST | `/portal/signatures/{uuid}/send` | base | `Signatures\\SignatureRequestController@send` |

### `portal/templates` (9 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/portal/templates/email-templates` | +capability:templates.email | `TemplatesController@emailIndex` |
| POST | `/portal/templates/email-templates` | +capability:templates.email | `TemplatesController@emailStore` |
| POST | `/portal/templates/email-templates/preview` | +capability:templates.email | `TemplatesController@emailPreview` |
| PATCH | `/portal/templates/email-templates/{uuid}` | +capability:templates.email | `TemplatesController@emailUpdate` |
| DELETE | `/portal/templates/email-templates/{uuid}` | +capability:templates.email | `TemplatesController@emailDestroy` |
| GET | `/portal/templates/system-emails` | +capability:templates.view | `TemplatesController@index` |
| PATCH | `/portal/templates/system-emails/{key}` | +capability:templates.view | `TemplatesController@update` |
| POST | `/portal/templates/system-emails/{key}/preview` | +capability:templates.view | `TemplatesController@preview` |
| POST | `/portal/templates/system-emails/{key}/restore` | +capability:templates.view | `TemplatesController@restore` |

### `admin/background-ops` (6 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/background-ops` | base | `BackgroundOperationsController@index` |
| POST | `/admin/background-ops/flush` | base | `BackgroundOperationsController@flush` |
| PUT | `/admin/background-ops/imports-pause` | base | `BackgroundOperationsController@pauseImports` |
| POST | `/admin/background-ops/imports-run` | base | `BackgroundOperationsController@runImport` |
| POST | `/admin/background-ops/libraries` | base | `BackgroundOperationsController@connectLibrary` |
| POST | `/admin/background-ops/retry` | base | `BackgroundOperationsController@retry` |

### `admin/branding` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/branding` | base | `BrandingController@show` |
| PUT | `/admin/branding` | base | `BrandingController@update` |
| POST | `/admin/branding/logo` | base | `BrandingController@uploadLogo` |
| DELETE | `/admin/branding/logo` | base | `BrandingController@destroyLogo` |
| POST | `/admin/branding/reset` | base | `BrandingController@reset` |

### `admin/client-fields` (4 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/client-fields` | base | `ClientCustomFieldsController@index` |
| POST | `/admin/client-fields` | base | `ClientCustomFieldsController@store` |
| PUT | `/admin/client-fields/{id}` | base | `ClientCustomFieldsController@update` |
| DELETE | `/admin/client-fields/{id}` | base | `ClientCustomFieldsController@destroy` |

### `admin/client-hub` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/client-hub` | base | `ClientHubSettingsController@show` |
| PUT | `/admin/client-hub` | base | `ClientHubSettingsController@update` |

### `admin/connectors` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/connectors` | base | `ConnectorsController@index` |

### `admin/notification-history` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/notification-history` | base | `NotificationHistoryController@index` |

### `admin/permissions` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/permissions` | base | `PortalPermissionsController@show` |
| PUT | `/admin/permissions` | base | `PortalPermissionsController@update` |

### `admin/reports` (6 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/reports` | base | `ReportsController@index` |
| POST | `/admin/reports` | base | `ReportsController@store` |
| GET | `/admin/reports/{uid}` | base | `ReportsController@show` |
| DELETE | `/admin/reports/{uid}` | base | `ReportsController@destroy` |
| GET | `/admin/reports/{uid}/export` | base | `ReportsController@export` |
| POST | `/admin/reports/{uid}/run` | base | `ReportsController@run` |

### `admin/security-policies` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/security-policies` | base | `AdminSecurityController@show` |
| PUT | `/admin/security-policies/{section}` | base | `AdminSecurityController@update` |

### `admin/service-teams` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/service-teams` | base | `ServiceTeamsController@index` |
| POST | `/admin/service-teams/{id}/assign` | base | `ServiceTeamsController@assign` |
| POST | `/admin/service-teams/{id}/unassign` | base | `ServiceTeamsController@unassign` |

### `admin/storage-usage` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/storage-usage` | base | `StorageUsageController@index` |

### `admin/users` (14 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/admin/users` | base | `AdminUsersController@index` |
| POST | `/admin/users` | base | `AdminUsersController@store` |
| POST | `/admin/users/bulk-delete` | base | `AdminUsersController@bulkDestroy` |
| GET | `/admin/users/pending-count` | base | `AdminUsersController@pendingCount` |
| PATCH | `/admin/users/{user}` | base | `AdminUsersController@update` |
| DELETE | `/admin/users/{user}` | base | `AdminUsersController@destroy` |
| GET | `/admin/users/{user}/activity` | base | `AdminUsersController@activity` |
| POST | `/admin/users/{user}/approve` | base | `AdminUsersController@approve` |
| POST | `/admin/users/{user}/deny` | base | `AdminUsersController@deny` |
| POST | `/admin/users/{user}/generate-password` | base | `AdminUsersController@generatePassword` |
| POST | `/admin/users/{user}/reactivate` | base | `AdminUsersController@reactivate` |
| POST | `/admin/users/{user}/reset-two-factor` | base | `AdminUsersController@resetTwoFactor` |
| POST | `/admin/users/{user}/send-reset` | base | `AdminUsersController@sendReset` |
| POST | `/admin/users/{user}/suspend` | base | `AdminUsersController@suspend` |

### `/` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `//` | base | `DashboardController` |

### `404` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/404` | web | `closure in routes/web.php` |

### `broadcasting` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST | `/broadcasting/auth` | web | `Illuminate\\Broadcasting\\BroadcastController@authenticate` |

### `citizenship-applications` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/citizenship-applications/{rest}` | base | `LegacyPageController@clients` |

### `client-invite` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/client-invite/{token}` | web | `closure in routes/web.php` |

### `clients` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/clients/{rest}` | base | `LegacyPageController@clients` |

### `coming-soon` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/coming-soon` | web | `closure in routes/web.php` |

### `connect` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/connect/{provider}` | web, auth | `SocialAuthController@redirect` |

### `demo` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/demo/avatars` | web | `Illuminate\\Routing\\ViewController` |

### `desktop/assets` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/desktop/assets` | web | `DesktopAssetsController@show` |

### `desktop/build` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/desktop/build` | web | `DesktopAssetsController@build` |

### `desktop/download` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/desktop/download/{platform}` | web | `DesktopReleasesController@download` |

### `desktop/releases` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/desktop/releases` | web | `DesktopReleasesController@index` |

### `desktop/{file}` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/desktop/{file}` | web | `DesktopUpdateController` |

### `forgot-password` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/forgot-password` | web | `Illuminate\\Routing\\RedirectController` |

### `hooks` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/hooks/microsoft-graph` | web, throttle:120,1 | `GraphWebhookController` |

### `invite` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/invite/{token}` | web, throttle:invitations | `InvitationAcceptController@show` |
| POST | `/invite/{token}` | web, throttle:invitations | `InvitationAcceptController@register` |
| POST | `/invite/{token}/accept` | web, throttle:invitations | `InvitationAcceptController@accept` |
| POST | `/invite/{token}/decline` | web, throttle:invitations | `InvitationAcceptController@decline` |
| POST | `/invite/{token}/signin` | web, throttle:invitations | `InvitationAcceptController@signin` |

### `maintenance` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/maintenance` | web | `closure in routes/web.php` |

### `media` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/media/avatars/{name}` | web, auth | `AvatarController@show` |
| GET | `/media/branding/{name}` | web, auth | `BrandingController@logo` |

### `onboarding` (4 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/onboarding` | web, auth, verified, account.approved | `ClientOnboardingController@index` |
| GET | `/onboarding/{step}` | web, auth, verified, account.approved | `ClientOnboardingController@show` |
| POST | `/onboarding/{step}` | web, auth, verified, account.approved | `ClientOnboardingController@store` |
| POST | `/onboarding/{step}/back` | web, auth, verified, account.approved | `ClientOnboardingController@back` |

### `onboarding-complete` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| POST | `/onboarding-complete` | web, auth, verified, account.approved | `ClientOnboardingController@complete` |

### `pricing` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/pricing` | web | `closure in routes/web.php` |

### `privacy-policy` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/privacy-policy` | web | `closure in routes/web.php` |

### `profile` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/profile` | base | `ProfileController@show` |
| PUT | `/profile` | base | `ProfileController@update` |

### `r` (3 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/r/{token}` | web, throttle:uploads | `Files\\PublicUploadController@show` |
| POST | `/r/{token}/unlock` | web, throttle:uploads | `Files\\PublicUploadController@unlock` |
| POST | `/r/{token}/upload` | web, throttle:uploads | `Files\\PublicUploadController@upload` |

### `s` (5 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/s/{token}` | web | `Files\\PublicShareController@show` |
| GET | `/s/{token}/download` | web | `Files\\PublicShareController@download` |
| GET | `/s/{token}/file/{fileUuid}` | web | `Files\\PublicShareController@file` |
| GET | `/s/{token}/preview` | web | `Files\\PublicShareController@preview` |
| POST | `/s/{token}/unlock` | web | `Files\\PublicShareController@unlock` |

### `security-settings` (11 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/security-settings` | base | `closure in routes/web.php` |
| PUT | `/security-settings/alerts` | base | `SecuritySettingsController@updateAlerts` |
| GET | `/security-settings/data` | base | `SecuritySettingsController@data` |
| POST | `/security-settings/logout-others` | base | `SecuritySettingsController@logoutOtherDevices` |
| POST | `/security-settings/password` | base | `SecuritySettingsController@setPassword` |
| PUT | `/security-settings/phone` | base | `SecuritySettingsController@updatePhone` |
| DELETE | `/security-settings/phone` | base | `SecuritySettingsController@removePhone` |
| DELETE | `/security-settings/sessions/{session}` | base | `SecuritySettingsController@revokeSession` |
| DELETE | `/security-settings/trusted-devices` | base | `SecuritySettingsController@revokeAllTrustedDevices` |
| DELETE | `/security-settings/trusted-devices/{device}` | base | `SecuritySettingsController@revokeTrustedDevice` |
| POST | `/security-settings/two-factor-app` | base | `SecuritySettingsController@setTwoFactorApp` |

### `settings` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/settings` | base | `Illuminate\\Routing\\RedirectController` |

### `setup-new-password` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/setup-new-password` | web | `Illuminate\\Routing\\RedirectController` |

### `sign` (7 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/sign/{token}` | web, throttle:signing | `Signatures\\PublicSigningController@show` |
| POST | `/sign/{token}/approve` | web, throttle:signing | `Signatures\\PublicSigningController@approve` |
| POST | `/sign/{token}/decline` | web, throttle:signing | `Signatures\\PublicSigningController@decline` |
| GET | `/sign/{token}/document` | web, throttle:signing | `Signatures\\PublicSigningController@document` |
| POST | `/sign/{token}/progress` | web, throttle:signing | `Signatures\\PublicSigningController@progress` |
| POST | `/sign/{token}/request-changes` | web, throttle:signing | `Signatures\\PublicSigningController@requestChanges` |
| POST | `/sign/{token}/submit` | web, throttle:signing | `Signatures\\PublicSigningController@submit` |

### `sign-in` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/sign-in` | web | `Illuminate\\Routing\\RedirectController` |

### `sign-up` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/sign-up` | web | `Illuminate\\Routing\\RedirectController` |

### `storage` (2 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/storage/{path}` |  | `closure in routes/web.php` |
| PUT | `/storage/{path}` |  | `closure in routes/web.php` |

### `terms-of-service` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/terms-of-service` | web | `closure in routes/web.php` |

### `two-step-verification` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET|POST|PUT|PATCH|DELETE|OPTIONS | `/two-step-verification` | web | `Illuminate\\Routing\\RedirectController` |

### `up` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/up` |  | `closure in routes/web.php` |

### `{page}` (1 routes)

| Method | Path | Middleware | Action |
|---|---|---|---|
| GET | `/{page}` | base | `LegacyPageController` |
