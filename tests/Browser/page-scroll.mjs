/**
 * The page never scrolls; the box does (public/js/page-scroll.js and
 * "The page itself never scrolls" in dashboard-tma-overrides.css).
 *
 * On a CIP application the applicant and documents card scrolls inside
 * itself while the title, tabs and summary strip hold still. A wheel over
 * those still parts used to scroll the whole document instead, by as much as
 * the hidden upload input in a checklist row had stretched it, leaving a
 * blank band under the portal. Plays the real shell and stylesheets with a
 * mocked application and checks:
 *
 * - the document is no taller than the window, the upload input included;
 * - a wheel over the tabs, the title, the gap above the card or the header
 *   scrolls the card, and the document stays put;
 * - a wheel over the card still scrolls it, and one past its end moves
 *   nothing else;
 * - focusing the hidden upload input does not move the page;
 * - a document a script scrolls is put back, even when something has
 *   stretched it;
 * - a wheel over the sidebar, or over anything marked data-scroll-own, is
 *   not handed to the card;
 * - where the main column itself scrolls (Overview), its content scrolls as
 *   before and a wheel over the header scrolls it too.
 *
 * No portal seed required.
 *
 *   node tests/Browser/page-scroll.mjs
 *   TMA_BROWSER=webkit node tests/Browser/page-scroll.mjs
 */
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'public');
const SHELL = readFileSync(join(ROOT, 'resources/views/pages/dashboard.html'), 'utf8');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const ME = {
  id: 1, name: 'Bruce Wayne', firstName: 'Bruce', email: 'bruce@wayne.test', accountType: 'Administrator',
  isStaff: true, isAdmin: true, status: 'approved', preferences: {}, desktopNotifications: { enabled: false },
  permissions: [], pages: [],
  capabilities: ['cip.assign', 'cip.compliance', 'cip.decide', 'cip.review', 'clients.assign', 'clients.manage', 'clients.view'],
};
/* Twenty documents, one still owed: the owed row carries the hidden upload
   input that used to stretch the page. */
