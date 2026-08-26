/*
 * The file viewer's side panels.
 *
 * Comments and presence were already live before this; versions, approvals and
 * activity were not, so a reader would watch a discussion update in real time
 * while the Versions tab beside it sat on whatever was true when they opened
 * the file.
 *
 * Opens a file, switches to Versions, then uploads a version from an artisan
 * process and waits for the list to grow. As everywhere else here, the
 * sentinel has to survive: the viewer must patch, never reopen.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/live-file-detail.mjs
 */

import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901'
const DB = process.env.TMA_DB
const WAIT_MS = 20000

let failures = 0
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
await page.click('text=Sign in with Email')
await page.waitForSelector('input[name="email"]', { state: 'visible' })
await page.fill('input[name="email"]', 'e2e@example.com')
await page.fill('input[name="password"]', 'password12345')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]:visible')])
await page.waitForTimeout(400)
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button:has-text("Yes, stay signed in")')])
}

console.log('\nLive updates — file viewer panels\n')

await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/*
 * A double-click on the row opens it, the way a folder window opens a file. A
 * single click only picks the row, and a double-click on the *name* is the
 * rename gesture — so this takes a cell beside it.
 */
const row = page.locator('[data-files-row]')
  .filter({ has: page.locator('[data-files-name]', { hasText: 'Live Detail.pdf' }) })
  .first()
await row.waitFor({ timeout: 8000 })
await row.locator('.tma-portal-cell--type').dblclick()
await page.waitForTimeout(3500)

// The viewer is detected by the subscription it opens rather than by a class
// name, which is the thing being tested anyway and does not depend on markup.
const opened = await page.evaluate(() => {
  const rt = window.TMAMessagingRealtime
  return Object.keys((rt && rt.channels) || {}).some((n) => n.indexOf('private-file.') === 0)
})
check(opened, 'file viewer opened')

// The per-file channel is what carries these panel updates.
const channel = await page.evaluate(() => {
  const rt = window.TMAMessagingRealtime
  const names = Object.keys((rt && rt.channels) || {})
  const file = names.filter((n) => n.indexOf('private-file.') === 0)[0]
  if (!file) return null
  return { name: file, events: Object.keys(rt.channels[file].handlers || {}) }
})

check(!!channel, 'subscribed to the per-file channel')
check(!!channel && channel.events.includes('file.detail.changed'),
  `versions/approvals/activity handler bound (events: ${channel ? channel.events.join(', ') : 'none'})`)

await page.evaluate(() => { window.__viewerSentinel = 'alive' })

// Switch to Versions, so it is the panel on show — only the visible tab
// refetches; the others just have their cache dropped.
await page.click('[data-lb-tab="versions"]')
await page.waitForTimeout(1500)

// Assert on the refetch itself rather than on rendered text: it is the thing
// the signal is supposed to cause, and it does not depend on the panel markup.
const refetches = []
page.on('request', (r) => { if (/\/files\/[^/]+\/versions/.test(r.url())) refetches.push(r.url()) })

await run('php', ['artisan', 'tinker', '--execute', `
  $f = App\\Models\\FileItem::where('name','Live Detail.pdf')->firstOrFail();
  $next = (int) App\\Models\\FileVersion::where('file_id', $f->id)->max('version_number') + 1;
  App\\Models\\FileVersion::create([
    'uuid' => (string) Illuminate\\Support\\Str::uuid(),
    'file_id' => $f->id, 'version_number' => $next,
    'disk' => 'local', 'storage_path' => 'vault/contract.pdf', 'size' => 876,
  ]);
  echo 'v'.$next;
`], {
  env: {
    ...process.env,
    DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '',
    BROADCAST_CONNECTION: 'reverb',
    REVERB_HOST: '127.0.0.1', REVERB_PORT: '8080', REVERB_SCHEME: 'http',
  },
})
console.log('  ..    uploaded a new version from an artisan process')

let refetched = false
const end = Date.now() + WAIT_MS
while (Date.now() < end) {
  if (refetches.length) { refetched = true; break }
  await page.waitForTimeout(400)
}

check(refetched, 'versions panel refetched itself on the signal')

const alive = await page.evaluate(() => window.__viewerSentinel)
check(alive === 'alive', 'viewer patched in place — never reopened')

await browser.close()
console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
