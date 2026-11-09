import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';

/*
 * The write queue, delivering a filing made offline.
 *
 * cip-offline.mjs proves the whole round trip against a real server with the
 * network switched off. This pins the ways a filing used to be lost on the
 * way back, which a server cannot be made to produce on demand: a wifi that
 * says it is connected with no internet behind it, a write turned away to a
 * page, a server that is briefly unwell, a browser whose offline flag stays
 * stuck. Each is a mode of a small local server, so nothing here needs the
 * app running; only public/js/portal-queue.js is loaded, as it is in the portal.
 *
 *   node tests/Browser/queue-delivery.mjs
 *
 * The stuck-flag case waits out the queue's one-minute look, so a full run
 * takes a little over a minute and a half.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUEUE_JS = readFileSync(join(ROOT, 'public/js/portal-queue.js'), 'utf8');

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  browser = await chromium.launch({ channel: 'chrome' });
}

let failures = 0;
function check(ok, label) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label);
  if (!ok) failures += 1;
}

/* What each endpoint does right now. Flipped by the scenarios as they go. */
const mode = { filing: 'ok', edit: 'ok', me: 'ok' };
const hits = { filing: 0, edit: 0, me: 0 };

/*
 * A real server rather than Playwright's route handler: a 302 fulfilled
 * through a route makes fetch throw instead of following it, which is not
 * what a browser does with the sign-in page's redirect. A dead connection is
 * a socket destroyed mid-request, which fetch rejects the way it does on a
 * wifi with nothing behind it.
 */
const page404 = (res) => { res.writeHead(404); res.end(); };
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (status, type, body, headers) => {
    res.writeHead(status, Object.assign({ 'Content-Type': type }, headers || {}));
    res.end(body);
  };

  if (path === '/') {
    return send(200, 'text/html', '<!doctype html><meta charset="utf-8"><title>queue</title>' +
      '<script>' +
      'window.__toasts = [];' +
      'window.__events = [];' +
      'window.TMAPortalUI = { toast: function (m) { __toasts.push(m); }, toastError: function (m) { __toasts.push("error: " + m); } };' +
      'window.TMAStore = { invalidate: function () { return Promise.resolve(); } };' +
      '["applied", "failed", "discarded"].forEach(function (k) {' +
      '  document.addEventListener("tma:queue-" + k, function (e) { __events.push([k, e.detail]); });' +
      '});' +
      '</script>' +
      '<script src="/js/portal-queue.js"></script>');
  }
  if (path === '/js/portal-queue.js') return send(200, 'application/javascript', QUEUE_JS);
  if (path === '/login') return send(200, 'text/html', '<!doctype html><title>Sign in</title><form></form>');
  if (path === '/me') {
    hits.me += 1;
    if (mode.me === 'abort') return req.socket.destroy();

    return send(200, 'application/json', '{"id":7}');
  }

  const kind = path === '/portal/cip/applications' ? 'filing'
    : path.indexOf('/portal/cip/applications/') === 0 ? 'edit' : null;
  if (!kind) return page404(res);

  // Read the whole body first, as a server does, then answer.
  req.on('data', () => {});
  req.on('end', () => {
    hits[kind] += 1;
    switch (mode[kind]) {
      case 'abort':
        return req.socket.destroy();
      case 'redirect':
        return send(302, 'text/html', '', { Location: '/login' });
      case 'html':
        return send(200, 'text/html', '<!doctype html><title>Wifi login</title>');
      case 'unwell':
        return send(503, 'application/json', '{"message":"Down for a moment"}');
      case 'refuse':
        return send(422, 'application/json', '{"message":"The passport bio page is required.","errors":{}}');
      default:
        return send(kind === 'filing' ? 201 : 200, 'application/json',
          JSON.stringify({ application: { id: 'app-uuid', number: 'GLO26-00099', status: 'new' } }));
    }
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;

const context = await browser.newContext();
const page = await context.newPage();
/* The browser's offline flag, under the test's control for the stuck case. */
await page.addInitScript(() => {
  window.__online = true;
  Object.defineProperty(Navigator.prototype, 'onLine', { get: () => window.__online, configurable: true });
});
await page.goto(ORIGIN + '/');
await page.evaluate(() => window.TMAQueue.setAccount(7));

const filing = (name) => ({
  kind: 'cip.application',
  label: 'A new application for ' + name,
  url: '/portal/cip/applications',
  parts: [
    { name: 'firstName', value: name },
    { name: 'phase', value: 'pre_approval' },
    { name: 'submissionId', value: 'key-' + name },
  ],
  repeatable: true,
});

const add = (intent) => page.evaluate((i) => window.TMAQueue.add(i).then((e) => e.id), intent);
const entries = () => page.evaluate(() => window.TMAQueue.all());
const one = async (id) => (await entries()).filter((e) => e.id === id)[0] || null;
const until = async (fn, ms, label) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(250);
  }
  console.log('      (gave up waiting: ' + label + ')');

  return false;
};
const toasts = () => page.evaluate(() => window.__toasts.slice());
const events = (kind) => page.evaluate((k) => window.__events.filter((e) => e[0] === k).length, kind);
const online = () => page.evaluate(() => window.dispatchEvent(new Event('online')));
const reset = async () => {
  await page.evaluate(() => window.TMAQueue.all().then((list) =>
    Promise.all(list.map((e) => window.TMAQueue.forget(e.id)))));
  await page.evaluate(() => { window.__toasts.length = 0; window.__events.length = 0; });
  // Let a retry already scheduled by the last scenario run against an empty queue.
  await page.waitForTimeout(300);
};

