/*
 * Bundle the Bespoke AI representative — the 3D face that talks in the
 * live voice stage — into one ES module the portal loads on demand.
 *
 * Source:  resources/js/bespoke-representative/representative.mjs
 * Output:  public/js/vendor/bespoke-representative.mjs   (committed)
 *
 * three.js is a build dependency only; the portal never loads it from a
 * CDN (the CSP forbids that anyway). The output is committed like the
 * pdf.js loader beside it, because the deploy runs `npm run build` for
 * the classic scripts and this module is imported by URL, not bundled
 * into them. Re-run after editing the source or bumping three:
 *
 *   node scripts/build-representative.mjs
 */
import { build } from 'esbuild'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const result = await build({
  entryPoints: [join(ROOT, 'resources/js/bespoke-representative/representative.mjs')],
  outfile: join(ROOT, 'public/js/vendor/bespoke-representative.mjs'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  banner: {
    js: '/* Bespoke AI representative. Built by scripts/build-representative.mjs from resources/js/bespoke-representative; do not edit. three.js is MIT (c) 2010-2024 three.js authors. */',
  },
  metafile: true,
})

const out = Object.entries(result.metafile.outputs)[0]
console.log(`${out[0]}: ${(out[1].bytes / 1024).toFixed(0)} KB`)
