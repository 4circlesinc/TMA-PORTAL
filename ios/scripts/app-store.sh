#!/usr/bin/env bash
#
# Archive the iOS app and upload it to App Store Connect. The build appears in
# TestFlight first; it reaches the App Store only when it is submitted for
# review there. See ../../docs/app-store.md.
#
#   APPLE_TEAM_ID=ABCDE12345 ios/scripts/app-store.sh
#
# Signing is automatic. Xcode creates the distribution certificate and the
# App Store profile itself, using either the Apple ID signed in under
# Xcode > Settings > Accounts, or an App Store Connect API key:
#
#   ASC_KEY_ID      key ID, e.g. 2X9R4HXF34
#   ASC_ISSUER_ID   issuer ID from Users and Access > Integrations
#   ASC_KEY_PATH    path to the AuthKey_<id>.p8 file
#
# BUILD_NUMBER overrides the build number (CFBundleVersion). The default is
# the UTC date and time, which always goes up.
#
# NO_UPLOAD=1 stops after exporting the .ipa to ios/build/app-store.

set -euo pipefail

cd "$(dirname "$0")/.."

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to the 10-character team ID from developer.apple.com > Membership}"

# 20261105.2145: date, then time without leading zeros, which App Store
# Connect compares as numbers.
NOW=$(date -u +%Y%m%d%H%M)
BUILD_NUMBER="${BUILD_NUMBER:-${NOW:0:8}.$((10#${NOW:8:4}))}"
OUT="build/app-store"
ARCHIVE="$OUT/TMAPortal.xcarchive"

AUTH=()
if [[ -n "${ASC_KEY_ID:-}" || -n "${ASC_ISSUER_ID:-}" || -n "${ASC_KEY_PATH:-}" ]]; then
  : "${ASC_KEY_ID:?ASC_KEY_ID is missing}"
  : "${ASC_ISSUER_ID:?ASC_ISSUER_ID is missing}"
  : "${ASC_KEY_PATH:?ASC_KEY_PATH is missing}"
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

DESTINATION="upload"
if [[ "${NO_UPLOAD:-}" == "1" ]]; then DESTINATION="export"; fi

rm -rf "$OUT"
mkdir -p "$OUT"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>${DESTINATION}</string>
	<key>teamID</key>
	<string>${APPLE_TEAM_ID}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>uploadSymbols</key>
	<true/>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
</dict>
</plist>
PLIST

VERSION=$(sed -n 's/.*MARKETING_VERSION = \(.*\);/\1/p' TMAPortal.xcodeproj/project.pbxproj | head -1)
echo "Archiving TM ANTOINE Portal ${VERSION} (${BUILD_NUMBER}) for team ${APPLE_TEAM_ID}"

xcodebuild archive \
  -project TMAPortal.xcodeproj \
  -scheme TMAPortal \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT" \
  -allowProvisioningUpdates \
  ${AUTH[@]+"${AUTH[@]}"}

if [[ "$DESTINATION" == "upload" ]]; then
  echo "Uploaded ${VERSION} (${BUILD_NUMBER}). It shows in App Store Connect > TestFlight once Apple finishes processing, usually within 30 minutes."
else
  echo "Exported to ios/${OUT}. Nothing was uploaded."
fi
