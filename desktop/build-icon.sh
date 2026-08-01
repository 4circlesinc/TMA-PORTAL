#!/bin/bash
# Builds every app icon from the one master. Requires macOS (sips + iconutil).
#
#   assets/icon.icns    macOS app bundle
#   assets/icon.ico     Windows installer, exe, and window/taskbar icon
#   assets/tray.png     Windows notification-area icon (+@2x)
#
# assets/icon-master.png is a committed 1024px render of
# public/images/brand/tma/macos_appicon.png, laid out on Apple's icon grid
# (824px of artwork centred on a 1024px transparent canvas) so the app sits
# the same size as every other icon in the dock. Regenerate it only if the
# brand artwork changes.
set -euo pipefail

cd "$(dirname "$0")"

SRC="assets/icon-master.png"
SET="assets/icon.iconset"
WORK="assets/.icon-work"

[ -f "$SRC" ] || { echo "Missing icon master: $SRC" >&2; exit 1; }

rm -rf "$SET" "$WORK"
mkdir -p "$SET" "$WORK"

for size in 16 32 128 256 512; do
  sips -z $size $size          "$SRC" --out "$SET/icon_${size}x${size}.png"      >/dev/null
  sips -z $((size*2)) $((size*2)) "$SRC" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o assets/icon.icns
rm -rf "$SET"

# Windows has no equivalent of Apple's icon grid — every other icon on the
# taskbar fills its box, so the 100px of transparent margin the .icns needs
# would just make this app look smaller than its neighbours. Crop it back to
# the artwork before resizing.
sips -c 824 824 "$SRC" --out "$WORK/full.png" >/dev/null

ICO_SIZES=(16 24 32 48 64 128 256)
for size in "${ICO_SIZES[@]}"; do
  sips -z $size $size "$WORK/full.png" --out "$WORK/${size}.png" >/dev/null
done

node make-ico.js assets/icon.ico $(printf "$WORK/%s.png " "${ICO_SIZES[@]}")

# The tray sits in a 16px slot at 100% scaling and 32px at 200%. Electron picks
# the @2x variant by filename, so both must exist next to each other.
sips -z 16 16 "$WORK/full.png" --out assets/tray.png    >/dev/null
sips -z 32 32 "$WORK/full.png" --out assets/tray@2x.png >/dev/null

rm -rf "$WORK"

echo "Built assets/icon.icns, assets/icon.ico, assets/tray.png"
