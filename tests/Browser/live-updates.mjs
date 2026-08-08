/*
 * Live data updates.
 *
 * The claim is that a change made by *somebody else* appears without a
 * refresh, so the change here is made outside the browser entirely — an
 * artisan process writes a folder, and the open page has to notice.
 *
 * Two things have to be true, and only one of them is "the row appeared":
 *
 *   1. the new folder shows up in a page nobody touched, and
 *   2. the page never reloaded to get it.
 *
 * (2) is the one worth testing, because a reload would satisfy (1) and defeat
 * the whole point. So a sentinel goes on `window` before the change and has to
 * still be there afterwards — a navigation of any kind wipes it.
 *
 * Needs the app, a Reverb server, and BROADCAST_CONNECTION=reverb:
 *
 *   php artisan reverb:start --host=127.0.0.1 --port=8080 &
 *   DB_CONNECTION=sqlite DB_DATABASE=$DB BROADCAST_CONNECTION=reverb \
 *     REVERB_HOST=127.0.0.1 REVERB_PORT=8080 REVERB_SCHEME=http \
 *     php artisan serve --port=8901 &
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/live-updates.mjs
 */

import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901'
const DB = process.env.TMA_DB
const WAIT_MS = 20000

if (!DB) {
  console.error('Set TMA_DB to the throwaway sqlite path.')
  process.exit(1)
}

const stamp = String(process.pid)
const FOLDER = `Live Test ${stamp}`

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

  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button:has-text("Yes, stay signed in")'),
    ])
    await page.waitForTimeout(300)
  }

  if (page.url().includes('/auth/')) throw new Error(`stuck on auth: ${page.url()}`)
}

/** Create a folder from outside the browser, the way a colleague's session would. */
function createFolderExternally() {
  const php = `
    $u = App\\Models\\User::where('email', 'e2e@example.com')->firstOrFail();
    App\\Models\\Folder::create([
      'uuid' => (string) Illuminate\\Support\\Str::uuid(),
      'name' => '${FOLDER}',
      'owner_id' => $u->id,
      'created_by' => $u->id,
    ]);
    echo 'created';
  `
  return run('php', ['artisan', 'tinker', '--execute', php], {
    env: {
      ...process.env,
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: DB,
      DB_URL: '',
      BROADCAST_CONNECTION: 'reverb',
      REVERB_HOST: '127.0.0.1',
      REVERB_PORT: '8080',
      REVERB_SCHEME: 'http',
    },
  })
}

let failures = 0
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch()
const page = await browser.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(e.message))

// A live refresh is an HTTP refetch; seeing it (or not) separates "the signal
// never arrived" from "it arrived and the list still didn't change".
const refetches = []
page.on('request', (r) => {
  // The list call specifically — not thumbnails, presence or sync status.
  if (/\/portal\/files\/\?section=/.test(r.url())) refetches.push(Date.now())
})

await signIn(page)

await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500) // let the socket connect and subscribe

console.log('\nLive updates — File Library\n')

const socketOpen = await page.evaluate(() => {
  const rt = window.TMAMessagingRealtime
  return !!(rt && rt.socketId)
})
check(socketOpen, 'websocket connected and has a socket id')

const registered = await page.evaluate(() => !!window.TMALive)
check(registered, 'TMALive registry present')

// Anything that survives only in memory: a full page load destroys it.
await page.evaluate(() => { window.__liveSentinel = 'alive' })

const before = await page.evaluate((name) => document.body.innerText.includes(name), FOLDER)
check(!before, 'folder is not on the page yet')

// Only what happens from here on tells us whether the signal worked.
refetches.length = 0
const t0 = Date.now()

await createFolderExternally()
console.log(`  ..    created "${FOLDER}" from an artisan process`)

let appeared = false
const deadline = Date.now() + WAIT_MS
while (Date.now() < deadline) {
  appeared = await page.evaluate((name) => document.body.innerText.includes(name), FOLDER)
  if (appeared) break
  await page.waitForTimeout(400)
}

check(appeared, `folder appeared without a refresh (within ${WAIT_MS / 1000}s)`)

if (!appeared) {
  const seen = await page.evaluate(() => ({
    hidden: document.hidden,
    visibility: document.visibilityState,
    names: Array.from(document.querySelectorAll('[data-name], .tma-file-name, td'))
      .map((el) => el.textContent.trim())
      .filter(Boolean)
      .slice(0, 25),
  }))
  console.log('        document.hidden :', seen.hidden, '/', seen.visibility)
  console.log('        refetches fired :', refetches.length)
  console.log('        names on page   :', JSON.stringify(seen.names))

  // Ask the same endpoint the view uses. If the row is missing here too, the
  // browser was never the problem.
  const api = await page.evaluate(async (name) => {
    const r = await fetch('/portal/files/?section=all&sort=name&dir=asc&perPage=200', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    })
    const j = await r.json()
    const folders = (j.folders || []).map((f) => f.name)
    return { count: folders.length, has: folders.includes(name), folders: folders.slice(-6) }
  }, FOLDER)
  console.log('        API returns it  :', api.has, `(${api.count} folders, last:`, JSON.stringify(api.folders) + ')')
}

