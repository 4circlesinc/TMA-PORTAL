/*
 * Client document review, in the browser.
 *
 * The server side is covered by tests/Feature/ClientDocumentReviewTest.php.
 * What only a browser can answer is whether the status actually reaches the
 * two places staff look at it — the File Library listing and the client's own
 * Documents tab — and whether that tab still draws every document as the same
 * generic page icon.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/client-document-review.mjs
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

const tinker = (php) => run('php', ['artisan', 'tinker', '--execute', php], {
  env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '' },
})

const stamp = String(process.pid)

// A client, its folder, a default subfolder, and documents of three types.
const { stdout } = await tinker(`
  $u = App\\Models\\User::where('email','e2e@example.com')->firstOrFail();
  $c = App\\Models\\Client::create(['uid'=>'rev-${stamp}','name'=>'Review Client ${stamp}','email'=>'rev${stamp}@example.com','data'=>[],'created_by'=>$u->id]);
  $root = App\\Models\\Folder::create(['uuid'=>(string)Illuminate\\Support\\Str::uuid(),'name'=>'Review Client ${stamp}','folder_type'=>'client','client_id'=>$c->id,'owner_id'=>$u->id,'created_by'=>$u->id]);
  // FolderProvisioner links both ends in the real flow; the Documents tab
  // reads client.folder_id and shows "folder isn't ready yet" without it.
  $c->forceFill(['folder_id'=>$root->id])->save();
  $sub = App\\Models\\Folder::create(['uuid'=>(string)Illuminate\\Support\\Str::uuid(),'name'=>'Citizenship Applications','parent_id'=>$root->id,'owner_id'=>$u->id,'created_by'=>$u->id]);
  foreach ([['Passport.pdf','pdf','application/pdf'],['Application.docx','docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['Photo.png','png','image/png']] as $f) {
    App\\Models\\FileItem::create(['uuid'=>(string)Illuminate\\Support\\Str::uuid(),'folder_id'=>$sub->id,'name'=>$f[0],'extension'=>$f[1],'mime_type'=>$f[2],'size'=>2048,'disk'=>'local','storage_path'=>'vault/contract.pdf','owner_id'=>$u->id,'uploaded_by'=>$u->id]);
  }
  echo $sub->uuid;
`)
const subUuid = stdout.trim().split('\n').pop().trim()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
await page.click('text=Sign in with Email')
await page.waitForSelector('input[name="email"]', { state: 'visible' })
await page.fill('input[name="email"]', 'e2e@example.com')
await page.fill('input[name="password"]', 'password12345')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]:visible')])
await page.waitForTimeout(400)
if (page.url().includes('/auth/stay-signed-in')) {
  // Two forms post the same route, told apart by a hidden `stay` value, and
  // the buttons read "Yes" / "Not this time" — the old "Yes, stay signed in"
  // text stopped matching and the run stalled here on an empty shell.
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]:visible')])
}

console.log('\nClient document review\n')

/* ── the status reaches the listing ── */

await page.goto(`${BASE}/folders/all?folder=${subUuid}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-files-row]')).map((r) => ({
  name: (r.querySelector('[data-files-name]') || {}).textContent,
  badge: (r.querySelector('.tma-portal-status') || {}).textContent || null,
})))

check(rows.length === 3, `three documents listed (got ${rows.length})`)
check(rows.every((r) => r.badge === 'Application review'),
  `every uploaded client document starts Application review (${rows.map((r) => r.badge).join(', ')})`)

/* ── a reviewer can move it on ── */

await page.locator('[data-files-row]')
  .filter({ has: page.locator('[data-files-name]', { hasText: 'Passport.pdf' }) })
  .first().locator('.tma-portal-cell--type').dblclick()
await page.waitForTimeout(3000)

const picker = page.locator('[data-lb-review-open]')
check(await picker.count() > 0, 'the viewer offers a status picker')

if (await picker.count()) {
  await picker.first().click()
  await page.waitForTimeout(800)

  const options = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.tma-portal-context-menu button, .tma-portal-menu button, [class*="menu"] button'))
      .map((b) => b.textContent.trim())
      .filter((t) => /application review|update required|ready for submission/i.test(t)))

  check(options.length >= 3, `every status listed (${options.join(' | ')})`)
  check(options.some((t) => t.includes('✓')), 'the current status is marked')

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.tma-portal-context-menu button, .tma-portal-menu button, [class*="menu"] button'))
      .find((b) => /ready for submission/i.test(b.textContent) && !b.disabled)
    if (btn) btn.click()
  })
  await page.waitForTimeout(2500)
}

const after = await tinker(`
  echo App\\Models\\FileItem::where('name','Passport.pdf')->latest('id')->value('review_status');
`)
check(after.stdout.includes('ready_for_submission'), 'the status persisted to the database')

await page.keyboard.press('Escape')
await page.waitForTimeout(1000)

/* ── the client's Documents tab: real icons, and the status ── */

await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const docs = await page.evaluate(async (uuid) => {
  const r = await fetch('/portal/files/?folder=' + uuid + '&perPage=200', {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  })
  const j = await r.json()
  return (j.files || []).map((f) => ({ name: f.name, icon: f.icon, status: f.status && f.status.label }))
}, subUuid)

check(docs.length === 3, 'the client folder payload carries its documents')
check(docs.every((d) => d.status), 'every document carries a status for the client view')

const icons = new Set(docs.map((d) => d.icon))
check(icons.size > 1, `documents carry distinct type icons, not one generic file (${[...icons].join(', ')})`)

/* ── a client document opens in the library's own viewer ── */

/*
 * Driven through the seam rather than the directory UI.
 *
 * Reaching the tab means finding one client among many in a paginated list
 * with no address of its own (/clients/{uid} is not in SPA_PAGES), and that
 * navigation is not what is under test here — the handoff is. This calls the
 * exact API the Documents tab now calls, with a row shaped exactly as that
 * list holds it, and checks the viewer opens in place rather than in a tab.
 */
await page.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

check(await page.evaluate(() => !!(window.TMAFileActions && window.TMAFileActions.open)),
  'TMAFileActions.open exists for lists outside the File Library')

const tabsBefore = page.context().pages().length

const opened = await page.evaluate(async (uuid) => {
  const r = await fetch('/portal/files/?folder=' + uuid + '&perPage=200', {
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
  })
  const j = await r.json()
  const file = (j.files || [])[0]
  if (!file) return { ok: false }

  window.TMAFileActions.open(file)

  return { ok: true, name: file.name }
}, subUuid)

check(opened.ok, `handed a client document to the viewer (${opened.name || 'none'})`)
await page.waitForTimeout(3500)

check(await page.evaluate(() => !!document.querySelector('.tma-portal-viewer')),
  'it opens in the File Library viewer, in place')
check(page.context().pages().length === tabsBefore, 'and does not open a browser tab')
check(await page.evaluate(() => !!document.querySelector('.tma-portal-viewer__tabs')),
  'with the full panel — comments, versions, review')
check(await page.evaluate(() => !!document.querySelector('[data-lb-review-open]')),
  'and its review controls')

await browser.close()
console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
