import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/*
 * Messages with no connection, the way WhatsApp behaves.
 *
 * What only a browser can prove: an opened conversation is still there with
 * the network gone; a message written offline is kept, says "Waiting to
 * send", and goes on its own when the connection is back; a send whose
 * answer was lost on the way back (the server HAS it) does not post twice
 * when it is retried, because the nonce makes the replay land once; and a
 * message still waiting survives a reload and is drawn again from the queue.
 *
 * The offline switch is Playwright's, on the CONTEXT, so fetch rejects the
 * way it does on a train instead of answering a status code; a status code
 * means the server disagreed and must not be queued.
 *
 * Setup: the standard throwaway server (README) plus a second person,
 * "Rita Officer" <rita@example.com>. Uses the installed Google Chrome unless
 * CHROME_BIN says otherwise.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8931';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';
const PASSWORD = 'password12345';
// Each run's own words, so a rerun against the same database counts only its own.
const RUN = ' #' + Date.now().toString(36);
// The sign-in code goes out by email; with MAIL_MAILER=log it is in the log.
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const all = [...readFileSync(LOG, 'utf8').matchAll(/letter-spacing:[^>]*>\s*(\d{6})\s*</g)];
  return all.length ? all[all.length - 1][1] : null;
}

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
const step = (n, label) => console.log(`\n${n}. ${label}`);

const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// The terms and cookie notice has been accepted already, as it would have been.
await context.addInitScript(() => { try { localStorage.setItem('tma.legalAccepted', '1'); } catch (e) { /* asked instead */ } });
// As the Mac, Windows, iPhone and Android apps run it: an installed app keeps
// its copy on disk (TMAStore's IndexedDB tier), where a browser keeps it in
// the tab. TMA_AS_BROWSER=1 runs it the browser's way instead.
if (!process.env.TMA_AS_BROWSER) {
  await context.addInitScript(() => { if (!window.TMADesktop) window.TMADesktop = { isDesktop: true, platform: 'darwin' }; });
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const api = (path, options) => page.evaluate(async ([base, path, options]) => {
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

/* How many times the server has a message with exactly this text. */
const onServer = async (conversation, body) => {
  const res = await api(`/portal/messaging/conversations/${conversation}/messages`);
  return ((res.body && res.body.messages) || []).filter((m) => m.body === body).length;
};

/* The last message I wrote: its text and the word under it. */
const lastOut = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tma-dash__messages-bubble-row--out')];
  const row = rows[rows.length - 1];
  if (!row) return null;
  const status = row.querySelector('.tma-dash__messages-bubble-status');
  return {
    text: row.textContent,
    state: status ? [...status.classList].find((c) => c.includes('--'))?.split('--')[1] : null,
    label: status ? status.textContent.replace(/^·\s*/, '').trim() : '',
  };
});

const waitFor = async (fn, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await page.waitForTimeout(300);
  }
  return false;
};

const send = async (text) => {
  await page.click('[data-messages-composer-input]');
  await page.keyboard.type(text);
  await page.click('[data-messages-composer-send]');
  await page.waitForTimeout(800);
};

