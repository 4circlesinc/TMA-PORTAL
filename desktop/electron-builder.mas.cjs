'use strict';

/*
 * The Mac App Store build: `npm run release:mas`.
 *
 * Same app as the direct download, with three differences the store insists
 * on. It runs in the App Sandbox (entitlements.mas.plist), it is built on
 * Electron's MAS variant, which avoids the private APIs the store rejects, and
 * it never updates itself (updater.js stands down when process.mas is set).
 *
 * Signing needs, in the login keychain:
 *   Apple Distribution            signs the app
 *   Mac Installer Distribution    signs the .pkg that is uploaded
 * and a Mac App Store provisioning profile for com.tmantoinelaw.portal at
 * build/mas.provisionprofile (or MAS_PROVISIONING_PROFILE). The team ID and app
 * group are read from that profile at signing time.
 *
 *   MAS_IDENTITY              pick a certificate when the keychain has several
 *   MAS_PROVISIONING_PROFILE  profile path, if not build/mas.provisionprofile
 *   MAS_BUILD_VERSION         CFBundleVersion, instead of the date and time
 *   MAS_UNSIGNED=1            build the .app without signing, to try the sandbox
 *                             locally. Not uploadable.
 *
 * The output is release-mas/mas-universal/TM ANTOINE Portal-<version>-mas.pkg,
 * uploaded with Transporter or `xcrun altool` (see ../docs/app-store.md).
 */
const base = require('./package.json').build;

// The direct download signs ad-hoc with identity null. Inherited here, null
// would skip signing, so it is dropped and the keychain is searched instead.
const { identity: _adhoc, target: _targets, ...mac } = base.mac;

const unsigned = process.env.MAS_UNSIGNED === '1';

// The version the store shows (CFBundleShortVersionString). It has its own
// line, like the iOS app's MARKETING_VERSION, apart from the direct download's
// package.json version. Raise it for each store release.
const STORE_VERSION = '1.0';

// CFBundleVersion: the UTC date and time, 20261124.308, as
// ios/scripts/app-store.sh numbers its builds. It always goes up, which the
// Mac App Store requires of every upload. MAS_BUILD_VERSION overrides it.
function storeBuildNumber(now = new Date()) {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}.${Number(iso.slice(11, 13) + iso.slice(14, 16))}`;
}

module.exports = {
  ...base,
  buildVersion: process.env.MAS_BUILD_VERSION || storeBuildNumber(),
  // Kept apart from release/, which `php artisan desktop:publish` uploads to
  // the public update feed wholesale, *.pkg included.
  directories: { ...base.directories, output: 'release-mas' },
  mac: {
    ...mac,
    // Universal, so Intel Macs can install it from the store too.
    target: [{ target: 'mas', arch: ['universal'] }],
    // Read from mac, not mas, when the Info.plist is written.
    bundleShortVersion: STORE_VERSION,
  },
  mas: {
    identity: unsigned ? null : (process.env.MAS_IDENTITY || undefined),
    // The store does not use the hardened runtime, and mac.hardenedRuntime
    // would otherwise carry over.
    hardenedRuntime: false,
    entitlements: 'entitlements.mas.plist',
    entitlementsInherit: 'entitlements.mas.inherit.plist',
    // Left unset, the login helper would be signed with the inherit file
    // above and killed at login.
    entitlementsLoginHelper: 'entitlements.mas.loginhelper.plist',
    provisioningProfile: process.env.MAS_PROVISIONING_PROFILE || 'build/mas.provisionprofile',
    // Signs with whichever Apple Distribution certificate the profile lists,
    // not whichever the keychain happens to list first. See mas-sign.js.
    sign: './mas-sign.js',
    artifactName: '${productName}-${version}-mas.${ext}',
    extendInfo: {
      // HTTPS only, which is exempt. Saves the export compliance question on
      // every upload.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  // Store builds are not published to the portal's update feed.
  publish: null,
};
