/*
 * Asset bundling parity check.
 *
 * The build concatenates 89 classic scripts and 28 stylesheets into one of
 * each. Those scripts share globals and the stylesheets are a hand-ordered
 * cascade, so the only thing worth testing is that the bundled shell behaves
 * exactly like the unbundled one — not that it merely loads.
 *
 * So this runs the same walk over the portal twice, once against the built
 * bundle and once with the manifest hidden (raw tags), and diffs the results:
 * the globals each page registers, the console errors, the failed requests,
 * and the computed styling of the chrome that the cascade order decides.
 *
 * Run:
 *   TMA_BASE_URL=http://127.0.0.1:8901 node tests/Browser/asset-bundle.mjs
 */

import { chromium } from 'playwright'
import { rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901'
const MANIFEST = resolve('public/build/manifest.json')
const HIDDEN = `${MANIFEST}.off`

/* Every SPA route the one shell serves, plus the dashboard itself. */
const PAGES = [
  '/',
  '/overview',
  '/email',
  '/clients',
  '/calendar',
  '/social/feed',
  '/social/messages',
  '/folders/all',
  '/settings',
  '/users',
  '/people',
]

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
  await page.click('text=Sign in with Email')
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 })
  await page.fill('input[name="email"]', 'e2e@example.com')
  await page.fill('input[name="password"]', 'password12345')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ])
  await page.waitForTimeout(500)
  if (page.url().includes('/auth/login')) throw new Error('login failed')

  // "Stay signed in?" fronts the whole portal — every route redirects back to
  // it until it is answered, which makes an unanswered run look like a portal
  // that loads nothing at all.
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button:has-text("Yes, stay signed in")'),
    ])
    await page.waitForTimeout(300)
  }

  if (page.url().includes('/auth/')) throw new Error(`stuck on auth: ${page.url()}`)
}

/** Walk the portal and record everything that could differ. */
async function walk(label) {
  const context = await browser.newContext()
  const page = await context.newPage()

  const errors = []
  const failed = []
  let requests = 0

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`))
  page.on('requestfailed', (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`))
  page.on('request', () => { requests += 1 })

  await signIn(page)

  const result = { label, pages: {}, errors, failed }
  let firstLoadRequests = null

  for (const path of PAGES) {
    requests = 0
    const started = Date.now()
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    const elapsed = Date.now() - started
    if (firstLoadRequests === null) firstLoadRequests = requests

    result.pages[path] = await page.evaluate(() => {
      const sidebar = document.querySelector('.tma-dash__sidebar, [class*="sidebar"]')
      const styled = sidebar ? getComputedStyle(sidebar) : null

      return {
        // The globals these scripts publish. A missing one means a file was
        // dropped from the bundle or failed to execute.
        globals: Object.keys(window).filter((k) => k.startsWith('TMA')).sort(),
        navItems: document.querySelectorAll('[class*="nav-item"], .tma-dash__nav a').length,
        // The cascade decides these; a reordered bundle shows up here.
        sidebarWidth: styled ? styled.width : null,
        sidebarBg: styled ? styled.backgroundColor : null,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        fontFamily: getComputedStyle(document.body).fontFamily,
        title: document.title,
        stylesheets: document.styleSheets.length,
      }
    })

    result.pages[path].ms = elapsed
    result.pages[path].requests = requests
  }

  result.firstLoadRequests = firstLoadRequests
  await context.close()

  return result
}

const browser = await chromium.launch()

// Bundled first (the manifest is in place), then hidden for the control.
const bundled = await walk('bundled')

await rename(MANIFEST, HIDDEN)
let raw
try {
  raw = await walk('raw')
} finally {
  if (existsSync(HIDDEN)) await rename(HIDDEN, MANIFEST)
}

await browser.close()

/* ---------- diff ---------- */

let failures = 0
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`) }

console.log(`\nRequests on first page load:  bundled ${bundled.firstLoadRequests}  |  raw ${raw.firstLoadRequests}`)

console.log('\nPer-page parity:')
for (const path of PAGES) {
  const b = bundled.pages[path]
  const r = raw.pages[path]

  const missing = r.globals.filter((g) => !b.globals.includes(g))
  const extra = b.globals.filter((g) => !r.globals.includes(g))

  const deltas = []
  if (missing.length) deltas.push(`missing globals: ${missing.join(', ')}`)
  if (extra.length) deltas.push(`unexpected globals: ${extra.join(', ')}`)
  for (const key of ['sidebarWidth', 'sidebarBg', 'bodyBg', 'fontFamily', 'title', 'navItems']) {
    if (b[key] !== r[key]) deltas.push(`${key}: bundled=${b[key]} raw=${r[key]}`)
  }

  const speed = `${String(b.ms).padStart(5)}ms vs ${String(r.ms).padStart(5)}ms`
  const reqs = `${String(b.requests).padStart(3)} vs ${String(r.requests).padStart(3)} reqs`

  if (deltas.length) {
    console.log(`  ${path}`)
    deltas.forEach((d) => fail(`${path} — ${d}`))
  } else {
    console.log(`  ok    ${path.padEnd(20)} ${speed}  ${reqs}  ${b.globals.length} globals`)
  }
}

const newErrors = bundled.errors.filter((e) => {
  const message = e.split(' :: ')[1]
  return !raw.errors.some((o) => o.split(' :: ')[1] === message)
})

console.log(`\nConsole errors:  bundled ${bundled.errors.length}  |  raw ${raw.errors.length}`)
if (newErrors.length) {
  console.log('  Errors present ONLY when bundled:')
  newErrors.forEach((e) => fail(e))
}

const newFailed = bundled.failed.filter((f) => !raw.failed.includes(f))
if (newFailed.length) {
  console.log('  Requests failing ONLY when bundled:')
  newFailed.forEach((f) => fail(f))
}

console.log(failures === 0 ? '\nPASS — bundled shell matches raw shell.\n' : `\n${failures} difference(s).\n`)
process.exit(failures === 0 ? 0 : 1)
