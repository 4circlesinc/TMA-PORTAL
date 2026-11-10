/*
 * Swiping between tabs on a phone: CIP Applications' lists and an
 * application's own tabs (tab-swipe.js).
 *
 *   node tests/Browser/cip-tab-swipe.mjs
 *
 * Serves the real shell and public/ with the few answers the page needs, and
 * swipes with real touch input (CDP), not synthetic DOM events: what is under
 * test is whether a finger moves the page, scrolls it, or opens a row.
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')
const SHELL = resolve('resources/views/pages/dashboard.html')
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

const ME = {
  id: 1, name: 'Ava Admin', firstName: 'Ava', email: 'ava@example.com', isStaff: true, isAdmin: true,
  capabilities: ['clients.view', 'clients.manage', 'clients.assign', 'cip.view', 'cip.review', 'cip.application', 'cip.decide', 'cip.compliance', 'cip.assign'],
}
const PHASES = ['pre_approval', 'post_approval', 'add_on']
const APPS = Array.from({ length: 9 }, (_, i) => ({
  id: 101 + i, clientUid: 'c-' + (i + 1), number: 'CIP-' + (2001 + i), status: 'submitted', phase: PHASES[i % 3],
  applicantName: 'Applicant ' + (i + 1),
  applicant: { name: 'Applicant ' + (i + 1), documents: [] }, sponsor: { name: 'Sponsor', documents: [] }, dependents: [],
  provider: 'Provider Co', investmentType: 'NDF', familyLabel: '2 people', assignedTo: [],
}))

function answer(path, query) {
  if (path === '/me') return ME
  if (path === '/portal/cip/applications') {
    const phase = query.get('phase')
    const rows = phase ? APPS.filter(a => a.phase === phase) : APPS
    return { applications: rows, page: 1, lastPage: 1, total: rows.length, phaseCounts: { pre_approval: 3, post_approval: 3, add_on: 3 } }
  }
  const held = path.match(/^\/portal\/cip\/clients\/([^/]+)\/application$/)
  if (held) {
    const a = APPS.find(x => x.clientUid === held[1]) || APPS[0]
    return { application: a, client: { id: a.clientUid, name: a.applicantName } }
  }
  const client = path.match(/^\/portal\/clients\/([^/]+)$/)
  if (client) return { client: { id: client[1], name: 'Applicant', email: 'a@example.com' } }
  if (/\/events$/.test(path)) return { events: [] }
  if (/\/messages$/.test(path)) return { messages: [] }
  if (/\/assignments$/.test(path)) return { assignments: [], history: [], assignable: [] }
  return {}
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  const ext = extname(path)
  if (ext && ext !== '.html') {
    try {
      const file = join(PUBLIC, path)
      await stat(file)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
    return
  }
  if (path === '/me' || path.startsWith('/me/') || path.startsWith('/portal/') || path.startsWith('/broadcasting') || path === '/up') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(answer(path, url.searchParams)))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(await readFile(SHELL))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch()
} catch (e) {
  browser = await chromium.launch({ channel: 'chrome' })
}

let failures = 0
function check(ok, label) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
  if (!ok) failures += 1
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1') } catch (e) { /* asked instead */ } })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

async function touch(type, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
}

/* A swipe by (dx, dy) in `steps` moves `ms` apart; `mid` runs in the page
   three quarters of the way through, before the finger lifts. */
async function swipe(x0, y0, dx, dy, { steps = 12, ms = 16, mid = null } = {}) {
  await touch('touchStart', x0, y0)
  let seen = null
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x0 + dx * i / steps, y0 + dy * i / steps)
    await page.waitForTimeout(ms)
    if (mid && i === Math.round(steps * 0.75)) seen = await page.evaluate(mid)
  }
  await touch('touchEnd', x0 + dx, y0 + dy)
  await page.waitForTimeout(650)
  return seen
}

const listTab = () => page.evaluate(() => {
  const on = document.querySelector('[data-clients-head-tabs] [role=tab][aria-selected=true]')
  return on && on.getAttribute('data-clients-list-tab')
})
const appTabs = () => page.evaluate(() => {
  const list = document.querySelector('.tma-dash__clients-profile-tablist')
  const tabs = list ? [...list.querySelectorAll('[role=tab]')] : []
  const on = tabs.find(t => t.getAttribute('aria-selected') === 'true')
  return { tabs: tabs.map(t => t.getAttribute('data-clients-tab')), on: on && on.getAttribute('data-clients-tab'), url: location.pathname + location.search }
})
const openFirstApplication = async () => {
  await page.evaluate(() => document.querySelector('.tma-cip-table tbody tr[data-cip-open]').click())
  await page.waitForTimeout(1800)
}

