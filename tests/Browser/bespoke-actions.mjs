/*
 * Bespoke AI action cards: a drafted message is reviewed, confirmed, and sent
 * by the reader's own click; a drafted email is handed to the Email page;
 * reply choices go back as the reader's message.
 *
 * The model is stubbed at the network layer (POST /portal/bespoke/chat is
 * intercepted), because the point is the browser flow and the real send
 * endpoint underneath it, not the language model.
 *
 * Seed (throwaway SQLite, never the live Postgres):
 *   DB_CONNECTION=sqlite DB_DATABASE="$DB" DB_URL= php artisan tinker --execute="
 *     App\Models\User::where('email','vernon@example.com')->exists() || App\Models\User::factory()->create([
 *       'name'=>'Vernon Francis','first_name'=>'Vernon','last_name'=>'Francis','email'=>'vernon@example.com',
 *       'status'=>'approved','account_type'=>'Administrator','job_title'=>'IT & Web Solutions Specialist',
 *       'email_verified_at'=>now(),'profile_completed_at'=>now(),'onboarding_completed_at'=>now()]);"
 * Serve with FEATURE_BESPOKE=true and --no-reload, then:
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/bespoke-actions.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

/* A fresh browser is a new device: the sign-in code is in the mail log, in
 * the postcard's letter-spaced cell (the email CSS is full of six-digit hex). */
function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}
try { writeFileSync(LOG, ''); } catch (e) { /* no log yet */ }
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|favicon/i;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

// ── sign in ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login-code')) {
  await page.waitForTimeout(900);
  const code = loginCode();
  if (!code) throw new Error(`no sign-in code in ${LOG}`);
  const digits = page.locator('.tma-auth__otp-digit');
  await digits.first().click();
  await page.keyboard.type(code, { delay: 40 });
  const trust = page.locator('input[type="checkbox"]').first();
  if (await trust.count()) await trust.check().catch(() => {});
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(900);
}
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/')) throw new Error('login failed: ' + page.url());
console.log('logged in');

// Who is Vernon in this database?
const vernon = await page.evaluate(async () => {
  const r = await fetch('/portal/messaging/contacts?q=vernon', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const j = await r.json();
  return (j.contacts || [])[0] || null;
});
if (!vernon) throw new Error('seed missing: vernon@example.com not reachable');

// ── stub the model ───────────────────────────────────────────────────────
let lastChatBody = null;
let scripted = null;
await page.route('**/portal/bespoke/chat', async (route) => {
  lastChatBody = route.request().postDataJSON();
  const reply = scripted || { reply: 'Stubbed.', actions: [], choices: [] };
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      reply: reply.reply,
      configured: true,
      source: 'model',
      conversationId: lastChatBody.conversationId,
      title: 'Stub',
      actions: reply.actions,
      choices: reply.choices,
    }),
  });
});

// ── open the launcher and ask ────────────────────────────────────────────
await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });

scripted = {
  reply: 'Here is a draft to Vernon Francis (IT & Web Solutions Specialist). Does it read right? Send is below.',
  actions: [{ type: 'message', to: { userId: vernon.id, name: 'Vernon Francis', jobTitle: 'IT & Web Solutions Specialist' }, body: 'Hi Vernon,\n\nI cannot open the File Library.' }],
  choices: [],
};
await page.fill('[data-bespoke-input]', 'message the IT person that I cannot open the File Library');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-bespoke-card="message"]', { timeout: 8000 });
check(await page.isVisible('[data-bespoke-card="message"] .tma-bespoke__card-body'), 'a drafted message card appears with an editable body');
check((await page.inputValue('[data-bespoke-card="message"] .tma-bespoke__card-body')).includes('File Library'), 'the card carries the drafted text');
check((await page.textContent('[data-bespoke-card="message"] .tma-bespoke__card-head')).includes('IT & Web Solutions Specialist'), 'the card names the recipient and their title');

// Edit the draft, then Send → the confirmation step, then Yes.
await page.fill('[data-bespoke-card="message"] .tma-bespoke__card-body', 'Hi Vernon,\n\nI cannot open the File Library. Edited in the card.');
await page.click('[data-bespoke-card="message"] .tma-bespoke__card-btn--primary');
await page.waitForSelector('[data-bespoke-card="message"] .tma-bespoke__card-ask', { timeout: 4000 });
check((await page.textContent('[data-bespoke-card="message"] .tma-bespoke__card-ask')).includes('Send this to Vernon Francis?'), 'Send asks once more before anything goes');
// "No" returns to the draft.
await page.click('[data-bespoke-card="message"] .tma-bespoke__card-btn--ghost');
check(await page.isVisible('[data-bespoke-card="message"] .tma-bespoke__card-btn--primary'), 'No returns to Send / Cancel without sending');

await page.click('[data-bespoke-card="message"] .tma-bespoke__card-btn--primary');
await page.waitForSelector('[data-bespoke-card="message"] .tma-bespoke__card-ask', { timeout: 4000 });
const [sendResponse] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/portal/bespoke/actions/send-message'), { timeout: 10000 }),
  page.click('[data-bespoke-card="message"] .tma-bespoke__card-btn--primary'),
]);
check(sendResponse.status() === 200, `the reader's Yes posts the send (status ${sendResponse.status()})`);
await page.waitForSelector('[data-bespoke-card="message"].is-done', { timeout: 6000 });
const doneText = await page.textContent('[data-bespoke-card="message"].is-done');
check(doneText.includes('Sent to Vernon Francis'), 'the card reports the send');
const link = await page.getAttribute('[data-bespoke-card="message"].is-done a', 'data-bespoke-nav');
check(!!link && link.startsWith('/social/messages?conversation='), `the card links to the thread (${link})`);