try {
  step(1, 'Sign in and open a conversation with some history');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
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
  check(!page.url().includes('/auth/'), `signed in (at ${new URL(page.url()).pathname})`);

  const contacts = await api('/portal/messaging/contacts?q=Rita');
  const rita = ((contacts.body && contacts.body.contacts) || []).find((p) => p.name === 'Rita Officer');
  check(!!rita, `Rita is someone to message (contacts answered ${contacts.status}${rita ? '' : ': ' + JSON.stringify(contacts.body).slice(0, 200)})`);
  const direct = await api('/portal/messaging/conversations', { method: 'POST', json: { userId: rita.id } });
  const conversation = direct.body.conversation.id;
  for (const body of ['First from before' + RUN, 'Second from before' + RUN]) {
    await api(`/portal/messaging/conversations/${conversation}/messages`, { method: 'POST', json: { body, nonce: crypto.randomUUID() } });
  }
  await page.goto(`${BASE}/social/messages?conversation=${conversation}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-bubble', { timeout: 15000 });
  await page.waitForTimeout(1500); // the copy kept on the device is written behind the paint
  check(await page.locator('.tma-dash__messages-bubble').count() >= 2, 'the history is on screen');

  step(2, 'Network off: leave Messages and come back');
  await context.setOffline(true);
  await page.evaluate(() => document.querySelector('.tma-dash')._portalNavigate('/'));
  await page.waitForTimeout(800);
  await page.evaluate((c) => document.querySelector('.tma-dash')._portalNavigate('/social/messages?conversation=' + c), conversation);
  await page.waitForTimeout(1200);
  check((await page.locator('.tma-dash__messages-bubble', { hasText: 'Second from before' + RUN }).count()) === 1, 'the conversation is still there, with no network');

  step(3, 'Still offline: write a message');
  await send('From the train' + RUN);
  let out = await lastOut();
  check(out && out.text.includes('From the train' + RUN), 'the message is in the conversation');
  check(out && out.state === 'queued', `it says it is waiting (state ${out && out.state})`);
  check(out && out.label === 'Waiting to send', `in words: "${out && out.label}"`);
  check(await page.evaluate(async () => (await window.TMAQueue.all()).filter((e) => e.kind === 'message').length) === 1, 'it is kept in the queue on this device');

  step(4, 'The connection comes back: it sends on its own, once');
  await context.setOffline(false);
  check(await waitFor(async () => { const o = await lastOut(); return o && (o.state === 'sent' || o.state === 'delivered'); }), 'it reads Sent without anyone pressing anything');
  check(await onServer(conversation, 'From the train' + RUN) === 1, 'the server has it exactly once');
  check(await page.evaluate(async () => (await window.TMAQueue.all()).length) === 0, 'and the queue is empty');

  step(5, 'A send whose answer is lost on the way back is not posted twice');
  await context.setOffline(true);
  await send('Answer lost on the way back' + RUN);
  let lostOnce = false;
  await page.route('**/portal/messaging/conversations/*/messages', async (route) => {
    if (route.request().method() === 'POST' && !lostOnce) {
      lostOnce = true;
      await route.fetch(); // the server receives and stores it...
      return route.abort('failed'); // ...and the page never hears so.
    }
    return route.continue();
  });
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  check(lostOnce, 'the first answer was lost');
  await page.evaluate(() => window.TMAQueue.flush());
  check(await waitFor(async () => { const o = await lastOut(); return o && (o.state === 'sent' || o.state === 'delivered'); }, 30000), 'the retry lands');
  check(await onServer(conversation, 'Answer lost on the way back' + RUN) === 1, 'and the server still has it exactly once');
  await page.unroute('**/portal/messaging/conversations/*/messages');

  step(6, 'A message still waiting survives a reload');
  await page.route('**/portal/messaging/conversations/*/messages', (route) => (
    route.request().method() === 'POST' ? route.abort('failed') : route.continue()
  ));
  await send('Kept across a reload' + RUN);
  out = await lastOut();
  check(out && out.state === 'queued', 'waiting while the server cannot be reached');
  // Reopened from scratch, as after quitting the app: the page and its memory are new.
  await page.goto(`${BASE}/social/messages?conversation=${conversation}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-bubble', { timeout: 15000 });
  check(await waitFor(async () => (await page.locator('.tma-dash__messages-bubble-row--out', { hasText: 'Kept across a reload' + RUN }).count()) === 1, 8000), 'after the reload it is back in the conversation');
  out = await lastOut();
  check(out && out.state === 'queued' && out.text.includes('Kept across a reload' + RUN), 'still saying it is waiting');
  await page.unroute('**/portal/messaging/conversations/*/messages');
  await page.evaluate(() => window.TMAQueue.flush());
  const landed = await waitFor(async () => { const o = await lastOut(); return o && (o.state === 'sent' || o.state === 'delivered'); }, 30000);
  if (!landed) {
    console.log('      queue:', JSON.stringify(await page.evaluate(async () => (await window.TMAQueue.all()).map((e) => ({ kind: e.kind, state: e.state, tries: e.tries, error: e.error, account: e.account })))));
    console.log('      last bubble:', JSON.stringify(await lastOut()));
  }
  check(landed, 'it sends once the server can be reached');
  const copies = await onServer(conversation, 'Kept across a reload' + RUN);
  check(copies === 1, `exactly once (the server has ${copies})`);

  if (!process.env.TMA_AS_BROWSER) {
    step(7, 'Reopened from nothing, with the server\'s messages unreachable: the conversation is on the device');
    await page.waitForTimeout(1200); // the copy is written behind the last change
    const fresh = await context.newPage();
    fresh.on('pageerror', (e) => errors.push(e.message));
    await fresh.route('**/portal/messaging/conversations/*/messages**', (route) => route.abort('failed'));
    await fresh.goto(`${BASE}/social/messages?conversation=${conversation}`, { waitUntil: 'domcontentloaded' });
    const painted = await fresh.waitForSelector('.tma-dash__messages-bubble', { timeout: 15000 }).then(() => true, () => false);
    if (!painted) {
      console.log('      on the fresh page:', JSON.stringify(await fresh.evaluate(async (c) => {
        const kept = window.TMAStore ? await window.TMAStore.get('messages:thread:' + c) : null;
        return {
          persistent: !!(window.TMAStore && window.TMAStore.persistent),
          kept: kept && kept.messages ? kept.messages.length : null,
          bubbles: document.querySelectorAll('.tma-dash__messages-bubble').length,
          url: location.pathname + location.search,
        };
      }, conversation)));
      console.log('      on the first page:', JSON.stringify(await page.evaluate(async (c) => {
        const kept = window.TMAStore ? await window.TMAStore.get('messages:thread:' + c) : null;
        return { persistent: !!(window.TMAStore && window.TMAStore.persistent), kept: kept && kept.messages ? kept.messages.length : null };
      }, conversation)));
    }
    check(painted, 'the conversation paints with no answer from the server');
    check((await fresh.locator('.tma-dash__messages-bubble', { hasText: 'Kept across a reload' + RUN }).count()) === 1, 'including the latest message');
    check((await fresh.locator('.tma-dash__messages-bubble', { hasText: 'First from before' + RUN }).count()) === 1, 'and the history before it');
    await fresh.close();
  }

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failures++;
  console.log('FAIL  ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}