const sentinel = await page.evaluate(() => window.__liveSentinel)
check(sentinel === 'alive', 'page never reloaded (sentinel survived)')

check(errors.length === 0, `no uncaught page errors${errors.length ? ': ' + errors[0] : ''}`)

/* ── Users and Clients ─────────────────────────────────────────────────
 *
 * Same shape as the File Library check: change it from outside the browser,
 * and the open table has to show it without navigating.
 */
async function tinker(php) {
  return run('php', ['artisan', 'tinker', '--execute', php], {
    env: {
      ...process.env,
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: DB,
      DB_URL: '',
      BROADCAST_CONNECTION: 'reverb',
      REVERB_HOST: '127.0.0.1',
      REVERB_PORT: '8080',
      REVERB_SCHEME: 'http',
    },
  })
}

/** Open `path`, make a change elsewhere, and wait for the table to show it. */
async function liveTable(label, path, needle, php) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await page.evaluate(() => { window.__tableSentinel = 'alive' })

  await tinker(php)

  let seen = false
  const until = Date.now() + WAIT_MS
  while (Date.now() < until) {
    seen = await page.evaluate((n) => document.body.innerText.includes(n), needle)
    if (seen) break
    await page.waitForTimeout(400)
  }

  check(seen, `${label}: "${needle}" appeared without a refresh`)
  const alive = await page.evaluate(() => window.__tableSentinel)
  check(alive === 'alive', `${label}: page never reloaded`)
}

console.log('\nLive updates — Users\n')

const NEW_USER = `Live User ${stamp}`
await liveTable('users', '/users', NEW_USER, `
  $u = App\\Models\\User::create([
    'name' => '${NEW_USER}',
    'email' => 'live${stamp}@example.com',
    'password' => Illuminate\\Support\\Facades\\Hash::make('password12345'),
  ]);
  $u->forceFill(['email_verified_at' => now(), 'status' => 'approved', 'account_type' => 'Employee'])->save();
  echo 'made';
`)

console.log('\nLive updates — Clients\n')

const NEW_CLIENT = `Live Client ${stamp}`
await liveTable('clients', '/clients', NEW_CLIENT, `
  App\\Models\\Client::create([
    'uid' => 'live-${stamp}',
    'name' => '${NEW_CLIENT}',
    'email' => 'client${stamp}@example.com',
    'data' => [],
    'created_by' => App\\Models\\User::where('email','e2e@example.com')->value('id'),
  ]);
  echo 'made';
`)

/* ── account type ──────────────────────────────────────────────────────
 *
 * The opposite assertion to the one above, and deliberately so: a changed
 * account type *must* reload. TMAPortalAccess.apply() only removes nav rows,
 * so re-running it after a promotion cannot restore rows already deleted —
 * the newly-allowed sections would stay invisible, which is precisely what
 * whoever changed the account type is watching for.
 *
 * So here the sentinel has to die.
 */
console.log('\nLive updates — account type\n')

async function setAccountType(type) {
  return run('php', ['artisan', 'tinker', '--execute', `
    $u = App\\Models\\User::where('email','e2e@example.com')->firstOrFail();
    $u->forceFill(['account_type' => '${type}'])->save();
    echo 'set';
  `], {
    env: {
      ...process.env,
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: DB,
      DB_URL: '',
      BROADCAST_CONNECTION: 'reverb',
      REVERB_HOST: '127.0.0.1',
      REVERB_PORT: '8080',
      REVERB_SCHEME: 'http',
    },
  })
}

try {
  await page.evaluate(() => { window.__typeSentinel = 'alive' })

  const capsBefore = await page.evaluate(() => window.TMAPortalAccess.capabilities().length)

  await setAccountType('Employee')
  console.log('  ..    demoted Administrator -> Employee from an artisan process')

  let reloaded = false
  const end = Date.now() + WAIT_MS
  while (Date.now() < end) {
    // Survives navigation only if the page never reloaded.
    const alive = await page.evaluate(() => window.__typeSentinel).catch(() => null)
    if (alive !== 'alive') { reloaded = true; break }
    await page.waitForTimeout(400)
  }

  check(reloaded, `page reloaded itself on the account-type change (within ${WAIT_MS / 1000}s)`)

  await page.waitForTimeout(1500)
  const capsAfter = await page.evaluate(() =>
    (window.TMAPortalAccess && window.TMAPortalAccess.capabilities().length) || 0)

  check(capsAfter > 0, 'capabilities re-resolved after the reload')
  check(capsAfter < capsBefore, `capability set shrank (${capsBefore} -> ${capsAfter})`)
} finally {
  // Leave the account as we found it so the suite is re-runnable.
  await setAccountType('Administrator')
}

await browser.close()

console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
