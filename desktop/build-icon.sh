#!/bin/bash
# Builds assets/icon.icns from the icon master. Requires macOS (sips + iconutil).
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

[ -f "$SRC" ] || { echo "Missing icon master: $SRC" >&2; exit 1; }

rm -rf "$SET"
mkdir -p "$SET"

for size in 16 32 128 256 512; do
  sips -z $size $size          "$SRC" --out "$SET/icon_${size}x${size}.png"      >/dev/null
  sips -z $((size*2)) $((size*2)) "$SRC" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$SET" -o assets/icon.icns
rm -rf "$SET"

echo "Built assets/icon.icns"