// The message really landed, with the edited text.
const landed = await page.evaluate(async (href) => {
  const uuid = new URL(href, location.origin).searchParams.get('conversation');
  const r = await fetch('/portal/messaging/conversations/' + encodeURIComponent(uuid) + '/messages', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  const list = j.messages || j.data || [];
  return { status: r.status, bodies: list.map((m) => m.body || '') };
}, link);
check(landed.status === 200 && landed.bodies.some((b) => b.includes('Edited in the card')), `the edited text is in the thread (${JSON.stringify(landed).slice(0, 160)})`);

// ── reply choices ────────────────────────────────────────────────────────
scripted = { reply: 'Which colleague?', actions: [], choices: ['Vernon Francis', 'Ada Admin'] };
await page.fill('[data-bespoke-input]', 'help me message someone');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-bespoke-choices] .tma-bespoke__chip', { timeout: 8000 });
const chips = await page.$$eval('[data-bespoke-choices] .tma-bespoke__chip', (els) => els.map((e) => e.textContent));
check(chips.join('|') === 'Vernon Francis|Ada Admin', `reply buttons appear (${chips.join(', ')})`);
scripted = { reply: 'Drafting.', actions: [], choices: [] };
await page.click('[data-bespoke-choices] .tma-bespoke__chip >> text=Ada Admin');
await page.waitForFunction(() => !document.querySelector('[data-bespoke-choices]'), null, { timeout: 4000 });
const lastUser = lastChatBody && lastChatBody.messages.filter((m) => m.role === 'user').pop();
check(lastUser && lastUser.content === 'Ada Admin', 'clicking a choice sends its label as the reader\'s message');

// ── email hand-off ───────────────────────────────────────────────────────
scripted = {
  reply: 'Here is the email. Open in Email to send it.',
  actions: [{ type: 'email', to: ['jane@example.com'], cc: [], subject: 'Updates required', body: 'Hello Jane,\n\nPlease upload the outstanding documents.' }],
  choices: [],
};
await page.fill('[data-bespoke-input]', 'email jane about the outstanding documents');
await page.keyboard.press('Enter');
await page.waitForSelector('[data-bespoke-card="email"]', { timeout: 8000 });
check((await page.textContent('[data-bespoke-card="email"] .tma-bespoke__card-subject')) === 'Updates required', 'the email card shows the subject');
await page.click('[data-bespoke-card="email"] .tma-bespoke__card-btn--primary');
await page.waitForFunction(() => location.pathname === '/email', null, { timeout: 10000 }).catch(() => {});
check(page.url().endsWith('/email'), `Open in Email navigates to the mailbox (${page.url()})`);
await page.waitForTimeout(1500);
const handoff = await page.evaluate(() => sessionStorage.getItem('tma.mail.pending-compose'));
check(handoff === null, 'the mail page consumed the hand-off (no mailbox connected here, so it opens nothing)');

// ── attachments: a real PDF, read by pdf.js in the browser, claimed by the real endpoint ──
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
await page.click('.tma-bespoke.is-open [data-bespoke-new]');
await page.unroute('**/portal/bespoke/chat');
let chatBody = null;
page.on('request', (r) => { if (r.url().includes('/portal/bespoke/chat') && r.method() === 'POST') chatBody = r.postDataJSON(); });
await page.setInputFiles('.tma-bespoke.is-open [data-bespoke-file]', 'tests/Browser/fixtures/contract.pdf');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-attach] .tma-bespoke__file--ready', { timeout: 20000 });
const chipText = await page.textContent('.tma-bespoke.is-open [data-bespoke-attach] .tma-bespoke__file--ready');
check(chipText.includes('contract.pdf'), `the picked PDF shows as a ready chip (${chipText.trim()})`);
await page.fill('.tma-bespoke.is-open [data-bespoke-input]', 'Summarize this PDF');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.tma-bespoke.is-open .tma-bespoke__row--assistant').length >= 1 && !document.querySelector('.tma-bespoke.is-open .tma-bespoke__typing'), null, { timeout: 20000 });
check(chatBody && Array.isArray(chatBody.attachments) && chatBody.attachments.length === 1, 'the chat request names the uploaded file');
check(await page.isVisible('.tma-bespoke.is-open .tma-bespoke__row--user .tma-bespoke__file'), 'the sent message carries the file chip');
check(!(await page.isVisible('.tma-bespoke.is-open [data-bespoke-attach]')), 'the pending strip clears after sending');
const stored = await page.evaluate(async (id) => {
  const r = await fetch('/portal/bespoke/conversations/' + encodeURIComponent(id), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const j = await r.json();
  const m = (j.conversation && j.conversation.messages || []).find((x) => x.role === 'user');
  return m && m.attachments && m.attachments[0] ? m.attachments[0] : null;
}, chatBody && chatBody.conversationId);
check(stored && stored.name === 'contract.pdf' && stored.hasText === true && stored.pages > 0, `the server holds the PDF with the text pdf.js read (${JSON.stringify(stored)})`);
check((await page.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, stored && stored.url)) === 200, 'the reader can fetch the bytes back');

await page.screenshot({ path: 'tests/Browser/bespoke-actions.png', fullPage: false });
await browser.close();

if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
if (fail.length) { console.log('FAILED:'); fail.forEach((f) => console.log('  - ' + f)); process.exit(1); }
if (errors.length) process.exit(1);
console.log('all good');
