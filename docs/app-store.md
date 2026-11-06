# App Store and Mac App Store

The iOS app (`ios/`) and the Mac app (`desktop/`) ship under one App Store
record. Both use the bundle ID `com.tmantoinelaw.portal`, so a person who gets
one gets the other ("universal purchase"). The direct-download Mac and Windows
apps keep their own updater and are not affected.

| | iOS | Mac App Store |
|---|---|---|
| Build | `ios/scripts/app-store.sh` | `cd desktop && npm run release:mas` |
| Output | uploaded straight to App Store Connect | `desktop/release-mas/mas-universal/TM ANTOINE Portal-<version>-mas.pkg` |
| Version | `MARKETING_VERSION` in the Xcode project (now 0.1.0) | `version` in `desktop/package.json` (now 0.8.56) |
| Build number | date and time, set by the script | same as the version; `MAS_BUILD_VERSION` to re-upload |
| Updates | App Store and TestFlight | App Store. The app's own updater is off |

## What the store builds change

- **iOS release builds** no longer offer an `.ipa` from `/desktop/releases`.
  Apple rejects apps that install their own updates.
- **iOS** has the Push Notifications entitlement. Xcode switches it to
  production when it exports for the App Store.
- **Mac** runs in the App Sandbox (`desktop/entitlements.mas.plist`): network,
  camera, microphone, location, files you pick, Downloads, printing. It is built
  on Electron's Mac App Store variant, universal for Intel and Apple silicon.
  The self-updater and every "Check for Updates…" item are off.
- **Both** tell the page they are store installs (`TMADesktop.store`). The
  account page then leaves out the "macOS / Windows / Android" download promo,
  because Apple rejects apps that offer other builds or name other mobile
  platforms.

`npm test` in `desktop/` includes `test-mas-config.js`, which keeps the sandbox
entitlements, signing settings and updater shutdown in place.

## One-time setup with Apple

1. **Apple Developer Program, as an organization.** Enroll as the firm, not a
   person. This needs a D-U-N-S number and costs USD 99 a year. Apple expects
   apps that handle legal matters and sensitive data to come from the business
   that provides the service (guideline 5.1.1(ix)). The store will show the
   firm's legal name as the seller.
2. **Team ID.** Find it under developer.apple.com > Account > Membership. It is
   10 characters, and the iOS script needs it as `APPLE_TEAM_ID`.
3. **App ID.** Go to Certificates, Identifiers & Profiles > Identifiers > +
   and register an explicit App ID `com.tmantoinelaw.portal` with **Push
   Notifications** on. (Xcode's automatic signing can also create it on the
   first archive.)
4. **App Store Connect record.** Go to Apps > + > New App. Platforms: **iOS**
   and **macOS**. Name: TM ANTOINE Portal. Bundle ID: com.tmantoinelaw.portal.
   SKU: e.g. `tma-portal`. Primary language: English (U.S.).
5. **API key for uploads.** Go to Users and Access > Integrations > App Store
   Connect API > Team Keys > + with the role **App Manager**. Note the key ID
   and issuer ID, and download `AuthKey_<id>.p8` once. Keep it in
   `~/.appstoreconnect/private_keys/`, never in the repo.
6. **APNs key for push** (server side). Go to Keys > + and enable Apple Push
   Notifications service. Then set `APNS_KEY_ID`, `APNS_TEAM_ID`,
   `APNS_BUNDLE_ID=com.tmantoinelaw.portal` and `APNS_PRIVATE_KEY` on the
   server, as in `ios/README.md`.
7. **Mac certificates.** In Xcode, open Settings > Accounts > your team > Manage
   Certificates > +. Add **Apple Distribution** and **Mac Installer
   Distribution**. Both land in the login keychain, where the Mac build finds
   them.
8. **Mac provisioning profile.** Go to Profiles > + > **Mac App Store Connect**.
   Pick the App ID and the Apple Distribution certificate, download the profile,
   and save it as `desktop/build/mas.provisionprofile` (ignored by git).

## Building and uploading

### iOS

```
APPLE_TEAM_ID=XXXXXXXXXX \
ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
ASC_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8 \
ios/scripts/app-store.sh
```

The `ASC_*` variables can be left out if your Apple ID is signed in under Xcode
> Settings > Accounts. `NO_UPLOAD=1` stops after exporting the `.ipa` to
`ios/build/app-store/`.

### Mac

