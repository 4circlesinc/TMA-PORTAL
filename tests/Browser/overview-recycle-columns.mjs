/*
 * Overview → Recycle Bin: the table's columns.
 *
 * The bin's rows lost their checkboxes when the portal moved to explorer-style
 * picking, but the grid kept a leading 40px checkbox track. Every cell then sat
 * one column to the left of its heading: the name was squeezed into 40px and
 * disappeared behind its own icon, while a 72px track hung empty off the right
 * edge. Nothing about it throws, so only measuring catches it.
 *
 * This renders the real overview-recycle.js against a stubbed API and checks
 * that the head, the body and the grid agree on how many columns there are and
 * where they start — then that no cell has to truncate what it was given. The
 * same track-count check runs over the other three overview tables, which share
 * the chrome and can drift the same way.
 *
 * No portal, no database: a static server over public/ is enough.
 *
 *   node tests/Browser/overview-recycle-columns.mjs
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')

const MIME = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.html': 'text/html',
}

/* The bin lists eight kinds; these are the five with distinct visuals. */
const ITEMS = [
  {
    id: '9', kind: 'user', name: 'Tomiwa Fasanya',
    subtitle: 'Employee · tomiwa@example.com',
    deletedAt: '2026-08-26T18:21:00+00:00',
    deletedBy: { id: 1, name: 'Vernon Francis', avatar: '' },
    meta: { avatarUrl: '', email: 'tomiwa@example.com', accountType: 'Employee', icon: 'User' },
  },
  {
    id: 'evt-1', kind: 'calendar_event', name: 'Quarterly review with Blue Media',
    subtitle: 'Calendar',
    deletedAt: '2026-08-19T02:48:00+00:00',
    deletedBy: { id: 1, name: 'Vernon Francis', avatar: '' },
    meta: { icon: 'CalendarBlank' },
  },
  {
    id: 'f-1', kind: 'file', name: 'Q3 Financial Statement.pdf',
    subtitle: 'File · Vernon Francis',
    deletedAt: '2026-08-18T02:35:00+00:00',
    deletedBy: { id: 1, name: 'Vernon Francis', avatar: '' },
    meta: { extension: 'pdf', mime: 'application/pdf', size: 69, sizeLabel: '69 B', icon: 'FilePdf', category: 'document' },
  },
  {
    id: 'fo-1', kind: 'folder', name: 'Onboarding paperwork',
    subtitle: 'Folder · Vernon Francis',
    deletedAt: '2026-08-17T14:49:00+00:00',
    deletedBy: { id: 1, name: 'Vernon Francis', avatar: '' },
    meta: { colour: 'yellow', iconName: null, folderType: 'org', fileCount: null },
  },
  {
    id: 'c-1', kind: 'client', name: 'Jonathan Smith',
    subtitle: 'Client · Galaxy',
    deletedAt: '2026-08-15T02:57:00+00:00',
    deletedBy: { id: 1, name: 'Vernon Francis', avatar: '' },
    meta: { avatarUrl: '', initial: 'JS', initialColor: '#2563eb', company: 'Galaxy' },
  },
]

/* The other overview tables render their own headings; the grid has to have a
   track for each one and no more. */
const TABLES = [
  { file: 'public/js/overview-recycle.js', cls: 'tma-dash__files--overview tma-dash__recycle--overview' },
  { file: 'public/js/overview-files.js', cls: 'tma-dash__files--overview' },
  { file: 'public/js/overview-activity.js', cls: 'tma-dash__activity--overview' },
  { file: 'public/js/users.js', cls: 'tma-dash__users--overview' },
]

/* How many cells the source puts in the head row. Cells are one per line, so
   the row ends at the first line that is nothing but a closing div. */
function headCellsInSource(src) {
  const at = src.indexOf('tma-dash__ctr--head tma-dash__ctr--overview')
  if (at < 0) throw new Error('no overview head row in source')
  const rest = src.slice(at)
  const end = rest.search(/\n\s*'<\/div>'/)
  const block = end < 0 ? rest.slice(0, 2000) : rest.slice(0, end)
  return (block.match(/tma-dash__cc--head/g) || []).length
}

