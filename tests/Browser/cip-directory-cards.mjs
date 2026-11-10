/*
 * CIP Applications' Service providers and Provider contacts tabs answer a
 * narrow screen the way Post-Approval does: the same table component
 * (.tma-cip-table), cards from 1024px down, a sheet above.
 *
 *   node tests/Browser/cip-directory-cards.mjs
 *
 * They were the client grid's own div table, which kept 720px of columns
 * inside a phone's cards: names went missing, Sign as admin was squeezed and
 * every card and the pager ran off the right edge.
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
const APPS = Array.from({ length: 6 }, (_, i) => ({
  id: 101 + i, clientUid: 'c-' + (i + 1), number: 'CIP-' + (2001 + i), status: 'submitted', phase: i % 2 ? 'post_approval' : 'pre_approval',
  applicantName: 'Applicant ' + (i + 1), applicant: { name: 'Applicant ' + (i + 1), documents: [] }, sponsor: null, dependents: [],
  provider: 'Provider Co', investmentType: 'NDF', familyLabel: '2 people', assignedTo: [],
}))
// More than one page of providers (the page holds 100), with the long names
// and addresses that used to push things out of their cells.
const NAMES = ['Northstar CIP Consultants International Limited', 'Galaxy Advisory', 'Harbour Partners Limited']
const COMPANIES = Array.from({ length: 104 }, (_, i) => ({
  id: 'co-' + (i + 1), name: NAMES[i % 3] + ' ' + (i + 1), cipCode: 'SP-' + (100 + i),
  email: 'the.longest.office.address' + i + '@provider-firm-' + i + '.com', referredCount: i % 4, peopleCount: 1,
  people: i < 3 ? [{ id: 'p-' + i, name: 'Contact ' + i + ' With A Long Name', email: 'contact.with.a.long.address' + i + '@provider-firm-' + i + '.com', accountType: 'Service provider admin' }] : [],
}))

function answer(path, query) {
  if (path === '/me') return ME
  if (path === '/portal/companies') return { companies: COMPANIES }
  if (path === '/portal/clients') return { clients: [] }
  if (path === '/portal/cip/applications') {
    const phase = query.get('phase')
    const rows = phase ? APPS.filter(a => a.phase === phase) : APPS
    return { applications: rows, page: 1, lastPage: 1, total: rows.length }
  }
  const company = path.match(/^\/portal\/companies\/([^/]+)$/)
  if (company) return { company: COMPANIES.find(c => c.id === company[1]) || COMPANIES[0] }
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

async function open(width) {
  const phone = width <= 1024
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 })
  await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1') } catch (e) { /* asked instead */ } })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}/citizenship-applications`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  // The static shell has no boot handoff, so the hub is mounted by hand.
  await page.evaluate(() => {
    const view = document.querySelector('[data-view=clients]')
    if (view) view.hidden = false
    window.TMAClients.mount(document.querySelector('[data-clients]'))
  })
  await page.waitForTimeout(1500)
  return page
}

async function tab(page, id) {
  await page.evaluate(t => document.querySelector(`[data-clients-list-tab="${t}"]`).click(), id)
  await page.waitForTimeout(900)
}

/* What a reader sees of the table at this width. */
const look = page => page.evaluate(() => {
  const table = document.querySelector('[data-clients] .tma-cip-table')
  const rows = table ? [...table.querySelectorAll('tbody tr')] : []
  const first = rows[0]
  const box = first && first.getBoundingClientRect()
  const spill = rows.some(tr => {
    const r = tr.getBoundingClientRect()
    return [...tr.querySelectorAll('td *')].some(el => {
      const b = el.getBoundingClientRect()
      return b.width && (b.right > r.right + 1 || b.left < r.left - 1)
    })
  })
  const clipped = rows.some(tr => [...tr.querySelectorAll('button')].some(b => {
    const cell = b.closest('td').getBoundingClientRect()
    const r = b.getBoundingClientRect()
    return r.width && (r.right > cell.right + 1 || r.left < cell.left - 1)
  }))
  return {
    table: !!table,
    cards: first ? getComputedStyle(first).display === 'grid' : false,
    head: table ? getComputedStyle(table.querySelector('thead')).display !== 'none' : false,
    captions: first ? [...first.querySelectorAll('td[data-label]')].map(td => td.getAttribute('data-label')) : [],
    name: first ? (first.querySelector('.tma-cip-table__applicant') || {}).textContent : '',
    inside: box ? box.right <= innerWidth && box.left >= 0 : false,
    spill,
    clipped,
    wide: document.scrollingElement.scrollWidth > innerWidth,
    pager: (() => {
      const bar = document.querySelector('[data-clients] [data-clients-pagination]')
      if (!bar) return null
      const r = bar.getBoundingClientRect()
      return { inside: r.right <= innerWidth + 1, text: bar.textContent.replace(/\s+/g, ' ').trim() }
    })(),
  }
})

try {
  for (const width of [390, 900]) {
    console.log(`\n${width}px: the same cards as Post-Approval`)
    const page = await open(width)
    await tab(page, 'post_approval')
    const post = await look(page)
    check(post.cards && !post.head, 'Post-Approval is cards (the reference)')

    await tab(page, 'providers')
    let seen = await look(page)
    check(seen.table && seen.cards && !seen.head, 'Service providers: cards, no header row')
    check(/^(Galaxy Advisory|Harbour Partners Limited|Northstar CIP Consultants International Limited) \d+$/.test(String(seen.name).trim()), `the provider's name heads the card (${seen.name})`)
    check(['Type', 'CIP code', 'People', 'Contact'].every(c => seen.captions.includes(c)), `fields captioned (${seen.captions.join(', ')})`)
    check(seen.inside && !seen.spill && !seen.wide, 'nothing runs off the card or the screen')
    check(!seen.clipped, 'Sign as admin is whole')
    check(seen.pager && seen.pager.inside && /104 service providers/.test(seen.pager.text), `the pager fits (${seen.pager && seen.pager.text})`)

    await tab(page, 'people')
    seen = await look(page)
    check(seen.table && seen.cards && !seen.head, 'Provider contacts: cards, no header row')
    check(/Contact 0 With A Long Name/.test(seen.name), `the person's name heads the card (${seen.name})`)
    check(['Account type', 'Service provider', 'Contact'].every(c => seen.captions.includes(c)), `fields captioned (${seen.captions.join(', ')})`)
    check(seen.inside && !seen.spill && !seen.wide, 'a long email wraps inside its card')
    check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''))
    await page.context().close()
  }

  console.log('\n1440px: a sheet, like the application tabs')
  const page = await open(1440)
  await tab(page, 'providers')
  let seen = await look(page)
  check(seen.table && !seen.cards && seen.head, 'Service providers: a table with its header row')
  check(!seen.clipped, 'Sign as admin is whole, in its own column, beside a long name')
  check(!seen.wide, 'no sideways page scroll')
  await tab(page, 'people')
  seen = await look(page)
  check(seen.table && !seen.cards && seen.head, 'Provider contacts: a table with its header row')
  check(!seen.clipped, 'Transfer is whole, in its own column, beside a long email')

  console.log('\nThe rows still do what they did')
  await tab(page, 'providers')
  await page.evaluate(() => document.querySelector('[data-clients-pagination] [data-direction="next"]').click())
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelectorAll('[data-clients] .tma-cip-table tbody tr').length) === 4, 'Next shows the last 4 of 104')
  await page.evaluate(() => document.querySelector('[data-clients-pagination] [data-page="1"]').click())
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelectorAll('[data-clients] .tma-cip-table tbody tr').length) === 100, 'page 1 shows 100')

  await page.evaluate(() => document.querySelector('[data-clients] .tma-cip-table tbody tr[data-clients-open-company] td:nth-child(2)').click())
  await page.waitForTimeout(800)
  check(/\/companies\/co-/.test(await page.evaluate(() => location.pathname)), 'a provider row opens the provider')
  check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''))
} finally {
  await browser.close()
  server.close()
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
