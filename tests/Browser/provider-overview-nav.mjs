/*
 * The Overview row in the sidebar, for a service-provider contact.
 *
 * They hold no capability in Role::MATRIX at all, so portal-access.js used to
 * delete the row on sight and the account had a Dashboard with nothing behind
 * it. It is kept by name now, the same way Clients and Workflows already were,
 * and relabelled: the shell calls it "Admin Overview" because for years only
 * staff reached it, and none of what a provider contact sees there is
 * administration.
 *
 * Run against the real sidebar markup, not a hand-made one — the row's shape
 * (caret, icon, label span) is what the relabel walks, and data-title and
 * data-crumb are what the page header and breadcrumb print.
 *
 *   node tests/Browser/provider-overview-nav.mjs
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')
const MIME = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }

/* Three readers, and what each should be left with. */
const READERS = [
  {
    name: 'administrator',
    boot: { capabilities: ['overview.view', 'users.view', 'clients.view'], provider: false },
    overview: 'Admin Overview',
  },
  {
    name: 'service-provider contact',
    boot: { capabilities: [], provider: true },
    overview: 'Overview',
  },
  {
    name: 'client with no provider firm',
    boot: { capabilities: [], provider: false },
    overview: null,
  },
]

/* The sidebar as the shell serves it, so the test walks the real row. */
async function sidebar() {
  const shell = await readFile('resources/portal-pages/overview/index.html', 'utf8')
  const rows = [...shell.matchAll(/<a class="tma-dash__nav-item"[^>]*data-nav="[^"]*"[\s\S]*?<\/a>/g)]
    .map((m) => m[0])
  if (!rows.length) throw new Error('no nav rows found in the shell')

  return rows.join('\n')
}

function fixture(nav, boot) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>nav</title></head>
<body>
<script>
  window.TMABootCapabilities = ${JSON.stringify(boot.capabilities)};
  window.TMABootProviderContact = ${boot.provider};
  window.TMABootCipReach = ${boot.provider};
</script>
<nav id="nav">${nav}</nav>
<div data-boot-needs="overview.view" id="kpi-placeholder"></div>
<script src="/js/portal-access.js"></script>
</body></html>`
}

function serve(pageFor) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    if (url.pathname === '/fixture') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pageFor(url.searchParams.get('who')))
      return
    }
    try {
      const body = await readFile(join(PUBLIC, url.pathname))
      res.writeHead(200, { 'content-type': MIME[extname(url.pathname)] || 'application/octet-stream' })
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

const nav = await sidebar()
const server = await serve((who) => {
  const reader = READERS.find((r) => r.name === who) || READERS[0]
  return fixture(nav, reader.boot)
})
const { port } = server.address()
const browser = await chromium.launch()

for (const reader of READERS) {
  console.log(`\n${reader.name}`)
  const page = await browser.newPage()
  page.on('pageerror', (e) => { console.log(`  FAIL page error: ${e.message}`); failures.push('page error') })
  await page.goto(`http://127.0.0.1:${port}/fixture?who=${encodeURIComponent(reader.name)}`,
    { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.documentElement.getAttribute('data-tma-access') === 'ready',
    null, { timeout: 5000 })

  const row = await page.evaluate(() => {
    const el = document.querySelector('[data-nav="dash-project-overview"]')
    if (!el) return null
    const spans = el.querySelectorAll('span')
    return {
      label: spans[spans.length - 1].textContent.trim(),
      title: el.getAttribute('data-title'),
      crumb: el.getAttribute('data-crumb'),
      href: el.getAttribute('href'),
    }
  })
  const kpi = await page.evaluate(() => !!document.getElementById('kpi-placeholder'))

  if (reader.overview === null) {
    check(row === null, 'no Overview row in the sidebar')
    check(kpi === false, 'no KPI placeholder held for them')
  } else {
    check(row !== null, 'the Overview row survives')
    check(row?.label === reader.overview, `it reads "${row?.label}" (want "${reader.overview}")`)
    check(row?.title === reader.overview && row?.crumb === reader.overview,
      `the header and breadcrumb say the same (title "${row?.title}", crumb "${row?.crumb}")`)
    check(row?.href === '/overview', `it still goes to /overview (${row?.href})`)
    check(kpi === true, 'the KPI placeholder is held for them')
  }
  await page.close()
}

await browser.close()
server.close()

console.log(failures.length ? `\n${failures.length} failed` : '\nall good')
process.exit(failures.length ? 1 : 0)
