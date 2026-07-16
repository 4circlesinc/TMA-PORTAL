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

To update:

```sh
npm install pdfjs-dist@<version>
cp node_modules/pdfjs-dist/build/pdf.min.mjs public/js/vendor/
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/js/vendor/
cp node_modules/pdfjs-dist/LICENSE public/js/vendor/pdf.js-LICENSE
```
