# Vendored third-party libraries

Checked in rather than installed, because the portal loads plain `<script>`
files with no bundler step. Update by copying a new build in and bumping the
version noted here.

## pdf.js (`pdf.min.mjs`, `pdf.worker.min.mjs`)

- **Version**: 6.1.200 (`pdfjs-dist`)
- **Licence**: Apache-2.0 — see `pdf.js-LICENSE`
- **Source**: https://github.com/mozilla/pdf.js
- **Used by**: `public/js/portal-work.js` — renders the real pages of a
  document in the signature editor so fields can be placed on them.

These are the ESM builds. `portal-work.js` is a classic script, so it pulls
them in with a dynamic `import()` the first time the editor opens — the
1.7 MB never loads for anyone who doesn't place a field. The worker path is
set at that point too; pdf.js needs the worker file served from the same
origin.

pdf.js 4+ no longer ships CMaps, substitution fonts, JPEG2000/JBIG2 wasm or
the CMYK ICC profile inside the worker. `pdf-loader.mjs` points `getDocument`
at the sibling `cmaps/`, `standard_fonts/`, `wasm/` and `iccs/` directories.
A viewer that skips those paints the page count and a white rectangle.

To update:

```sh
npm install pdfjs-dist@<version>
cp node_modules/pdfjs-dist/build/pdf.min.mjs public/js/vendor/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/js/vendor/
cp node_modules/pdfjs-dist/LICENSE public/js/vendor/pdf.js-LICENSE
rm -rf public/js/vendor/cmaps public/js/vendor/standard_fonts public/js/vendor/wasm public/js/vendor/iccs
cp -R node_modules/pdfjs-dist/cmaps public/js/vendor/
cp -R node_modules/pdfjs-dist/standard_fonts public/js/vendor/
cp -R node_modules/pdfjs-dist/wasm public/js/vendor/
cp -R node_modules/pdfjs-dist/iccs public/js/vendor/
```

## Leaflet (`leaflet/`)

- **Version**: 1.9.4
- **Licence**: BSD-2-Clause — see `leaflet/LICENSE`
- **Source**: https://leafletjs.com
- **Used by**: `public/js/presence-status.js` — the office and remote maps in
  Status settings, where a pin and a radius decide automatic In Office /
  Working Remote detection.

Vendored because the Content-Security-Policy
(`App\Http\Middleware\ApplySecurityPolicyHeaders`) allows scripts and
stylesheets from `'self'` only. Loading the library from unpkg.com was refused
by the browser, the Mac and Windows apps and the Android app alike, and every
map fell to "Map unavailable". Map tiles still come from openstreetmap.org
(`img-src https:` allows that); geocoding goes through the portal's own
`/me/availability/geocode` routes.

To update:

```sh
V=1.9.4
for f in leaflet.js leaflet.css; do curl -sfL -o public/js/vendor/leaflet/$f https://unpkg.com/leaflet@$V/dist/$f; done
for f in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do curl -sfL -o public/js/vendor/leaflet/images/$f https://unpkg.com/leaflet@$V/dist/images/$f; done
curl -sfL -o public/js/vendor/leaflet/LICENSE https://unpkg.com/leaflet@$V/LICENSE
```