/* ── 1. A wifi with no internet behind it ─────────────────────────── */
{
  mode.filing = 'abort';
  hits.filing = 0;
  const id = await add(filing('Ada'));
  // The old queue gave up after two tries five seconds apart.
  await until(async () => hits.filing >= 2, 9000, 'two tries');
  await page.waitForTimeout(500);
  const held = await one(id);
  check(hits.filing >= 2, 'no internet: the filing was tried, more than once');
  check(held && held.state === 'waiting', 'no internet: still waiting after its retries, not handed back as "Not sent"');
  check(held && /connection/i.test(held.error || ''), 'no internet: says why it has not gone yet (' + (held && held.error) + ')');
  check(await events('failed') === 0, 'no internet: nothing announced as failed');

  // The internet comes back. The queue's own next try sends it: nothing clicked.
  mode.filing = 'ok';
  const gone = await until(async () => !(await one(id)), 25000, 'the filing to land');
  check(gone, 'internet back: the filing landed by itself');
  check((await toasts()).indexOf('Application GLO26-00099 created') !== -1, 'internet back: the toast names the application it became');
  await reset();
}

/* ── 2. Turned away to a page, which fetch reads as a 200 ─────────── */
for (const how of ['redirect', 'html']) {
  mode.filing = how;
  const id = await add(filing('Bo-' + how));
  await until(async () => ((await one(id)) || {}).state === 'failed', 12000, how + ' to fail');
  const held = await one(id);
  check(!!held, how + ': the filing is still on this device (it used to be deleted as "synced")');
  check(await events('applied') === 0, how + ': nothing announced as synced');
  check(held && held.state === 'failed' && held.transient === true, how + ': handed to the reader, marked as worth trying again by itself');

  // The next time the connection comes back, it goes again without a click.
  mode.filing = 'ok';
  await online();
  check(await until(async () => !(await one(id)), 8000, how + ' revive'), how + ': back online, it was sent again by itself and landed');
  await reset();
}

/* ── 3. The server briefly unwell ─────────────────────────────────── */
{
  mode.filing = 'unwell';
  const id = await add(filing('Cy'));
  await until(async () => ((await one(id)) || {}).state === 'failed', 12000, '503 to fail');
  const held = await one(id);
  check(held && held.state === 'failed' && held.transient === true, 'server unwell: handed back after its retry, revivable');
  mode.filing = 'ok';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check(await until(async () => !(await one(id)), 8000, '503 revive'), 'server unwell: coming back to the tab sent it again, and it landed');
  await reset();
}

/* ── 4. Refused on its merits ─────────────────────────────────────── */
{
  mode.filing = 'refuse';
  const id = await add(filing('Di'));
  await until(async () => ((await one(id)) || {}).state === 'failed', 6000, '422 to fail');
  const held = await one(id);
  check(held && held.state === 'failed' && held.transient === false, 'refused: kept for a person, not marked for retrying');
  check(held && /passport/i.test(held.error || ''), 'refused: the server\'s reason is kept');
  mode.filing = 'ok';
  const before = hits.filing;
  await online();
  await page.waitForTimeout(1500);
  check(hits.filing === before && !!(await one(id)), 'refused: coming back online does not send it again');
  await reset();
}

/* ── 5. An edit that got no answer may have landed ────────────────── */
{
  mode.edit = 'abort';
  const id = await add({
    kind: 'cip.application',
    label: 'Changes to application GLO26-00001',
    url: '/portal/cip/applications/abc',
    parts: [{ name: 'firstName', value: 'Ed' }],
  });
  await until(async () => ((await one(id)) || {}).state === 'failed', 12000, 'edit to fail');
  const held = await one(id);
  check(held && held.state === 'failed' && held.transient === false, 'edit, no answer: goes to the reader after one retry, not resent by itself');
  mode.edit = 'ok';
  await online();
  await page.waitForTimeout(1500);
  check(!!(await one(id)), 'edit, no answer: still waiting for a person to send it again');
  await reset();
}

/* ── 6. Queued before the flag existed ────────────────────────────── */
{
  mode.filing = 'abort';
  hits.filing = 0;
  const legacy = filing('Fi');
  delete legacy.repeatable;
  const id = await add(legacy);
  await until(async () => hits.filing >= 2, 9000, 'legacy tries');
  await page.waitForTimeout(500);
  check(((await one(id)) || {}).state === 'waiting', 'older entry: its submission key alone keeps it waiting, not failed');
  mode.filing = 'ok';
  await reset();
}

/* ── 7. The browser's offline flag stuck after the connection is back ─ */
{
  await page.evaluate(() => { window.__online = false; });
  mode.filing = 'ok';
  hits.filing = 0;
  const id = await add(filing('Gu'));
  await page.waitForTimeout(1500);
  check(hits.filing === 0 && !!(await one(id)), 'stuck flag: nothing sent while the browser says it is offline');
  // The queue looks for the firm once a minute while something waits.
  const landed = await until(async () => !(await one(id)), 75000, 'probe');
  check(landed, 'stuck flag: the queue found the firm by itself and sent the filing');
  await page.evaluate(() => { window.__online = true; });
  await reset();
}

await browser.close();
server.close();

if (failures) {
  console.log('\n' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('\nAll queue delivery checks passed');
