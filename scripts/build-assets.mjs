#!/usr/bin/env node
/*
 * Asset build for the portal shell.
 *
 * The portal is not a module graph — public/js/*.js are classic scripts that
 * talk to each other through globals (window.TMA*), and public/css/*.css is a
 * hand-ordered cascade where the last file deliberately outranks the ones
 * before it. Neither survives a bundler that resolves imports or reorders
 * rules, so this does the one safe transformation: minify each file on its
 * own, then concatenate in the exact order the shell already loads them.
 *
 * That ordering is read out of the shell itself rather than duplicated here,
 * so adding a <script> or <link> to the shell is still all you have to do —
 * the build picks it up on the next run.
 *
 * Output goes to public/build/ with content-hashed names and a manifest.
 * PortalShell swaps the tags in when the manifest exists; with no manifest
 * (a fresh checkout, local dev) the shell serves its raw tags exactly as
 * before, so nothing here is load-bearing for development.
 */

import { transform } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const OUT = join(PUBLIC, 'build')

/** The one shell every SPA route is served (see LegacyPageController). */
const SHELL = join(ROOT, 'resources/views/pages/dashboard.html')

/*
 * portal-access.js is deliberately left alone. It runs undeferred in <head>
 * so the role-gated nav rows settle before first paint, and PortalShell finds
 * its injection point by matching that tag's exact text — rewriting its src
 * would silently break the capability handoff. It is ~10 KB; not worth it.
 */
const CSS_TAG = /^[ \t]*<link rel="stylesheet" href="css\/([^"?]+)(?:\?[^"]*)?">[ \t]*$/gm
const JS_TAG = /^[ \t]*<script src="js\/([^"?]+)(?:\?[^"]*)?" defer><\/script>[ \t]*$/gm

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)
const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/** Ordered, de-duplicated asset list for one tag type. */
function assetsFrom(html, pattern) {
  const seen = new Set()
  const files = []

  for (const match of html.matchAll(pattern)) {
    const file = match[1]
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
  }

  return files
}

/**
 * Minify each file separately and join.
 *
 * Per-file rather than one pass over the concatenation: every one of these
 * files wraps itself in an IIFE, so minifying them together buys nothing but
 * lets a single syntax error take down the whole bundle. Separating them also
 * means a file that fails to parse is reported by name and passed through
 * unminified instead of breaking the build.
 */
async function bundle(files, dir, loader) {
  const parts = []
  const sizes = {}
  const failures = []
  let raw = 0

  for (const file of files) {
    const source = await readFile(join(PUBLIC, dir, file), 'utf8')
    raw += Buffer.byteLength(source)

    let code = source

    try {
      // `esnext` keeps this a pure minify — a lower target would have esbuild
      // rewrite syntax, which is a behaviour change, not a size win.
      const result = await transform(source, {
        loader,
        minify: true,
        target: 'esnext',
        legalComments: 'none',
      })
      code = result.code
    } catch (error) {
      failures.push(`${dir}/${file}: ${error.message.split('\n')[0]}`)
    }

    sizes[`${dir}/${file}`] = Buffer.byteLength(code)

    // Classic scripts are concatenated, so a file that ends mid-expression
    // would otherwise swallow the first statement of the next one.
    parts.push(loader === 'js' ? `${code}\n;\n` : `${code}\n`)
  }

  return { code: parts.join(''), raw, sizes, failures }
}

async function main() {
  const html = await readFile(SHELL, 'utf8')

  const cssFiles = assetsFrom(html, CSS_TAG)
  const jsFiles = assetsFrom(html, JS_TAG)

  if (!cssFiles.length || !jsFiles.length) {
    console.error(
      'No assets found in the shell. The tag format changed — update CSS_TAG/JS_TAG\n' +
        'in this script to match resources/views/pages/dashboard.html.'
    )
    process.exit(1)
  }

  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const css = await bundle(cssFiles, 'css', 'css')
  const js = await bundle(jsFiles, 'js', 'js')

  const cssName = `app-${hash(css.code)}.css`
  const jsName = `app-${hash(js.code)}.js`

  await writeFile(join(OUT, cssName), css.code)
  await writeFile(join(OUT, jsName), js.code)

  const manifest = {
    css: cssName,
    js: jsName,
    // Recorded so a stale build is obvious: if the shell gains a file that
    // isn't in this list, PortalShell falls back to the raw tags.
    sources: { css: cssFiles, js: jsFiles },
  }

  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const failures = [...css.failures, ...js.failures]

  console.log(`CSS  ${cssFiles.length} files  ${kb(css.raw)} -> ${kb(Buffer.byteLength(css.code))}`)
  console.log(`JS   ${jsFiles.length} files  ${kb(js.raw)} -> ${kb(Buffer.byteLength(js.code))}`)
  console.log(`\nRequests: ${cssFiles.length + jsFiles.length} -> 2`)

  if (failures.length) {
    console.log(`\n${failures.length} file(s) could not be minified (shipped as-is):`)
    for (const failure of failures) console.log(`  ${failure}`)
  }

  // Anything in public/js or public/css the shell never loads is dead weight
  // worth knowing about, but it is not this script's job to delete it.
  for (const [dir, used] of [['js', jsFiles], ['css', cssFiles]]) {
    const all = (await readdir(join(PUBLIC, dir))).filter((f) => f.endsWith(`.${dir}`))
    const unused = all.filter((f) => !used.includes(f))
    if (unused.length) console.log(`\n${unused.length} ${dir} file(s) in public/${dir} the shell never loads.`)
  }
}

await main()