try {
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  // The static shell has no boot handoff, so the hub is mounted by hand.
  await page.evaluate(() => {
    const view = document.querySelector('[data-view=clients]')
    if (view) view.hidden = false
    window.TMAClients.mount(document.querySelector('[data-clients]'))
  })
  await page.waitForTimeout(1500)

  console.log('\nCIP Applications, the lists')
  check(await listTab() === 'all_applications', 'starts on All')
  const mid = await swipe(300, 650, -220, 6, {
    mid: () => ({
      t: document.querySelector('[data-clients]').style.transform,
      wide: document.scrollingElement.scrollWidth > innerWidth,
    }),
  })
  check(/translate3d\(-1\d\dpx/.test(mid.t), `the list goes with the finger (${mid.t})`)
  check(!mid.wide, 'no sideways page scroll while dragging')
  check(await listTab() === 'pre_approval', 'swipe left: Pre-Approval')
  check(await page.evaluate(() => document.querySelectorAll('.tma-cip-table tbody tr[data-cip-app]').length) === 3, 'its rows are shown')
  check(await page.evaluate(() => location.pathname) === '/citizenship-applications', 'the swipe did not open the row it ended on')
  check(!(await page.evaluate(() => document.querySelector('[data-clients]').getAttribute('style') || '')), 'no motion left behind')

  await swipe(300, 650, -220, 0)
  check(await listTab() === 'post_approval', 'swipe left again: Post-Approval')
  await page.waitForTimeout(400)
  check(await page.evaluate(() => {
    const row = document.querySelector('[data-clients-head-tabs] .tma-tab-group')
    const a = row.querySelector('[aria-selected=true]').getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return a.left >= r.left - 1 && a.right <= r.right + 1
  }), 'the lit tab is in sight on the tab row')
  await swipe(90, 650, 220, 0)
  await swipe(90, 650, 220, 0)
  check(await listTab() === 'all_applications', 'swipe right twice: All')

  const band = await swipe(90, 650, 220, 0, { mid: () => document.querySelector('[data-clients]').style.transform })
  const give = Math.abs(parseFloat(String(band).replace(/^[^-\d]+/, '')) || 0)
  check(give > 0 && give < 80, `past the first tab it only gives a little (${band})`)
  check(await listTab() === 'all_applications', '...and stays on All')

  await swipe(200, 700, 14, -300)
  check(await listTab() === 'all_applications', 'a vertical scroll is not a swipe')
  await swipe(250, 650, -60, 0, { steps: 12, ms: 40 })
  check(await listTab() === 'all_applications', 'a short slow drag settles back')
  await swipe(250, 650, -80, 0, { steps: 4, ms: 4 })
  check(await listTab() === 'pre_approval', 'a quick flick goes')
  await swipe(150, 650, 80, 0, { steps: 4, ms: 4 })
  check(await listTab() === 'all_applications', 'a quick flick back')

  await swipe(10, 650, 250, 0)
  check(await listTab() === 'all_applications', 'from the left edge: not a tab swipe (the menu and back live there)')
  await swipe(382, 650, -250, 0)
  check(await listTab() === 'all_applications', 'from the right edge: not a tab swipe')
  const field = await page.evaluate(() => {
    const r = document.querySelector('[data-clients] input').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await swipe(field.x + 60, field.y, -150, 0)
  check(await listTab() === 'all_applications', 'on the search field: not a tab swipe')

  console.log('\nAn application, its own tabs')
  await openFirstApplication()
  const first = await appTabs()
  check(first.tabs.length >= 2 && first.on === first.tabs[0], `opens on ${first.on} of ${first.tabs.join(', ')}`)
  const parts = await swipe(300, 600, -220, 4, {
    mid: () => {
      const d = document.querySelector('.tma-dash__clients-detail')
      return {
        row: !!d.querySelector('.tma-dash__clients-profile-tablist').style.transform,
        moving: [...d.children].filter(c => c.style.transform).length,
        page: !!document.querySelector('[data-clients]').style.transform,
      }
    },
  })
  check(parts && !parts.row && parts.moving > 0 && !parts.page, 'the panels move; the tab row, the header and the list tabs do not')
  const second = await appTabs()
  check(second.on === first.tabs[1], `swipe left: ${second.on}`)
  check(/[?&]tab=/.test(second.url), `the address follows (${second.url})`)
  await swipe(90, 600, 220, 0)
  check((await appTabs()).on === first.on, `swipe right: ${first.on}`)

  check(await page.evaluate(() => getComputedStyle(document.querySelector('.tma-dash__clients-detail')).touchAction) === 'pan-y pinch-zoom',
    'on a phone the browser leaves sideways movement to the swipe (touch-action)')
  const row = await page.evaluate(() => {
    const l = document.querySelector('.tma-dash__clients-profile-tablist')
    l.scrollLeft = 0
    const r = l.getBoundingClientRect()
    return { y: r.top + r.height / 2, room: l.scrollWidth - l.clientWidth }
  })
  await swipe(300, row.y, -200, 0)
  const rowAfter = await page.evaluate(() => document.querySelector('.tma-dash__clients-profile-tablist').scrollLeft)
  check(row.room <= 0 || rowAfter > 20, `the tab row itself still scrolls under a finger (${rowAfter}px of ${row.room})`)
  check((await appTabs()).on === first.on, '...without changing the tab')

  await swipe(10, 600, 250, 0)
  await page.waitForTimeout(600)
  check(await page.evaluate(() => location.pathname) === '/citizenship-applications', 'the left edge is still back, to the list')

  await openFirstApplication()
  await page.evaluate(() => document.querySelector('[data-clients-tab="messages"]').click())
  await page.waitForTimeout(1200)
  const box = await page.evaluate(() => {
    const r = document.querySelector('.tma-cip-thread__composer textarea').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await swipe(box.x + 60, box.y, -180, 0)
  check((await appTabs()).on === 'messages', 'on the message box: not a tab swipe')
  // Across the facts strip, which every tab of an application shows.
  await page.evaluate(() => document.querySelector('[data-clients-tab="overview"]').click())
  await page.waitForTimeout(600)
  const strip = await page.evaluate(() => {
    const r = document.querySelector('.tma-dash__cip-strip').getBoundingClientRect()
    return r.top + r.height / 2
  })
  for (let i = 0; i <= first.tabs.length; i++) await swipe(300, strip, -220, 0)
  check((await appTabs()).on === first.tabs[first.tabs.length - 1], 'swiping on stops at the last tab')
  check(await page.evaluate(() => [...document.querySelectorAll('.tma-dash__clients-detail > *')]
    .filter(c => c.style.transform || c.style.opacity).length) === 0, 'no motion left behind on the panels')

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
} finally {
  await browser.close()
  server.close()
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
