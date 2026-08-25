/*
 * The home board's Requests and Comments tiles update themselves.
 *
 * Two live sessions and Reverb: one reader sits on the dashboard, somebody
 * else writes, and the tiles have to move without a reload. Everything below
 * is bounded well under the 60-second poll the tiles keep as a backstop —
 * a run that passed on the timer would prove nothing about the signal, which
 * is the whole subject.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';

/* Under the tiles' own 60s poll by a wide margin, so nothing here can pass
   because a timer happened to fire. */
const LIVE_BUDGET_MS = 15000;

const browser = await chromium.launch();
const fail = [];

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  if (page.url().includes('/auth/login')) throw new Error(`login failed for ${email}`);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button:has-text("Yes")'),
    ]);
  }
  return page;
}

/* The socket, not the poll. Asserted rather than assumed: with Reverb down
   every check below would still pass sixty seconds later, and the run would
   be reporting on the backstop. */
async function socketId(page) {
  for (let i = 0; i < 40; i++) {
    const id = await page.evaluate(
      () => (window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId) || ''
    );
    if (id) return id;
    await page.waitForTimeout(250);
  }
  return '';
}

/* A write, as this session, through the API the portal itself uses — including
   the socket header, so the actor is excluded from their own broadcast exactly
   as they are in the app. */
async function post(page, path, body) {
  return page.evaluate(async ([p, b]) => {
    const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    const res = await fetch(p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': m ? decodeURIComponent(m[1]) : '',
        'X-Socket-ID': (window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId) || '',
      },
      body: JSON.stringify(b),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, [path, body]);
}

/** Wait for `read` to satisfy `ok`, within the live budget. Returns the ms taken. */
async function waitLive(page, read, ok, what) {
  const started = Date.now();
  while (Date.now() - started < LIVE_BUDGET_MS) {
    if (ok(await read())) return Date.now() - started;
    await page.waitForTimeout(300);
  }
  fail.push(`${what} did not arrive within ${LIVE_BUDGET_MS}ms — the tile is not live`);
  return -1;
}

const reader = await signIn('e2e@example.com');
const writer = await signIn('ada@example.com');

const readerSocket = await socketId(reader);
const writerSocket = await socketId(writer);
console.log('sockets:', { reader: !!readerSocket, writer: !!writerSocket });
if (!readerSocket) fail.push('the reader never got a socket — start Reverb, or this run only tests the poll');
if (!writerSocket) fail.push('the writer never got a socket — its writes will not carry X-Socket-ID');

await reader.waitForSelector('[data-tile-id="comments"]', { timeout: 30000 });
await reader.waitForSelector('[data-tile-id="requests"]', { timeout: 30000 });
await reader.waitForTimeout(1500);

const commentBodies = () =>
  reader.$$eval('[data-tile-id="comments"] .tma-portal-comment-row__body',
    (ns) => ns.map((n) => n.textContent.trim()));
const requestFiles = () =>
  reader.$$eval('[data-tile-id="requests"] .tma-portal-request-row__file',
    (ns) => ns.map((n) => n.textContent.trim()));

console.log('before:', { comments: await commentBodies(), requests: await requestFiles() });

/* The file the writer will comment on / send a request about. The listing is
   per folder — the root returns the folder, not what is inside it. */
const files = await writer.evaluate(async () => {
  const read = async (q) =>
    (await (await fetch(`/portal/files?perPage=50${q}`, { headers: { Accept: 'application/json' } })).json());
  const root = await read('');
  let out = (root.files || []).map((f) => ({ id: f.id, name: f.name }));
  for (const folder of root.folders || []) {
    const inside = await read(`&folder=${folder.id}`);
    out = out.concat((inside.files || []).map((f) => ({ id: f.id, name: f.name })));
  }
  return out;
});
console.log('files visible to the writer:', files.map((f) => f.name));
const target = files.find((f) => f.name === 'Engagement Letter.pdf') || files[0];
if (!target) throw new Error('the writer can see no files — check the fixture');

/* ── 1. a comment arrives ─────────────────────────────────────── */
const said = `Live check ${Date.now()}`;
const readerId = await reader.evaluate(async () =>
  (await (await fetch('/me', { headers: { Accept: 'application/json' } })).json()).id);

const wrote = await post(writer, `/portal/files/files/${target.id}/comments`,
  { body: said, mentions: [readerId] });
console.log('posted a comment:', wrote.status);
if (wrote.status !== 201) fail.push(`could not post a comment (${wrote.status})`);

const commentMs = await waitLive(reader, commentBodies, (b) => b.includes(said), 'the comment');
console.log('the comment reached the tile in', commentMs, 'ms');

/* ── 2. a request arrives ─────────────────────────────────────── */
const before = (await requestFiles()).length;
const sent = await post(writer, `/portal/files/files/${target.id}/workflows`,
  { type: 'approval', recipients: [{ userId: readerId }] });
console.log('sent a request:', sent.status);
if (sent.status !== 201) fail.push(`could not send a request (${sent.status})`);

const requestMs = await waitLive(reader, requestFiles, (r) => r.length > before, 'the request');
console.log('the request reached the tile in', requestMs, 'ms');

/* ── 3. and cancelling it takes it back off ───────────────────── */
/*
 * Cancelled by the sender, deliberately, rather than answered by the reader:
 * the tile shows what is waiting on YOU, so only somebody else's write can
 * make a row leave it without the reader's own browser being the one that
 * changed anything. Answering is the sender's side, and PHPUnit has it
 * (DashboardWorkTest::test_answering_a_request_signals_the_people_on_it).
 */
const workflow = sent.body && sent.body.id;
if (!workflow) fail.push('the request came back without an id, so cancelling cannot be checked');
else {
  const cancelled = await post(writer, `/portal/files/files/${target.id}/workflows/${workflow}/cancel`, {});
  console.log('cancelled it:', cancelled.status);
  if (cancelled.status !== 200) fail.push(`could not cancel the request (${cancelled.status})`);

  const goneMs = await waitLive(reader, requestFiles, (r) => r.length === before,
    'the cancelled request leaving');
  console.log('the cancellation reached the tile in', goneMs, 'ms');
}

/* ── 4. a signal that lands while the board is off screen ─────── */
/*
 * The board refetches on a signal only while it is the view on screen —
 * refetching one nobody is looking at is pure cost. What it must NOT do is
 * conclude it is still fresh: it used to hand TMALive an `active` guard, which
 * returns before the freshness window is touched, so a comment written while
 * the reader was in Email left the board believing it was current and walking
 * back in under the minute showed them the old tile.
 */
await reader.click('.tma-dash__nav-item[data-nav="email"]');
await reader.waitForTimeout(1200);

const offScreen = `Off screen ${Date.now()}`;
const wroteAway = await post(writer, `/portal/files/files/${target.id}/comments`,
  { body: offScreen, mentions: [readerId] });
if (wroteAway.status !== 201) fail.push(`could not post the off-screen comment (${wroteAway.status})`);
await reader.waitForTimeout(2000);

await reader.click('.tma-dash__nav-item[data-nav="dash-dashboard"]');
await reader.waitForSelector('[data-tile-id="comments"]', { timeout: 30000 });
const backMs = await waitLive(reader, commentBodies, (b) => b.includes(offScreen),
  'a comment written while the board was off screen');
console.log('on the way back, the missed comment appeared in', backMs, 'ms');

console.log('after:', { comments: await commentBodies(), requests: await requestFiles() });
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'PASS');
await browser.close();
process.exit(fail.length ? 1 : 0);