const CLIENT = { id: 'chen-wei', uid: 'chen-wei', name: 'Chen Wei', email: 'chen@example.com', isCipApplicant: true, cip: true, folderUuid: null, profile: {} };
const DOCS = Array.from({ length: 20 }, (_, i) => {
  const owed = i === 16;
  return {
    id: 'doc-' + (i + 1), type: 'other', label: 'Document ' + (i + 1), required: true, uploaded: !owed,
    status: owed ? 'update_required' : 'ready_for_submission', statusLabel: owed ? 'Update required' : 'Ready for submission',
    statusTone: owed ? 'warning' : 'success', canReview: true, canUpload: owed, fileId: owed ? null : 'f' + i,
    fileName: 'doc' + i + '.pdf', updateReason: owed ? 'The notary stamp is not legible.' : null,
  };
});
const APP = {
  id: 'app-1', number: 'GAL26-00001', status: 'update_required', statusLabel: 'Update Required', statusTone: 'amber',
  phase: 'pre_approval', provider: 'Galaxy', familySize: 1,
  applicant: { id: 'p-1', firstName: 'Chen', lastName: 'Wei', fullName: 'Chen Wei', role: 'main_applicant', documents: DOCS },
  sponsor: null, dependents: [], milestones: [], attention: null,
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = join(PUBLIC, decodeURIComponent(url.pathname));
  if (file.startsWith(PUBLIC) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }
  if (!extname(url.pathname) && (req.headers.accept || '').includes('text/html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(SHELL);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (url.pathname === '/me') return res.end(JSON.stringify(ME));
  if (url.pathname === '/portal/clients/chen-wei') return res.end(JSON.stringify({ client: CLIENT }));
  if (url.pathname === '/portal/cip/clients/chen-wei/application') return res.end(JSON.stringify({ application: APP, client: CLIENT }));
  res.end('{}');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

const engine = process.env.TMA_BROWSER === 'webkit' ? webkit : chromium;
let browser;
try {
  browser = await engine.launch();
} catch (e) {
  if (engine !== chromium) throw e;
  browser = await chromium.launch({ channel: 'chrome' });
}

const results = [];
function check(label, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const CARD = '.tma-dash__clients-profile--cards';

/* Where everything stands: the document, the shell, the main column, the card. */
const where = (page) => page.evaluate((card) => {
  const c = document.querySelector(card);
  return {
    doc: document.scrollingElement.scrollTop,
    shell: document.querySelector('.tma-dash').scrollTop,
    main: document.querySelector('.tma-dash__main').scrollTop,
    card: c ? c.scrollTop : null,
  };
}, CARD);

const rewind = (page) => page.evaluate((card) => {
  window.scrollTo(0, 0);
  document.querySelector('.tma-dash').scrollTop = 0;
  document.querySelector('.tma-dash__main').scrollTop = 0;
  const c = document.querySelector(card);
  if (c) c.scrollTop = 0;
}, CARD);

/* Six notches of the wheel at a point, then a moment for the scroll to land. */
async function wheel(page, [x, y], dy = 100) {
  await page.mouse.move(x, y);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(250);
}

const middle = (box) => box && [box.x + box.width / 2, box.y + box.height / 2];

try {
  // ── A CIP application: the card scrolls, the rest holds still ──────────
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '/citizenship-applications/chen-wei?tab=applicant', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (!(await page.$('.tma-dash__clients-checklist-row'))) {
    // The clients view mounts itself in the portal; without a session it is mounted by hand.
    await page.evaluate(() => window.TMAClients.mount(document.querySelector('[data-clients]')));
  }
  await page.waitForSelector('.tma-dash__clients-checklist-row--owed', { timeout: 8000 });
  await page.waitForTimeout(500);

  const fit = await page.evaluate(() => {
    const input = document.querySelector('.tma-dash__clients-checklist-row--owed .tma-dash__clients-photo-input');
    return { over: document.scrollingElement.scrollHeight - window.innerHeight, inputBottom: input && Math.round(input.getBoundingClientRect().bottom), vh: window.innerHeight };
  });
  check('the document is no taller than the window', fit.over <= 1, `${fit.over}px over`);
  check('the owed row\'s upload input stays within the window', fit.inputBottom !== null && fit.inputBottom <= fit.vh, `bottom ${fit.inputBottom} of ${fit.vh}`);

  const card = await page.locator(CARD).boundingBox();
  check('the card scrolls inside itself', await page.evaluate((c) => { const el = document.querySelector(c); return el.scrollHeight > el.clientHeight + 1; }, CARD));

  const spots = {
    'the tabs': middle(await page.locator('.tma-dash__main').getByText('Main applicant', { exact: true }).first().boundingBox()),
    'the title': middle(await page.locator('.tma-dash__main-head').first().boundingBox()),
    'the gap above the card': [card.x + card.width / 2, card.y - 8],
    'the header bar': middle(await page.locator('.tma-dash__header').boundingBox()),
  };
  for (const [name, at] of Object.entries(spots)) {
    await rewind(page);
    await wheel(page, at);
    const s = await where(page);
    check(`a wheel over ${name} scrolls the card, not the page`, s.card >= 500 && s.doc === 0 && s.shell === 0, JSON.stringify(s));
  }

  await rewind(page);
  await wheel(page, middle(card));
  let s = await where(page);
  check('a wheel over the card still scrolls it', s.card >= 500 && s.doc === 0, JSON.stringify(s));

  await page.evaluate((c) => { const el = document.querySelector(c); el.scrollTop = el.scrollHeight; }, CARD);
  await wheel(page, middle(card), 200);
  await wheel(page, spots['the tabs'], 200);
  s = await where(page);
  check('past the card\'s end nothing else moves', s.doc === 0 && s.shell === 0 && s.main === 0, JSON.stringify(s));

  await rewind(page);
  await page.evaluate(() => document.querySelector('.tma-dash__clients-checklist-row--owed .tma-dash__clients-photo-input').focus());
  await page.waitForTimeout(200);
  s = await where(page);
  check('focusing the hidden upload input leaves the page where it was', s.doc === 0 && s.shell === 0, JSON.stringify(s));

  await rewind(page);
  await wheel(page, middle(await page.locator('.tma-dash__sidebar').boundingBox()));
  s = await where(page);
  check('a wheel over the sidebar is not handed to the card', s.card === 0 && s.doc === 0, JSON.stringify(s));

  // Anything that keeps the wheel to itself.
  await rewind(page);
  await page.evaluate((c) => {
    const own = document.createElement('div');
    own.setAttribute('data-scroll-own', '');
    own.id = 'own';
    own.style.cssText = 'height:40px;background:#eee';
    const el = document.querySelector(c);
    el.parentNode.insertBefore(own, el);
  }, CARD);
  await wheel(page, middle(await page.locator('#own').boundingBox()));
  s = await where(page);
  check('a wheel over data-scroll-own is left alone', s.card === 0 && s.doc === 0, JSON.stringify(s));
  await page.evaluate(() => document.getElementById('own').remove());

  // Something stretches the document; a script scrolls it; it comes back.
  await page.evaluate(() => {
    const far = document.createElement('div');
    far.id = 'far';
    far.style.cssText = 'position:absolute;top:3000px;left:0;width:1px;height:1px';
    document.querySelector('.tma-dash__main').appendChild(far);
  });
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  s = await where(page);
  check('a document a script scrolls is put back', s.doc === 0, JSON.stringify(s));
  await rewind(page);
  await wheel(page, spots['the tabs']);
  s = await where(page);
  check('and even stretched, a wheel over the tabs scrolls the card', s.card >= 500 && s.doc === 0, JSON.stringify(s));
  await page.close();

  // ── Overview: the main column itself scrolls ───────────────────────────
  const overview = await browser.newPage({ viewport: { width: 1440, height: 700 } });
  await overview.goto(base + '/overview', { waitUntil: 'domcontentloaded' });
  await overview.waitForTimeout(1800);
  const tall = await overview.evaluate(() => { const m = document.querySelector('.tma-dash__main'); return m.scrollHeight - m.clientHeight; });
  if (tall < 200) {
    check('Overview overflows its main column (fixture)', false, `${tall}px`);
  } else {
    // A point on the content that is actually on screen; the view runs on below the window.
    const view = await overview.locator('.tma-dash__main .tma-dash__view:not([hidden])').first().boundingBox();
    await wheel(overview, [view.x + view.width / 2, Math.max(view.y, 0) + 120]);
    s = await where(overview);
    check('Overview\'s content scrolls as before', s.main >= 300 && s.doc === 0, JSON.stringify(s));
    await rewind(overview);
    await wheel(overview, middle(await overview.locator('.tma-dash__header').boundingBox()));
    s = await where(overview);
    check('a wheel over the header scrolls Overview\'s main column', s.main >= 300 && s.doc === 0, JSON.stringify(s));
  }
  await overview.close();
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