```
cd desktop
npm run release:mas
xcrun altool --upload-app -t macos \
  -f "release-mas/mas-universal/TM ANTOINE Portal-0.8.56-mas.pkg" \
  --apiKey XXXXXXXXXX --apiIssuer xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

You can also drop the `.pkg` into Apple's **Transporter** app. The store build
goes to `release-mas/`, not `release/`, because `php artisan desktop:publish`
uploads every `.pkg` in `release/` to the public download feed.

A store-signed Mac build only opens once it is installed from TestFlight or the
App Store. To try the sandbox locally without certificates, run
`MAS_UNSIGNED=1 npm run release:mas` and sign the result ad-hoc.

Each upload needs a build number App Store Connect has not seen. To re-upload
the same Mac version after a rejection:
`MAS_BUILD_VERSION=0.8.56.1 npm run release:mas`.

## The store listing

Fill this in under App Store Connect > the app, once for iOS and once for macOS.

- **Privacy Policy URL:** https://portal.tmantoinelaw.com/privacy-policy/
- **Support URL:** a page that reaches support@tmantoinelaw.com.
- **Category:** Business.
- **Age rating:** answer the questionnaire. Messaging between users counts as
  user-generated content.
- **Availability:** remove **China mainland**. The iOS app uses CallKit, which
  Apple does not allow there.
- **Screenshots:** iPhone 6.9" (1320 x 2868), iPad 13" (2064 x 2752, required
  because the app runs on iPad), and Mac (2880 x 1800 or 1440 x 900). Use the
  test account below, never a real client's data.
- **Encryption:** both builds declare HTTPS only (`ITSAppUsesNonExemptEncryption
  = NO`), so there is no export compliance question per upload.

### App Privacy (the "nutrition label")

Answer for what the portal handles, not just the app shell. Check this against
the privacy policy before submitting. A likely starting point, all **linked to
the user**, **not used for tracking**, and for **App Functionality**:

- Contact Info: name, email address, phone number, physical address
- User Content: emails or text messages, photos or videos, audio data,
  other user content (documents, forms)
- Identifiers: user ID
- Location: precise location, if office-or-remote presence is on
- Sensitive Info: if matters include immigration status, health, or similar
- Financial Info: only if the billing details form stores card data

## App Review

Reviewers sign in from Apple's own devices. Under App Review Information:

- **Demo account.** Use a dedicated account with sample data. It must not be
  asked for the emailed sign-in code that a new device or location triggers,
  because the reviewer cannot read that inbox. If the portal cannot exempt
  one account, that has to be added before submitting.
- **Notes.** Say what the app does beyond the website. Apple rejects plain
  website wrappers (guideline 4.2). For example: "Clients and staff of TM
  ANTOINE Advisory use the app to manage their legal matters. Beyond the web
  portal, the app opens offline from its cached copy, delivers notifications
  through Notification Center, rings incoming calls through CallKit, offers
  Sign in with Apple through the system sheet, signs in through Safari for
  Google and Microsoft accounts, and hands downloaded documents to the share
  sheet to save to Files. Background audio keeps a call connected when the
  user switches apps. Location is used only to show whether a staff member is
  working from the office."
- **Account deletion** (guideline 5.1.1(v)) is under Settings > Privacy > Erase
  your account, and Settings > Delete my account. Erasing an account, or
  disconnecting Apple under Security, revokes its Sign in with Apple grant at
  Apple, as Apple requires.

## Sign in with Apple

Guideline 4.8: an app that offers Google or Microsoft sign-in must offer an
equivalent privacy-focused option, which here is Sign in with Apple. It is
built in and stays hidden until the server has its keys.

| Where | How it signs in |
|---|---|
| Websites, Mac app, Android app | Apple's web page, through the same browser handoff as Google and Microsoft |
| iPhone and iPad app | the system's Sign in with Apple sheet (Face ID), checked by the server |

Someone whose Apple ID email matches their portal account is signed straight
in. Someone who picks "Hide My Email" gets a new account request, unless they
connect Apple first under Security while signed in.

**Apple side, once:**

1. **App ID.** Identifiers > `com.tmantoinelaw.portal` > turn on **Sign in with
   Apple** (enable as a primary App ID). The next iOS archive picks it up on
   its own.
2. **Services ID** (the website). Identifiers > + > Services IDs. Identifier
   `com.tmantoinelaw.portal.web`, description "TM ANTOINE Portal". Turn on Sign
   in with Apple > Configure: primary App ID `com.tmantoinelaw.portal`, domain
   `portal.tmantoinelaw.com`, return URL
   `https://portal.tmantoinelaw.com/auth/social/apple/callback`.
3. **Key.** Keys > + > **Sign in with Apple** > Configure > primary App ID
   `com.tmantoinelaw.portal`. Download `AuthKey_<id>.p8` (only once) and note
   the key ID.
4. **Relay email.** Certificates, Identifiers & Profiles > Services > Sign in with
   Apple for Email Communication. Register the domain and the address the
   portal sends from. Without it, mail to a hidden `privaterelay.appleid.com`
   address bounces.
5. **The Mac App Store profile.** Changing the App ID's capabilities makes
   existing profiles invalid. Regenerate the Mac App Store Connect profile
   (Profiles > it > Edit > Save), download it again and replace
   `desktop/build/mas.provisionprofile`. Xcode renews the iOS one itself.

**Server:** `APPLE_CLIENT_ID=com.tmantoinelaw.portal.web`,
`APPLE_TEAM_ID=59W394VBSK`, `APPLE_KEY_ID=<key id>`, and `APPLE_PRIVATE_KEY`
(the `.p8` contents, or a path to it). The buttons appear on the sign-in,
sign-up and invitation pages, and an Apple row under Security, as soon as
these are set.

## Open before the first submission

- **Sign in with Apple keys**, above. Without them on the server the button
  does not show, and App Review will reject the app under 4.8.
- **The demo account's emailed code**, above.
- **Version numbers.** The first iOS release would be 0.1.0. Set
  `MARKETING_VERSION` to 1.0.0 in Xcode first if that should be the public
  number.

## After approval

The App Store and TestFlight do the updating from here. The portal itself
updates the moment it deploys, so most changes need no new store build. A new
store build is only needed for changes under `ios/` or to the desktop shell.
