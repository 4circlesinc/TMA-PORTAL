/*
 * Picking files the way a file manager picks them.
 *
 * Every list of files in the portal used to carry a column of checkboxes: a
 * box per row, a box in the header, and a bulk toolbar behind them. Nothing
 * else people file things with works that way, so the boxes are gone and the
 * rows are picked the way Finder, Explorer, Drive and SharePoint pick them —
 * a click takes one, Shift takes the run in between, Ctrl (Cmd on a Mac) adds
 * or drops one, a double-click opens, and the right button carries the
 * actions, over the whole selection when the row is part of one.
 *
 * The rules live in one module (`TMAFileSelect`) precisely so the File
 * Library, the dashboard's Recent Files table and Overview's Files tab cannot
 * drift apart — which is why this test drives all three rather than the
 * library alone.
 *
 * Two gestures are easy to get wrong and are checked explicitly:
 *
 *   - A double-click on the *name* is the rename gesture and always was, so
 *     "open" has to be a double-click on a cell beside it. A test that
 *     double-clicks the name and waits for a viewer is testing rename.
 *   - Ctrl-click is a right-click on macOS. The additive modifier there is
 *     Cmd, which is why `ADD` is picked from the platform rather than
 *     hard-coded — the portal accepts either, the harness cannot.
 *
 * Needs an approved staff account with a few folders and files in the library.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/file-selection.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899'
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com'

let failures = 0
const check = (ok, label) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }
const step = (n, t) => console.log(`\n${n}. ${t}`)

/* Cmd on a Mac, Ctrl everywhere else: Ctrl-click on macOS is a right-click. */
const ADD = process.platform === 'darwin' ? 'Meta' : 'Control'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.click('text=Sign in with Email')
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', 'password12345')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ])
  await page.waitForTimeout(700)
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ])
    await page.waitForTimeout(600)
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed')
}

/* The desktop sidebar can be set to Hover Overlay and expands over the left of
   the table, so the pointer is parked on the right before every gesture. */
const park = () => page.mouse.move(1400, 850)

const rows = () => page.locator('[data-files-body] [data-files-row]')
const picked = () => page.locator('[data-files-body] [data-files-row].tma-portal-table__row--selected').count()
/* A cell beside the name: the name's own double-click renames. */
const cell = (i) => rows().nth(i).locator('.tma-portal-cell--type')
const toolbar = async () => ((await page.textContent('.tma-dash__toolbar-selection').catch(() => '')) || '').trim()
const menuItems = () => page.evaluate(() => {
  const el = document.querySelector('.tma-portal-context-menu')
  return el ? [...el.querySelectorAll('[data-ctx]')].map((b) => b.textContent.trim()) : null
})

