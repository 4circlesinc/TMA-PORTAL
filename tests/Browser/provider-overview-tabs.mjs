/*
 * Service Provider admin Overview, and the application tabs everyone shares.
 *
 *   node tests/Browser/provider-overview-tabs.mjs
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

const APPLICATION = {
  id: 'app-1',
  clientUid: 'ada-cole',
  name: 'Ada Cole',
  status: 'new',
  phase: 'pre_approval',
  applicant: { firstName: 'Ada', lastName: 'Cole', name: 'Ada Cole' },
  sponsor: null,
  dependents: [],
}

const CLIENT = {
  id: 'ada-cole',
  name: 'Ada Cole',
  initial: 'A',
  initialColor: 'blue',
  profile: { firstName: 'Ada', lastName: 'Cole' },
}

function pageFor(who) {
  const admin = who === 'admin'
  const contact = who === 'contact'
  return `<!doctype html>
<html><head><meta charset="utf-8"><base href="/">
<script>
  window.TMABootServiceProviderAdmin = ${admin ? 'true' : 'false'};
  window.TMABootProviderContact = ${admin || contact ? 'true' : 'false'};
  window.TMABootProviderCompany = ${admin || contact ? "{ id: 'gal-firm', name: 'Galaxy' }" : 'null'};
  window.TMABootCipReach = true;
  window.TMABootCapabilities = ${admin || contact ? '[]' : "['clients.view']"};
  try { localStorage.removeItem('tma.cipListTab.v1'); } catch (e) {}
  window.__calls = [];
  window.fetch = function (url) {
    var u = String(url);
    window.__calls.push(u);
    function ok(body) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: function () { return 'application/json'; } },
        text: function () { return Promise.resolve(JSON.stringify(body)); },
        json: function () { return Promise.resolve(body); },
      });
    }
    if (u.indexOf('/assignments') !== -1) {
      return ok({
        assignments: [{ userId: 4, name: 'Rita Officer', roleLabel: 'Reviewing officer', level: 'editor', email: 'rita@example.com' }],
        history: [],
        assignable: [],
      });
    }
    if (u.indexOf('/application') !== -1) return ok({ application: ${JSON.stringify(APPLICATION)}, client: ${JSON.stringify(CLIENT)} });
    if (u.indexOf('/portal/clients/ada-cole') !== -1) return ok({ client: ${JSON.stringify(CLIENT)} });
    if (u.indexOf('/portal/cip/applications') !== -1) {
      return ok({ applications: [${JSON.stringify(APPLICATION)}], page: 1, lastPage: 1, total: 1 });
    }
    if (u.indexOf('/portal/sign-ins') !== -1) {
      return ok({ items: [{ id: 'auth-1', description: 'Dana Reed signed in', module: 'security', status: 'success', actor: { name: 'Dana Reed' }, createdAt: '2026-10-19T12:00:00Z' }] });
    }
    return ok({});
  };
</script>
<script src="/js/portal-access.js"></script>
</head>
<body>
<div class="tma-dash tma-dash--clients">
  <div class="tma-dash__main-head">
    <div class="tma-dash__main-head-left">
      <h1 class="tma-dash__page-title" data-page-title>CIP Applications</h1>
    </div>
    <div data-page-head-tabs></div>
  </div>
  <div class="tma-dash__main">
    <div class="tma-dash__view" data-view="clients">
      <div id="clients"></div>
      <div id="overview"></div>
    </div>
  </div>
</div>
<script src="/js/clients.js"></script>
<script src="/js/overview.js"></script>
<script>
  window.TMAClients.mount(document.getElementById('clients'));
</script>
</body></html>`
}

function serve() {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    if (url.pathname === '/fixture' || url.pathname.indexOf('/citizenship-applications') === 0) {
      const who = url.searchParams.get('who') || 'admin'
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pageFor(who))
      return
    }
    try {
      const body = await readFile(join(PUBLIC, url.pathname))
      res.writeHead(200, { 'content-type': MIME[extname(url.pathname)] || 'application/octet-stream' })
      res.end(body)
    } catch (e) {
      res.writeHead(404)
      res.end('missing')
    }
  })
}

async function tabsOf(page) {
  await page.waitForSelector('[data-clients-tab="assigned"]')
  return page.locator('[data-clients-tab]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-clients-tab')))
}

const server = serve()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (err) => errors.push(err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text())
})
page.on('response', (res) => {
  const type = res.request().resourceType()
  if (type === 'script' && String(res.headers()['content-type'] || '').includes('html')) {
    errors.push('script was html: ' + res.url())
  }
})

try {
  await page.goto(`http://127.0.0.1:${port}/citizenship-applications/ada-cole?who=admin`)
  const adminTabs = await tabsOf(page)
  if (adminTabs.includes('access')) throw new Error('application still has Portal access: ' + adminTabs.join(','))
  if (!adminTabs.includes('assigned')) throw new Error('application is missing Assigned: ' + adminTabs.join(','))
  const connectors = await page.evaluate(() => window.TMAPortalAccess.canSettingsPage('connectors'))
  if (connectors) throw new Error('Connectors stayed open for a service provider admin')
  const signIns = await page.evaluate(() => window.TMAOverview.render('Overview').indexOf('data-overview-signins') !== -1)
  if (!signIns) throw new Error('a service provider admin did not get the sign-in card')

  await page.click('[data-clients-tab="assigned"]')
  await page.waitForSelector('[data-clients-panel="assigned"]')
  const assigned = await page.locator('[data-clients-panel="assigned"]').innerText()
  if (!assigned.includes('Rita Officer')) throw new Error('Assigned tab did not name Rita: ' + assigned)
  const asked = await page.evaluate(() => window.__calls.filter((u) => u.indexOf('/assignments') !== -1))
  if (!asked.length) throw new Error('Assigned tab never asked for assignments')

  await page.goto(`http://127.0.0.1:${port}/citizenship-applications/ada-cole?who=contact`)
  const contactTabs = await tabsOf(page)
  if (contactTabs.includes('access')) throw new Error('contact application still has Portal access')
  const contactConnectors = await page.evaluate(() => window.TMAPortalAccess.canSettingsPage('connectors'))
  if (contactConnectors) throw new Error('Connectors stayed open for a provider contact')
  const contactSignIns = await page.evaluate(() => window.TMAOverview.render('Overview').indexOf('data-overview-signins') !== -1)
  if (contactSignIns) throw new Error('a regular provider contact still sees the sign-in card')

  await page.goto(`http://127.0.0.1:${port}/citizenship-applications/ada-cole?who=staff`)
  const staffTabs = await tabsOf(page)
  if (staffTabs.includes('access')) throw new Error('staff application still has Portal access: ' + staffTabs.join(','))
  if (!staffTabs.includes('assigned')) throw new Error('staff application is missing Assigned')
  const staffConnectors = await page.evaluate(() => window.TMAPortalAccess.canSettingsPage('connectors'))
  if (!staffConnectors) throw new Error('Connectors closed for staff')

  if (errors.length) throw new Error(errors.join('\n'))
  console.log('provider overview tabs: ok')
} finally {
  await browser.close()
  server.close()
}
