import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * The app closed and opened again, the way WhatsApp opens: everything there
 * in one go, with no connection.
 *
 * Open it once with a connection and walk every main section, so what each
 * one shows is kept on the device. Then close it and open it again — a fresh
 * window, so nothing is left in memory or in the tab's own storage, only what
 * the app keeps on disk — with every data request dead. Every section must
 * paint what it showed last time AT ONCE: a skeleton, an empty list or an
 * error card at any moment of the first few seconds is the app loading in
 * front of the reader, which is exactly what it must not do.
 *
 * warm-reload.mjs measures the browser's reload (same tab, data held back);
 * this is the installed app's reopen (new window, data never coming), and it
 * goes one step in as well: an open application and an open conversation.
 *
 * Runs as an installed app (TMADesktop.isDesktop), whose copy is on disk. The
 * shell comes from the server here; the apps keep their own.
 *
 * Setup: a fresh throwaway database, seeded with
 *   php artisan tinker tests/Browser/fixtures/warm-app-seed.php < /dev/null
 * served with FEATURE_CIP=true, MAIL_MAILER=log and APP_ENV=local.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8931';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';
const PASSWORD = 'password12345';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';
const CLIENT = process.env.TMA_CLIENT || 'chen-wei';
const RUN = ' #' + Date.now().toString(36);
const NOTE = 'Kept for later' + RUN;
const UNOPENED = 'Never opened' + RUN;