try {
  step(1, 'The File Library lists files and offers no checkboxes')
  await signIn()
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-files-body] [data-files-row]', { timeout: 20000 })
  await page.waitForTimeout(900)
  const n = await rows().count()
  // Five is the minimum the range and toggle steps below need.
  check(n >= 5, `rows listed (${n})`)
  check(await page.evaluate(() => !!window.TMAFileSelect), 'TMAFileSelect is loaded')
  check(await page.evaluate(() => document.querySelectorAll('[data-files-body] input[type=checkbox]').length === 0),
    'not one checkbox in the list')

  step(2, 'A click picks exactly one row')
  await park()
  await cell(0).click()
  await page.waitForTimeout(400)
  check(await picked() === 1, `one row picked (${await picked()})`)
  check((await toolbar()).includes('1 Selected'), `the toolbar reads "1 Selected" (got "${await toolbar()}")`)

  step(3, 'Shift-click takes the run in between')
  await cell(3).click({ modifiers: ['Shift'] })
  await page.waitForTimeout(400)
  check(await picked() === 4, `four rows picked (${await picked()})`)

  step(4, 'Ctrl-click drops one back out')
  await cell(1).click({ modifiers: [ADD] })
  await page.waitForTimeout(400)
  check(await picked() === 3, `three rows picked (${await picked()})`)

  step(5, 'A plain click collapses the selection again')
  // Including a click on a row that is already part of it — the selection
  // becomes that row, it does not keep the other two.
  await cell(2).click()
  await page.waitForTimeout(400)
  check(await picked() === 1, `back to one (${await picked()})`)

  step(6, 'Ctrl+A takes the page, Escape lets go')
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(400)
  check(await picked() === n, `all ${n} picked (${await picked()})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  check(await picked() === 0, `nothing picked (${await picked()})`)

  step(7, 'Right-click inside a selection is about the whole selection')
  await cell(0).click()
  await page.waitForTimeout(300)
  await cell(2).click({ modifiers: ['Shift'] })
  await page.waitForTimeout(400)
  await cell(1).click({ button: 'right' })
  await page.waitForTimeout(600)
  const multi = await menuItems()
  check(!!multi, 'a menu opened')
  check(!!multi && multi.some((m) => m === 'Delete 3 items'),
    `it is about all three (${(multi || []).join(', ')})`)
  check(await picked() === 3, 'and the right-click kept the selection rather than collapsing it')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  step(8, 'Right-click outside it takes that row first')
  await cell(4).click({ button: 'right' })
  await page.waitForTimeout(600)
  const single = await menuItems()
  check(!!single && single.includes('Rename'), `a single-item menu (${(single || []).slice(0, 4).join(', ')})`)
  check(await picked() === 1, `and only that row is picked (${await picked()})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  step(9, 'A double-click on a folder row opens the folder')
  const folder = page.locator('[data-files-body] [data-files-row][data-type="folder"]').first()
  if (await folder.count()) {
    await park()
    await folder.locator('.tma-portal-cell--type').dblclick()
    await page.waitForTimeout(2200)
    check(/[?&]folder=/.test(page.url()), `the URL carries the folder (${page.url().split('?')[1] || 'no query'})`)
  } else {
    check(false, 'no folder to open — seed one')
  }

  step(10, 'A double-click on the name still renames in place')
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-files-body] [data-files-row]', { timeout: 20000 })
  await page.waitForTimeout(900)
  await park()
  await page.locator('[data-files-body] [data-files-name]').first().dblclick()
  await page.waitForTimeout(600)
  check(await page.locator('.tma-portal-rename-input').count() > 0, 'the inline rename field appeared')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  step(11, 'A double-click on a file row opens the viewer')
  const file = page.locator('[data-files-body] [data-files-row][data-type="file"]').first()
  await park()
  await file.locator('.tma-portal-cell--type').dblclick()
  await page.waitForTimeout(2500)
  check(await page.locator('.tma-portal-viewer').count() > 0, 'the viewer opened')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  step(12, 'The grid view picks cards the same way')
  await page.goto(`${BASE}/folders/all`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-files-body] [data-files-row]', { timeout: 20000 })
  await page.waitForTimeout(900)
  await park()
  const gridBtn = page.locator('[data-files-view="grid"]')
  if (await gridBtn.count()) {
    await gridBtn.first().click()
    await page.waitForTimeout(1000)
    const cards = page.locator('.tma-portal-file-card')
    check(await cards.count() > 2, `cards drawn (${await cards.count()})`)
    check(await page.evaluate(() => document.querySelectorAll('.tma-portal-file-card input[type=checkbox]').length === 0),
      'no checkboxes on the cards either')
    // Off the name and off the star: a corner of the card itself.
    await cards.nth(0).click({ position: { x: 20, y: 60 } })
    await page.waitForTimeout(400)
    await cards.nth(2).click({ position: { x: 20, y: 60 }, modifiers: ['Shift'] })
    await page.waitForTimeout(400)
    const on = await page.locator('.tma-portal-file-card.is-selected').count()
    check(on === 3, `three cards picked (${on})`)
    await page.locator('[data-files-view="table"]').first().click().catch(() => {})
    await page.waitForTimeout(600)
  } else {
    check(false, 'no grid toggle on the toolbar')
  }

  step(13, "The dashboard's Recent Files table picks rows the same way")
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-home-lib-row]', { timeout: 20000 })
  await page.waitForTimeout(1400)
  await park()
  const hrows = page.locator('[data-home-lib-row]')
  const hn = await hrows.count()
  check(hn >= 2, `dashboard rows listed (${hn})`)
  check(await page.evaluate(() => document.querySelectorAll('[data-home-lib-row] input[type=checkbox]').length === 0),
    'no checkboxes on the dashboard table')
  await hrows.nth(0).click()
  await page.waitForTimeout(500)
  check(await page.locator('[data-home-lib-row].is-selected').count() === 1, 'a click picks one row')
  await hrows.nth(hn - 1).click({ modifiers: ['Shift'] })
  await page.waitForTimeout(500)
  const hpicked = await page.locator('[data-home-lib-row].is-selected').count()
  check(hpicked === hn, `Shift-click takes the run (${hpicked}/${hn})`)
  await hrows.nth(1).click({ button: 'right' })
  await page.waitForTimeout(700)
  const hmenu = await menuItems()
  check(!!hmenu && hmenu.some((m) => /^Delete \d+ items$/.test(m)),
    `the right button carries the bulk actions (${(hmenu || []).join(', ')})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  step(14, "Overview's Files tab picks rows the same way")
  await page.goto(`${BASE}/overview`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const filesTab = page.locator('[data-overview-tab="Files"]')
  if (await filesTab.count()) {
    await filesTab.click()
    await page.waitForTimeout(2500)
    const ov = page.locator('[data-files-mounted] [data-files-row]')
    const ovn = await ov.count()
    check(ovn > 0, `overview file rows (${ovn})`)
    check(await page.evaluate(() => document.querySelectorAll('[data-files-mounted] input[type=checkbox]').length === 0),
      'no checkboxes on the Overview files table')
    if (ovn > 1) {
      await park()
      await ov.nth(0).click()
      await page.waitForTimeout(400)
      const sel = () => page.locator('[data-files-mounted] [data-files-row].tma-dash__ctr--selected').count()
      check(await sel() === 1, `a click picks one row (${await sel()})`)
      await ov.nth(Math.min(2, ovn - 1)).click({ modifiers: ['Shift'] })
      await page.waitForTimeout(400)
      check(await sel() === Math.min(3, ovn), `Shift-click takes the run (${await sel()})`)
      // The menu here is the File Library's, not a second three-item copy.
      await ov.nth(1).click({ button: 'right' })
      await page.waitForTimeout(700)
      const om = await menuItems()
      check(!!om && om.length > 3, `right-click opens the File Library's menu (${(om || []).slice(0, 4).join(', ')})`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
  } else {
    check(false, 'no Files tab on Overview for this account');
  }

  step(15, 'No page errors')
  check(errors.length === 0, `no page errors (${errors.length})`)
  errors.slice(0, 6).forEach((e) => console.log('      ' + e))
} catch (e) {
  failures += 1
  console.log(`\n✗ threw: ${e.message}`)
  await page.screenshot({ path: 'tests/Browser/file-selection.png' }).catch(() => {})
} finally {
  await browser.close()
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)
