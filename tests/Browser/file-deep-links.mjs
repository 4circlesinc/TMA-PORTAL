/*
 * Deep links in the File Library.
 *
 * Where you are has to be in the URL: reloading inside a folder should reload
 * that folder, and reloading with a file open should reopen that file's
 * viewer — not drop you back at All Files, which on a hard refresh mid-read
 * meant finding your way back through the tree.
 *
 * The test reloads for real (page.reload) rather than re-navigating, because a
 * fresh navigation would pass through mount() the same way a click does and
 * would not prove anything about restoring from the address bar.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/file-deep-links.mjs
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

const FOLDER = `Deep ${process.pid}`
const FILE = `Deep File ${process.pid}.pdf`

// A folder with a file inside it, so there is somewhere to be that is not the
// top of the library.
await run('php', ['artisan', 'tinker', '--execute', `
  $id = App\\Models\\User::where('email','e2e@example.com')->value('id');
  $f = App\\Models\\Folder::create([
    'uuid' => (string) Illuminate\\Support\\Str::uuid(),
    'name' => '${FOLDER}', 'owner_id' => $id, 'created_by' => $id,
  ]);
  App\\Models\\FileItem::create([
    'uuid' => (string) Illuminate\\Support\\Str::uuid(),
    'folder_id' => $f->id, 'name' => '${FILE}', 'extension' => 'pdf',
    'mime_type' => 'application/pdf', 'size' => 876,
    'disk' => 'local', 'storage_path' => 'vault/contract.pdf',
    'owner_id' => $id, 'uploaded_by' => $id,
  ]);
  echo $f->uuid;
`], { env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '' } })

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

console.log('\nFile Library deep links\n')

await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* ── into a folder ── */

// Folders and files alike open on a double-click of the row; the name itself
// is the rename gesture, so these take the cell beside it.
await page.locator('[data-files-row]')
  .filter({ has: page.locator('[data-files-name]', { hasText: FOLDER }) })
  .first().locator('.tma-portal-cell--type').dblclick()
await page.waitForTimeout(2500)

check(/[?&]folder=/.test(page.url()), `URL carries the folder (${page.url().split('?')[1] || 'no query'})`)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

check(/[?&]folder=/.test(page.url()), 'folder still in the URL after a reload')
check(await page.evaluate((n) => document.body.innerText.includes(n), FILE),
  'reload landed back inside the folder, not at All Files')

/* ── with a file open ── */

await page.locator('[data-files-row]')
  .filter({ has: page.locator('[data-files-name]', { hasText: FILE }) })
  .first().locator('.tma-portal-cell--type').dblclick()
await page.waitForTimeout(3500)

const viewerOpen = () => page.evaluate(() => !!document.querySelector('.tma-portal-viewer'))

check(await viewerOpen(), 'viewer opened')
check(/[?&]file=/.test(page.url()), 'URL carries the open file')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)

check(await viewerOpen(), 'reload reopened the viewer on that file')
check(/[?&]file=/.test(page.url()), 'file still in the URL after a reload')

/* ── back button ── */

await page.goBack({ waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)

check(!(await viewerOpen()), 'Back closed the viewer instead of leaving the page')
check(/[?&]folder=/.test(page.url()) && !/[?&]file=/.test(page.url()),
  'Back left us in the folder with no file')

await browser.close()
console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