async function stylesheets() {
  const shell = await readFile('resources/portal-pages/overview/index.html', 'utf8')
  return [...shell.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">/g)].map((m) => `/${m[1]}`)
}

function fixture(links, probes) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
${links.map((h) => `<link rel="stylesheet" href="${h}">`).join('\n')}
</head>
<body class="tma-dash">
<div class="tma-dash__main" style="padding:24px">
  <div id="host"></div>
  ${probes.map((p, i) => `<div class="tma-dash__files ${p.cls}" data-probe="${i}">
    <div class="tma-dash__ctable tma-dash__ctable--overview">
      <div class="tma-dash__ctr tma-dash__ctr--head tma-dash__ctr--overview"></div>
    </div>
  </div>`).join('\n')}
</div>
<script>
  window.__ITEMS = ${JSON.stringify(ITEMS)};
  window.TMANotifyAPI = {
    qs: function () { return ''; },
    api: function () { return Promise.resolve({ items: window.__ITEMS, total: window.__ITEMS.length }); },
  };
</script>
<script src="/js/overview-recycle.js"></script>
<script>window.TMAOverviewRecycle.mount(document.getElementById('host'));</script>
</body></html>`
}

function serve(html) {
  const server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0]
    if (path === '/' || path === '/__fixture') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(html)
      return
    }
    try {
      const body = await readFile(join(PUBLIC, path))
      res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)))
}

const failures = []
function check(ok, message) {
  if (ok) console.log(`  ok   ${message}`)
  else { console.log(`  FAIL ${message}`); failures.push(message) }
}

const probes = []
for (const t of TABLES) {
  probes.push({ ...t, heads: headCellsInSource(await readFile(t.file, 'utf8')) })
}

const server = await serve(fixture(await stylesheets(), probes))
const { port } = server.address()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.on('pageerror', (e) => { console.log(`  FAIL page error: ${e.message}`); failures.push('page error') })

await page.goto(`http://127.0.0.1:${port}/__fixture`, { waitUntil: 'networkidle' })
await page.waitForSelector('#host [data-recycle-row]', { timeout: 8000 })

console.log('\nGrid tracks match the headings each table renders')
const tracks = await page.$$eval('[data-probe]', (nodes) => nodes.map((n) => {
  const head = n.querySelector('.tma-dash__ctr--head')
  return getComputedStyle(head).gridTemplateColumns.split(' ').filter(Boolean).length
}))
probes.forEach((p, i) => {
  check(tracks[i] === p.heads, `${p.file.split('/').pop()}: ${p.heads} headings, ${tracks[i]} tracks`)
})

console.log('\nThe rendered bin')
const table = await page.evaluate(() => {
  const host = document.getElementById('host')
  const head = host.querySelector('.tma-dash__ctr--head')
  const row = host.querySelector('[data-recycle-row]')
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width) } }
  const cells = (el) => [...el.children].map((c) => ({
    cls: c.className, ...box(c), text: c.textContent.trim(),
  }))
  const clipped = [...host.querySelectorAll('[data-recycle-row] .tma-dash__cc-truncate')]
    .filter((s) => s.scrollWidth > s.clientWidth + 1)
    .map((s) => s.textContent.trim())
  return {
    tracks: getComputedStyle(head).gridTemplateColumns,
    head: cells(head),
    row: cells(row),
    names: [...host.querySelectorAll('[data-recycle-row] .tma-dash__cc--filename .tma-dash__cc-truncate')]
      .map((s) => ({ text: s.textContent.trim(), width: Math.round(s.getBoundingClientRect().width) })),
    clipped,
  }
})

check(table.head.length === table.row.length,
  `head and body agree on cell count (${table.head.length} vs ${table.row.length})`)
check(table.head.every((h, i) => Math.abs(h.left - table.row[i].left) <= 1),
  'every heading sits over its own column')
check(table.row[0].width >= 200,
  `the name column is a name column, not an icon slot (${table.row[0].width}px)`)
check(table.names.every((n) => n.text.length > 0),
  'every row prints its name')
check(table.clipped.length === 0,
  `nothing is truncated (${table.clipped.join(' | ') || 'none'})`)

console.log('\n  tracks:', table.tracks)
console.log('  headings:', table.head.map((h) => `${h.text || '·'}@${h.left}/${h.width}`).join('  '))
console.log('  first row:', table.row.map((c) => `${c.text || '·'}@${c.left}/${c.width}`).join('  '))

await page.locator('#host').screenshot({ path: 'tests/Browser/overview-recycle-columns.png' })
await browser.close()
server.close()

console.log(failures.length ? `\n${failures.length} failed` : '\nall good')
process.exit(failures.length ? 1 : 0)
