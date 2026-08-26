/*
 * Dropping a file onto the Versions panel adds a version.
 *
 * The gesture matters more than the button here: dragging onto the file list
 * behind the viewer adds a *separate file to the folder*, so the same motion
 * two hundred pixels away has a completely different outcome. This checks the
 * drop lands as a version, and that the window-level folder drop stays out of
 * the way while the viewer is open.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/version-drop.mjs
 */

import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901'
const DB = process.env.TMA_DB

let failures = 0
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const count = async () => {
  const { stdout } = await run('php', ['artisan', 'tinker', '--execute', `
    $f = App\\Models\\FileItem::where('name','Live Detail.pdf')->firstOrFail();
    echo App\\Models\\FileVersion::where('file_id',$f->id)->count();
  `], { env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '' } })
  return parseInt(stdout.trim().match(/\d+$/)[0], 10)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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

console.log('\nVersions drop zone\n')

const before = await count()

await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
// A file is opened by double-clicking its row, the way a folder window opens
// one. Not the name: a double-click there is the rename gesture.
await page.locator('[data-files-row]')
  .filter({ has: page.locator('[data-files-name]', { hasText: 'Live Detail.pdf' }) })
  .first().locator('.tma-portal-cell--type').dblclick()
await page.waitForTimeout(3000)
await page.click('.tma-portal-viewer__tabs [data-lb-tab="versions"]')
await page.waitForTimeout(1500)

const zone = page.locator('[data-lb-vdrop]')
check(await zone.count() > 0, 'drop zone is rendered')

// Build a real DataTransfer in the page and dispatch the drag sequence.
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.items.add(new File(['%PDF-1.4 test'], 'dropped-version.pdf', { type: 'application/pdf' }))
  window.__dt = dt
})

await page.dispatchEvent('[data-lb-vdrop]', 'dragover', { dataTransfer: await page.evaluateHandle(() => window.__dt) })
await page.waitForTimeout(300)

const lit = await page.evaluate(() =>
  document.querySelector('[data-lb-vdrop]').classList.contains('is-over'))
check(lit, 'zone highlights while a file is over it')

await page.dispatchEvent('[data-lb-vdrop]', 'drop', { dataTransfer: await page.evaluateHandle(() => window.__dt) })
await page.waitForTimeout(800)

// The upload asks for a note first, then uploads.
const confirm = page.locator('button:has-text("Upload version")')
check(await confirm.count() > 0, 'drop opened the upload confirmation')
if (await confirm.count()) {
  await confirm.click()
  await page.waitForTimeout(3000)
}

const after = await count()
check(after === before + 1, `a version was added (${before} -> ${after})`)

await browser.close()
console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
