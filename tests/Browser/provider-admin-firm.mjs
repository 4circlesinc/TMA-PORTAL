/*
 * A Service Provider admin and the two CIP tabs that are about their firm.
 *
 * Service providers is their own firm, not a directory of one row. Provider
 * contacts open the contact record: those people have no citizenship
 * application, and the filing read answers with nobody.
 *
 *   node tests/Browser/provider-admin-firm.mjs
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

const FIRM = {
  id: 'gal-firm',
  name: 'Galaxy',
  cipCode: 'GAL',
  people: [{
    id: 'dana-reed',
    name: 'Dana Reed',
    email: 'dana@galaxy.example',
    accountType: 'Service Provider Contact',
  }],
}

const CONTACT = {
  id: 'dana-reed',
  name: 'Dana Reed',
  initial: 'D',
  initialColor: 'blue',
  profile: {
    firstName: 'Dana',
    lastName: 'Reed',
    emails: [{ type: 'work', value: 'dana@galaxy.example' }],
    phones: [{ type: 'work', value: '+1 555 0100' }],
  },
}

function serve() {
  const page = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
<script>
  window.TMABootServiceProviderAdmin = true;
  window.TMABootProviderContact = true;
  window.TMABootProviderCompany = { id: 'gal-firm', name: 'Galaxy' };
  window.TMABootCipReach = true;
  window.TMABootCapabilities = [];
  try { localStorage.removeItem('tma.cipListTab.v1'); } catch (e) {}
  window.__calls = [];
  var FIRM = ${JSON.stringify(FIRM)};
  var CONTACT = ${JSON.stringify(CONTACT)};
  window.fetch = function (url) {
    var u = String(url);
    window.__calls.push(u);
    function ok(body) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: function () { return 'application/json'; } },
        text: function () { return Promise.resolve(JSON.stringify(body)); },
      });
    }
    if (u.indexOf('/members') !== -1) return ok({ members: [] });
    if (u.indexOf('/staff') !== -1) return ok({ assignments: [], assignable: [] });
    if (u.indexOf('/portal/companies/gal-firm') !== -1) return ok({ company: FIRM });
    if (u.indexOf('/portal/companies') !== -1) return ok({ companies: [FIRM] });
    if (u.indexOf('/portal/clients/dana-reed') !== -1) return ok({ client: CONTACT });
    if (u.indexOf('/application') !== -1) return ok({ application: null, client: null });
    if (u.indexOf('/portal/cip/applications') !== -1) {
      return ok({ applications: [], page: 1, lastPage: 1, total: 0 });
    }
    return ok({});
  };
</script>
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
    </div>
  </div>
</div>
<script src="/js/clients.js"></script>
<script>
  window.TMAClients.mount(document.getElementById('clients'));
</script>
</body></html>`

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x')
    if (url.pathname === '/fixture' || url.pathname.indexOf('/citizenship-applications') === 0) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(page)
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

const server = serve()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (err) => { console.error('PAGE', err.message) })

try {
  await page.goto(`http://127.0.0.1:${port}/citizenship-applications?listTab=providers`)
  await page.waitForFunction(() => location.pathname === '/citizenship-applications/companies/gal-firm')
  await page.waitForSelector('.tma-dash__clients-profile-name')
  const firmName = await page.locator('.tma-dash__clients-profile-name').innerText()
  if (!firmName.includes('Galaxy')) throw new Error('firm page did not name Galaxy: ' + firmName)
  const firmTable = await page.locator('.tma-dash__ctable--providers').count()
  if (firmTable) throw new Error('the providers table is still on screen')

  await page.goto(`http://127.0.0.1:${port}/citizenship-applications?listTab=all_applications`)
  await page.waitForSelector('[data-clients-list-tab="providers"]')
  const providerTab = (await page.locator('[data-clients-list-tab="providers"]').innerText()).replace(/\s+/g, ' ').trim()
  if (providerTab !== 'Galaxy') throw new Error('provider admin tab should be the firm name, got: ' + providerTab)
  await page.click('[data-clients-list-tab="providers"]')
  await page.waitForFunction(() => location.pathname === '/citizenship-applications/companies/gal-firm')

  await page.goto(`http://127.0.0.1:${port}/citizenship-applications?listTab=people`)
  await page.waitForSelector('[data-clients-list-tab="people"]')
  const peopleTab = (await page.locator('[data-clients-list-tab="people"]').innerText()).replace(/\s+/g, ' ').trim()
  if (!peopleTab.startsWith('Provider users')) throw new Error('provider admin people tab should say Provider users, got: ' + peopleTab)
  await page.waitForSelector('[data-clients-row="dana-reed"]')
  await page.click('[data-clients-row="dana-reed"]')
  await page.waitForFunction(() => location.pathname === '/citizenship-applications/dana-reed')
  await page.waitForSelector('.tma-dash__clients-profile-name')
  const detailName = await page.locator('.tma-dash__clients-profile-name').innerText()
  if (!detailName.includes('Dana Reed')) throw new Error('contact detail did not name Dana: ' + detailName)
  const detail = await page.locator('.tma-dash__clients').innerText()
  if (/not assigned/i.test(detail)) throw new Error('contact detail still says they are not assigned')
  if (!detail.includes('Contact')) throw new Error('contact detail did not open the contact tab')
  const asked = await page.evaluate(() => window.__calls.filter((u) => u.indexOf('dana-reed') !== -1))
  if (!asked.some((u) => u.indexOf('/portal/clients/dana-reed') !== -1)) {
    throw new Error('detail did not read the contact record: ' + asked.join(', '))
  }

  const staffList = await page.evaluate(() => {
    window.TMABootServiceProviderAdmin = false
    window.TMABootProviderCompany = null
    history.replaceState({}, '', '/citizenship-applications?listTab=providers')
    return window.TMAClients.routeFromPath(location.pathname).screen
  })
  if (staffList !== 'list') throw new Error('staff should still get the providers list, got ' + staffList)

  console.log('provider admin firm: ok')
} finally {
  await browser.close()
  server.close()
}