const failures = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n${n}. ${msg}`);

const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ }
  if (!window.TMADesktop) window.TMADesktop = { isDesktop: true, platform: 'darwin' };
});
const errors = [];

function loginCode() {
  const all = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
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
}

const api = (page, path, options) => page.evaluate(async ([base, path, options]) => {
  const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  const res = await fetch(base + path, {
    method: (options && options.method) || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
      'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
    },
    body: options && options.json ? JSON.stringify(options.json) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, [BASE, path, options || null]);

/* Moving within the app, the way a tap on the menu does: no new page. */
const navigate = (page, path) => page.evaluate((p) => {
  history.pushState(null, '', p);
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}, path);

/* What the reader sees right now: any loading state, and whether the words are there. */
const look = (page, expect) => page.evaluate((expect) => {
  const shown = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const loading = [...document.querySelectorAll('.tma-skeleton, .tma-skeleton-stack, [aria-busy="true"]')].filter(shown);
  const root = document.querySelector('.tma-dash__main, main, .tma-dash') || document.body;
  const text = root ? (root.innerText || '') : '';
  const failedAt = text.search(/couldn.t load|could not be loaded|could not load|something went wrong|unable to load/i);
  const failed = failedAt === -1 ? null : [text.slice(Math.max(0, failedAt - 40), failedAt + 40).replace(/\s+/g, " ")];
  return {
    loading: loading.length,
    loadingWhat: loading.slice(0, 3).map((el) => {
      const box = el.closest('[data-view], section, [class*="__"]');
      return `${String(el.className || el.getAttribute('aria-label') || el.tagName).slice(0, 40)} in ${box ? String(box.className).split(' ')[0] : '?'}`;
    }),
    failed: failed ? failed[0] : null,
    // "twice:" — in the list's preview AND in the open thread, not just the former.
    found: !expect ? !!text.trim()
      : expect.startsWith('twice:') ? text.toLowerCase().split(expect.slice(6).toLowerCase()).length > 2
      : text.toLowerCase().includes(expect.toLowerCase()),
    sample: text.replace(/\s+/g, ' ').slice(0, 160),
  };
}, expect || null);

/* Watch a screen from the moment it is asked for: never loading, and its words there. */
async function watch(page, expect, ms = 2500) {
  const seen = { loading: false, loadingWhat: [], failed: null, found: false, firstFound: null };
  const started = Date.now();
  while (Date.now() - started < ms) {
    const now = await look(page, expect);
    if (now.loading && !seen.loading) { seen.loading = true; seen.loadingWhat = now.loadingWhat; }
    if (now.failed) seen.failed = now.failed;
    if (now.found && !seen.found) { seen.found = true; seen.firstFound = Date.now() - started; }
    await page.waitForTimeout(80);
  }
  return seen;
}

const SECTIONS = [
  { name: 'Home', path: '/' },
  { name: 'CIP Applications', path: '/citizenship-applications', expect: 'Chen Wei' },
  { name: 'An application', path: `/citizenship-applications/${CLIENT}`, expect: 'Chen Wei' },
  { name: 'Messages', path: '/social/messages', expect: 'Rita Officer' },
  { name: 'A conversation', path: null, expect: NOTE },
  { name: 'Calendar', path: '/calendar' },
  { name: 'Overview', path: '/overview' },
  { name: 'Files', path: '/folders/all' },
  { name: 'Feed', path: '/social/feed' },
  { name: 'Email', path: '/email' },
  { name: 'Settings', path: '/account-settings' },
];

const report = (s, seen) => {
  const ok = !seen.loading && !seen.failed && seen.found;
  check(ok, `${s.name}: there at once` +
    (seen.loading ? ` — showed loading (${seen.loadingWhat.join('; ')})` : '') +
    (seen.failed ? ` — said "${seen.failed}"` : '') +
    (seen.found ? (seen.firstFound > 400 ? ` — its words took ${seen.firstFound}ms` : '') : ` — "${s.expect}" never appeared`));
};

try {
  step(1, 'Open the app with a connection, and let it load');
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page);
  check(!page.url().includes('/auth/'), `signed in (at ${new URL(page.url()).pathname})`);

  const contacts = await api(page, '/portal/messaging/contacts?q=Rita');
  const rita = ((contacts.body && contacts.body.contacts) || []).find((p) => p.name === 'Rita Officer');
  check(!!rita, 'Rita is someone to message');
  const conversation = (await api(page, '/portal/messaging/conversations', { method: 'POST', json: { userId: rita.id } })).body.conversation.id;
  await api(page, `/portal/messaging/conversations/${conversation}/messages`, { method: 'POST', json: { body: NOTE, nonce: crypto.randomUUID() } });
  SECTIONS.find((s) => s.name === 'A conversation').path = `/social/messages?conversation=${conversation}`;

  // A chat that is never opened while connected: WhatsApp has it anyway.
  const sam = ((await api(page, '/portal/messaging/contacts?q=Sam')).body.contacts || []).find((p) => p.name === 'Sam Clerk');
  check(!!sam, 'Sam is someone to message');
  const unopened = (await api(page, '/portal/messaging/conversations', { method: 'POST', json: { userId: sam.id } })).body.conversation.id;
  await api(page, `/portal/messaging/conversations/${unopened}/messages`, { method: 'POST', json: { body: UNOPENED, nonce: crypto.randomUUID() } });
  SECTIONS.push({ name: 'A chat never opened before', path: `/social/messages?conversation=${unopened}`, expect: 'twice:' + UNOPENED, unopened: true });

  // The copy for offline starts by itself, and the first time it says so.
  let cardSeen = false;
  for (let i = 0; i < 40 && !cardSeen; i++) {
    cardSeen = await page.evaluate(() => !!document.querySelector('.tma-sync-toast[data-sync-key="offline"]'));
    if (!cardSeen) await page.waitForTimeout(250);
  }
  check(cardSeen, 'a card says the app is downloading for offline');

  step(2, 'Visit every section, as someone using the app would');
  for (const s of SECTIONS.filter((x) => !x.unopened)) {
    // A conversation is opened the way a link or a notification opens it.
    if (s.name === 'A conversation') await page.goto(BASE + s.path, { waitUntil: 'domcontentloaded' });
    else await navigate(page, s.path);
    await page.waitForTimeout(2500);
    const now = await look(page, s.expect);
    check(now.found && !now.loading, `${s.name} loaded${now.found ? '' : ` ("${s.expect}" never appeared; at ${await page.evaluate(() => location.pathname)}: ${now.sample})`}${now.loading ? ' (still loading: ' + now.loadingWhat.join('; ') + ')' : ''}`);
  }
  // Whatever runs behind (the first-run download) finishes, as it would while the app sits open.
  await page.waitForTimeout(4000);
  const offlineCopy = await page.evaluate(async (unopened) => ({
    complete: !!(await window.TMAStore.get('offline:complete')),
    profile: !!(await window.TMAStore.get('settings:get:/me/profile')),
    unopened: ((await window.TMAStore.get('messages:thread:' + unopened)) || { messages: [] }).messages.length,
  }), SECTIONS.find((x) => x.unopened).path.split('=')[1]);
  check(offlineCopy.complete, 'the offline copy finished');
  check(offlineCopy.profile, 'it kept your profile without Settings being opened');
  check(offlineCopy.unopened > 0, 'it kept a chat nobody opened');
  await page.close();

  const dead = async (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    // As a phone or a Mac with no connection reports it. (Windows can say
    // online with the wifi off; the screens' failure paths cover that.)
    await p.addInitScript(() => {
      try { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false }); } catch (e) { /* as is */ }
    });
    await p.route('**/*', (route) => {
      const type = route.request().resourceType();
      // The shell and its files come from the app's own copy; data does not come at all.
      // The app's own icons are part of it too; pictures of people and data are not.
      const own = type === 'image' && !/^\/(portal|me|avatars?|mail|messaging)\b/.test(new URL(route.request().url()).pathname);
      return ['document', 'script', 'stylesheet', 'font'].includes(type) || own ? route.continue() : route.abort('internetdisconnected');
    });
    return p;
  };

  step(3, 'Close it, open it again with no connection, and go through the sections');
  const again = await dead(await context.newPage());
  await again.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  report(SECTIONS[0], await watch(again, SECTIONS[0].expect));
  for (const s of SECTIONS.slice(1).filter((x) => !x.unopened)) {
    await navigate(again, s.path);
    report(s, await watch(again, s.expect));
  }
  await again.close();

  step(4, 'Close it and open it straight onto each section, with no connection');
  for (const s of SECTIONS.slice(1)) {
    const reopened = await dead(await context.newPage());
    // Watched from the moment the app's code has run. Before that the shell
    // shows its boot placeholder while the bundle loads, which here is over
    // a dev server and in the apps is read from the device; how long that
    // took is reported, not judged.
    const t0 = Date.now();
    await reopened.goto(BASE + s.path, { waitUntil: 'domcontentloaded' });
    const boot = Date.now() - t0;
    const seen = await watch(reopened, s.expect, 3000);
    report({ ...s, name: `${s.name} (code ready after ${boot}ms)` }, seen);
    if (process.env.TMA_DEBUG && s.name === 'A conversation') {
      console.log('    debug:', await reopened.evaluate(async (id) => {
        const kept = await window.TMAStore.get('messages:thread:' + id);
        const warm = await window.TMAStore.get('messages:warm');
        return JSON.stringify({ kept: kept ? (kept.messages || []).length : null, warmRows: warm ? (warm.threads || []).map((t) => t.id) : null, id });
      }, s.path.split('=')[1]));
    }
    await reopened.close();
  }

  check(errors.length === 0, `no page errors${errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  failures.push(String(e));
  console.log('  FAIL  ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nALL PASS');
  process.exit(failures.length ? 1 : 0);
}
