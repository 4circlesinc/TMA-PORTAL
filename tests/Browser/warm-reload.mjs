import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Which pages open with their data, and which open with a skeleton.
 *
 * The mailbox was the one page that opened already filled: it kept its last
 * page in sessionStorage and painted that before asking the server. Every
 * other screen kept its last answer in the portal's store, which in a browser
 * was memory only, so a reload emptied all of them at once. The store now has
 * a tab tier, and this measures what that buys, page by page.
 *
 * The method is the same for every page and assumes nothing about its markup:
 * open it and let it settle, then reload with every data request held back
 * for HOLD milliseconds and look at the page well before any of them can have
 * answered. A page that is warm has no skeleton up and already reads like its
 * settled self; a page that is cold is waiting. The settled text is taken at
 * the end, from the same load, so "like itself" is a comparison and not a
 * guess about what the page should contain.
 *
 * It reports rather than asserts for most pages, because how much a page shows
 * depends on what the database holds: a page with nothing to show is neither
 * warm nor cold. The pages named in MUST are the ones this suite fails on.
 *
 * Needs the `cip-table-quiet.mjs` server and seed. Adds a feed post, a direct
 * conversation and a calendar event of its own through the portal's API.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';
const HOLD = 3500;
const LOOK = 1500;

const PAGES = [
  ['Dashboard', '/'],
  ['CIP Applications', '/citizenship-applications'],
  ['Email', '/email'],
  ['Messages', '/social/messages'],
  ['Feed', '/social/feed'],
  ['Calendar', '/calendar'],
  ['Overview', '/overview'],
  ['People', '/people'],
  ['Files', '/folders/all'],
  ['Users', '/users'],
  ['Workflows', '/workflows'],
  ['Signatures', '/signatures'],
  ['Reporting', '/reporting'],
];
// Fail the run if these are not warm; the rest are reported.
const MUST = (process.env.TMA_WARM_MUST || 'CIP Applications,Dashboard').split(',').map(s => s.trim()).filter(Boolean);

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };

function loginCode() {
  const all = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

/* What the page on screen looks like right now, without knowing what it is. */
const look = () => page.evaluate(() => {
  const view = [...document.querySelectorAll('.tma-dash__view')].find(v => !v.hidden && !v.hasAttribute('hidden') && v.offsetParent !== null)
    || document.querySelector('.tma-dash__main') || document.body;
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const skeletons = [...view.querySelectorAll('.tma-skeleton, [class*="skeleton"]')].filter(visible).length;
  const text = (view.innerText || '').replace(/\s+/g, ' ').trim();
  return { skeletons, chars: text.length, text };
});

/* How much of the settled page's wording was already there. */
function overlap(early, settled) {
  const words = s => new Set(s.toLowerCase().split(/[^a-z0-9@.]+/).filter(w => w.length > 2));
  const a = words(early); const b = words(settled);
  if (!b.size) return 1;
  let hit = 0;
  b.forEach(w => { if (a.has(w)) hit++; });
  return hit / b.size;
}

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/login-code')) {
    await page.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code, { delay: 40 });
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await page.waitForTimeout(700);
  }

  // Something for the social pages and the calendar to show. Best effort: a
  // page with nothing on it is reported as empty, not failed.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const seeded = await page.evaluate(async () => {
    const xsrf = decodeURIComponent((document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || '');
    const call = (method, url, body) => fetch(url, {
      method, credentials: 'same-origin',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': xsrf },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json().then(j => ({ status: r.status, json: j })).catch(() => ({ status: r.status, json: null })));

    const out = {};
    const channels = await call('GET', '/portal/feed/channels');
    let channel = ((channels.json && channels.json.channels) || []).find(c => c.name === 'Warm reload');
    if (!channel) channel = ((await call('POST', '/portal/feed/channels', { name: 'Warm reload', type: 'team', visibility: 'org' })).json || {}).channel;
    if (channel) out.post = (await call('POST', '/portal/feed/posts', { channelId: channel.id, body: '<p>Quarterly filing calendar is posted.</p>', status: 'published' })).status;

    const users = await call('GET', '/portal/messaging/users').catch(() => null);
    const me = (await call('GET', '/me')).json || {};
    const directory = ((users && users.json && (users.json.users || users.json.people)) || []);
    const other = directory.find(u => u.id !== me.id);
    if (other) {
      const conv = (await call('POST', '/portal/messaging/conversations', { userId: other.id })).json || {};
      const id = (conv.conversation && conv.conversation.id) || conv.id;
      if (id) out.message = (await call('POST', `/portal/messaging/conversations/${id}/messages`, { body: 'Are the Galaxy files ready for review?' })).status;
    }

    const start = new Date(Date.now() + 3600 * 1000); const end = new Date(Date.now() + 7200 * 1000);
    out.event = (await call('POST', '/portal/calendar/events', { title: 'Warm reload review', startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: 'UTC' })).status;
    return out;
  });
  console.log('seeded through the API:', JSON.stringify(seeded));

  const results = [];

  for (const [name, path] of PAGES) {
    // 1. Open it and let it settle, so whatever it keeps is kept.
    await page.unroute('**/*').catch(() => {});
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);

    // 2. Reload with every data request held back.
    let released = 0;
    await page.route(url => /\/(portal|admin)\//.test(new URL(url).pathname) || /^\/me\//.test(new URL(url).pathname), async route => {
      await new Promise(r => setTimeout(r, HOLD));
      released++;
      return route.continue().catch(() => {});
    });
    const t0 = Date.now();
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(Math.max(0, LOOK - (Date.now() - t0)));
    const early = await look();
    const answeredBeforeLook = released;

    // 3. And what it turns into once everything has answered.
    await page.waitForTimeout(HOLD + 3000);
    const settled = await look();

    const share = overlap(early.text, settled.text);
    const empty = settled.chars < 60;
    // Warm: reads like its settled self. A page that does, with a placeholder
    // or two left in one corner, is still a page that opened with its data;
    // it is counted warm and the corner is printed.
    const warm = !empty && share >= 0.9 && early.skeletons <= 5;
    results.push({ name, warm, empty, early, settled, share, answeredBeforeLook });
    console.log(`  ${(empty ? 'empty' : warm ? 'WARM ' : 'cold ')}  ${name.padEnd(18)} at ${LOOK}ms: ${String(early.skeletons).padStart(3)} skeleton(s), ${String(Math.round(share * 100)).padStart(3)}% of the settled page already there (${early.chars}/${settled.chars} chars)`);
  }

  console.log('');
  for (const name of MUST) {
    const r = results.find(x => x.name === name);
    check(!!r && r.warm, `${name} opens with its data after a reload`);
  }
  const warm = results.filter(r => r.warm).map(r => r.name);
  const cold = results.filter(r => !r.warm && !r.empty).map(r => r.name);
  console.log(`\n  warm: ${warm.join(', ') || 'none'}`);
  console.log(`  cold: ${cold.join(', ') || 'none'}`);
  console.log(`  nothing to show: ${results.filter(r => r.empty).map(r => r.name).join(', ') || 'none'}`);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  failures.push(String(e).slice(0, 300));
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
