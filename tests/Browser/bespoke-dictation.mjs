/*
 * Bespoke AI dictation: the microphone beside Send puts what the reader
 * says into the message box — tentative words as they form, then the
 * final ones — and stops when they tap again, type, send, or press
 * Escape. Sending goes through the same chat endpoint as typing. Existing
 * text is kept and the words follow it. The browser's continuous
 * recognition ends a session after silence and is started again until the
 * reader stops; where recognition has no service (the desktop shell,
 * Brave), a clip is recorded phrase by phrase and transcribed by the
 * server, and that choice is remembered per browser.
 *
 * Headless Chromium has the recognition constructor but no service behind
 * it, so it is faked in addInitScript: continuous, delivering whatever the
 * test queues on `window.__fakeSpeech.queue` as an interim then a final
 * result, holding a silent session open while `hold` is on. The model is
 * stubbed at the network layer as in bespoke-actions.mjs, and so is
 * /portal/bespoke/suggestions (`configured: true`, or a keyless harness
 * server would make the widget refuse the server ear).
 *
 * A second browser then plays the desktop shell: every recognition start
 * fails with `network`, Chromium's fake microphone plays a looped WAV of
 * silence and tone, the real MediaRecorder and level meter cut the phrase,
 * and POST /portal/bespoke/transcribe is stubbed like the model.
 *
 * Seed a throwaway SQLite with an approved Administrator (e2e@example.com /
 * password12345), serve with FEATURE_BESPOKE=true and --no-reload, build the
 * bundle, then:
 *   TMA_BASE_URL=http://127.0.0.1:8937 node tests/Browser/bespoke-dictation.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8937';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}

// Fake recognition, installed before any portal script runs. Continuous:
// it keeps taking lines from the queue until aborted; with the hold off a
// silent stretch of 3 s ends the session the way Chrome does.
const fakeSpeech = ({ mode }) => {
  const fake = { queue: [], starts: 0, active: false, lastLang: '', mode, log: [], hold: mode === 'ok', continuous: null };
  const T0 = Date.now();
  fake.note = (what) => { fake.log.push(((Date.now() - T0) / 1000).toFixed(2) + ' ' + what); };
  window.__fakeSpeech = fake;
  class FakeRecognition {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; this._results = []; }
    start() {
      fake.starts++;
      fake.active = true;
      fake.lastLang = this.lang;
      fake.continuous = this.continuous;
      fake.note('start#' + fake.starts);
      const self = this;
      this._since = Date.now();
      if (fake.mode === 'network') {
        setTimeout(() => {
          self._aborted = true;
          fake.active = false;
          self.onerror && self.onerror({ error: 'network' });
          self.onend && self.onend();
        }, 60);
        return;
      }
      this._timer = setInterval(() => {
        if (self._aborted) return;
        const text = fake.queue.shift();
        if (text === undefined) {
          if (!fake.hold && Date.now() - self._since > 3000) self._end();
          return;
        }
        self._since = Date.now();
        const idx = self._results.length;
        self._results[idx] = Object.assign([{ transcript: text.split(' ').slice(0, 2).join(' ') }], { isFinal: false });
        self.onresult && self.onresult({ resultIndex: idx, results: self._results.slice() });
        setTimeout(() => {
          if (self._aborted) return;
          self._results[idx] = Object.assign([{ transcript: ' ' + text }], { isFinal: true });
          self.onresult && self.onresult({ resultIndex: idx, results: self._results.slice() });
          self._since = Date.now();
          if (!self.continuous) self._end();
        }, 120);
      }, 60);
    }
    _end() { clearInterval(this._timer); fake.active = false; fake.note('end'); this.onend && this.onend(); }
    abort() { fake.note('abort'); this._aborted = true; clearInterval(this._timer); fake.active = false; }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
};

const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|favicon/i;
const errors = [];
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

function watch(page) {
  page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
}

let page = null;
async function onFailure(err) {
  console.log('STEP FAILED:', String(err).split('\n')[0]);
  try { await page.screenshot({ path: 'tests/Browser/_scratch-bespoke-dictation-fail.png' }); } catch (e) { /* ignore */ }
  if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
  try {
    console.log('trace:', await page.evaluate(() => JSON.stringify((window.__fakeSpeech.log || []).slice(-30))));
    console.log('state:', await page.evaluate(() => JSON.stringify({
      fake: { queue: window.__fakeSpeech.queue, starts: window.__fakeSpeech.starts, active: window.__fakeSpeech.active },
      dictation: (() => { const d = window.TMABespoke.dictation(); return d ? { active: d.active, engine: d.engine, base: d.base, committed: d.committed, interim: d.interim, busy: d.busy } : null; })(),
      input: (document.querySelector('.tma-bespoke [data-bespoke-input]') || {}).value,
    })));
  } catch (e) { console.log('state unavailable:', String(e).slice(0, 120)); }
  process.exit(1);
}
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

// ── sign in ──────────────────────────────────────────────────────────────
async function signIn(p) {
  try { writeFileSync(LOG, ''); } catch (e) { /* ignore */ }
  await p.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await p.click('text=Sign in with Email');
  await p.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await p.fill('input[name="email"]', 'e2e@example.com');
  await p.fill('input[name="password"]', 'password12345');
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    p.click('button[type="submit"]:visible'),
  ]);
  if (p.url().includes('/auth/login-code')) {
    await p.waitForTimeout(900);
    const code = loginCode();
    if (!code) throw new Error(`no sign-in code in ${LOG}`);
    const digits = p.locator('.tma-auth__otp-digit');
    await digits.first().click();
    await p.keyboard.type(code, { delay: 40 });
    const trust = p.locator('input[type="checkbox"]').first();
    if (await trust.count()) await trust.check().catch(() => {});
    await Promise.all([p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), p.click('button[type="submit"]:visible')]);
    await p.waitForTimeout(900);
  }
  if (p.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      p.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      p.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
    ]);
    await p.waitForTimeout(700);
  }
  if (p.url().includes('/auth/')) throw new Error('login failed: ' + p.url());
  console.log('logged in');
}

// ── stub the model ───────────────────────────────────────────────────────
let lastChatBody = null;
let scripted = { reply: 'Stubbed.', actions: [], choices: [] };
async function stubModel(p) {
  await p.route('**/portal/bespoke/chat', async (route) => {
    lastChatBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: scripted.reply, configured: true, source: 'model',
        conversationId: lastChatBody.conversationId, title: 'Stub',
        actions: scripted.actions, choices: scripted.choices,
      }),
    });
  });
  await p.route('**/portal/bespoke/suggestions*', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.configured = true;
    await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(json) });
  });
}

const MIC = '.tma-bespoke [data-bespoke-mic]';
const INPUT = '.tma-bespoke [data-bespoke-input]';
const listening = () => page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'));
const inputValue = () => page.inputValue(INPUT);
const waitValue = (want, timeout = 6000) => page.waitForFunction(
  (w) => (document.querySelector('.tma-bespoke [data-bespoke-input]') || {}).value === w, want, { timeout }
);
const say = (text) => page.evaluate((t) => { window.__fakeSpeech.queue.push(t); }, text);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.addInitScript(fakeSpeech, { mode: 'ok' });
page = await context.newPage();
watch(page);
await signIn(page);
await stubModel(page);

// ── the microphone ───────────────────────────────────────────────────────
await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
check(await page.isVisible(MIC), 'a microphone sits in the composer beside Send');
check((await page.getAttribute(MIC, 'aria-label')) === 'Dictate', 'it is labelled Dictate');

await page.click(MIC);
await page.waitForFunction(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
check((await page.getAttribute(INPUT, 'placeholder')) === 'Listening…', 'the box says it is listening');
check(await page.evaluate(() => window.__fakeSpeech.continuous === true && window.__fakeSpeech.lastLang === 'en-US'), 'recognition is continuous and in the page language');

await say('where is the file library');
await page.waitForFunction(() => /^where is/.test((document.querySelector('.tma-bespoke [data-bespoke-input]') || {}).value), null, { timeout: 4000 });
const tentative = await inputValue();
await waitValue('where is the file library ');
check(tentative !== 'where is the file library ', `tentative words show first (${JSON.stringify(tentative)}), then the final ones`);
check(await listening(), 'it keeps listening after a phrase');
await say('and how do I pin a folder');
await waitValue('where is the file library and how do I pin a folder ');
check(true, 'a second phrase follows the first');
check((await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-send]').disabled)) === false, 'Send wakes up as words arrive');

// Send goes through the chat like typing, and ends the dictation.
scripted = { reply: 'File Library is in the sidebar.', actions: [], choices: [] };
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.tma-bespoke [data-bespoke-log] .tma-bespoke__bubble').length >= 2, null, { timeout: 8000 });
const sentUser = lastChatBody && lastChatBody.messages.filter((m) => m.role === 'user').pop();
check(sentUser && sentUser.content === 'where is the file library and how do I pin a folder', 'Enter sends the dictated words as the reader\'s message');
check(!(await listening()) && (await page.evaluate(() => window.__fakeSpeech.active === false)), 'sending stops the ear');
check((await inputValue()) === '' && (await page.getAttribute(INPUT, 'placeholder')) === 'Ask about this portal', 'the box is cleared and its placeholder restored');

// Existing text is kept; the words follow it.
await page.fill(INPUT, 'Please');
await page.click(MIC);
await page.waitForFunction(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
await say('help me with signatures');
await waitValue('Please help me with signatures ');
check(true, 'typed text stays and the words follow it');

// Tapping the mic stops; tentative words are kept.
await say('and templates');
await page.waitForFunction(() => /and templates$/.test((document.querySelector('.tma-bespoke [data-bespoke-input]') || {}).value) === false && /and/.test((document.querySelector('.tma-bespoke [data-bespoke-input]') || {}).value), null, { timeout: 4000 }).catch(() => {});
await waitValue('Please help me with signatures and templates ');
await page.click(MIC);
check(!(await listening()), 'tapping the mic again stops it');
check((await inputValue()) === 'Please help me with signatures and templates ', 'what was said stays in the box');

// Typing stops it.
await page.fill(INPUT, '');
await page.click(MIC);
await page.waitForFunction(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
await page.type(INPUT, 'hi');
await page.waitForFunction(() => !document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
check(await page.evaluate(() => window.__fakeSpeech.active === false), 'typing in the box stops the ear');

// Escape stops it and leaves the panel open.
await page.fill(INPUT, '');
await page.click(MIC);
await page.waitForFunction(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
check(await page.evaluate(() => document.querySelector('.tma-bespoke').classList.contains('is-open')), 'Escape stops the ear and keeps the panel open');

// A session the browser ends after silence is started again.
await page.evaluate(() => { window.__fakeSpeech.hold = false; });
const startsBefore = await page.evaluate(() => window.__fakeSpeech.starts);
await page.click(MIC);
await page.waitForFunction((n) => window.__fakeSpeech.starts > n + 1, startsBefore, { timeout: 10000 });
check(await listening(), 'a session the browser ends after silence is started again while the reader has not stopped');
await page.evaluate(() => { window.__fakeSpeech.hold = true; });
await say('still here');
await waitValue('still here ');
check(true, 'and the next phrase still lands');
await page.screenshot({ path: 'tests/Browser/bespoke-dictation.png' });

// Closing the panel stops it.
await page.click('.tma-bespoke [data-bespoke-close]');
await page.waitForFunction(() => !document.querySelector('.tma-bespoke').classList.contains('is-open'), null, { timeout: 4000 });
check(await page.evaluate(() => window.__fakeSpeech.active === false), 'closing the panel stops the ear');

// The full page has the microphone too, and leaving the page stops it.
await page.click('.tma-dash__sidebar [data-nav="bespoke"]');
await page.waitForSelector('[data-bespoke-page-mic]', { timeout: 8000 });
check(await page.isVisible('[data-bespoke-page-mic]'), 'the full page composer has the microphone too');
await page.click('[data-bespoke-page-mic]');
await page.waitForFunction(() => document.querySelector('[data-bespoke-page-mic]').classList.contains('is-listening'), null, { timeout: 4000 });
await say('a page question');
await page.waitForFunction(() => (document.querySelector('[data-bespoke-page-input]') || {}).value === 'a page question ', null, { timeout: 4000 });
check(true, 'words land in the page composer');
await page.click('.tma-dash__sidebar a[href="/"]');
await page.waitForFunction(() => location.pathname === '/', null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__fakeSpeech.active === false), 'leaving the page stops its ear');
await browser.close();

// ── the server ear ───────────────────────────────────────────────────────
function toneWav(path) {
  const rate = 48000;
  const secs = [[1.0, 0], [1.5, 0.5], [3.0, 0]];
  const frames = secs.reduce((n, [s]) => n + Math.round(s * rate), 0);
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + frames * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(frames * 2, 40);
  let i = 0;
  for (const [s, amp] of secs) {
    const n = Math.round(s * rate);
    for (let k = 0; k < n; k++, i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * k) / rate) * amp * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}
const wav = join(tmpdir(), 'tma-bespoke-dictation-tone.wav');
toneWav(wav);

const browser2 = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context2 = await browser2.newContext({ viewport: { width: 1400, height: 950 } });
await context2.addInitScript(fakeSpeech, { mode: 'network' });
page = await context2.newPage();
watch(page);
await signIn(page);
await stubModel(page);

const clips = [];
const transcripts = ['open the file library', 'and pin it', ''];
await page.route('**/portal/bespoke/transcribe', async (route) => {
  const body = route.request().postDataBuffer();
  clips.push({ bytes: body ? body.length : 0, text: body ? body.toString('latin1') : '' });
  const text = transcripts.length ? transcripts.shift() : '';
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text }) });
});

await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
if (!(await page.evaluate(() => document.querySelector('.tma-bespoke').classList.contains('is-open')))) await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
check(await page.isVisible(MIC), 'the microphone is offered where recognition exists but has no service');
await page.click(MIC);
await page.waitForFunction(() => window.__fakeSpeech.starts >= 1 && localStorage.getItem('tma.bespoke.voiceEngine') === 'server', null, { timeout: 6000 });
check(await listening(), 'a network failure hands the ear to the server without stopping');
await waitValue('open the file library ', 25000);
check(clips.length >= 1 && clips[0].bytes > 2000 && /name="audio"; filename="speech\.webm"/.test(clips[0].text) && /name="language"\r\n\r\nen/.test(clips[0].text), `a recorded phrase is uploaded with its container and language (${clips[0] ? clips[0].bytes : 0} bytes)`);
check(true, 'the words land in the box');
await waitValue('open the file library and pin it ', 25000);
check(true, 'the next phrase is recorded and follows');
check((await page.evaluate(() => window.__fakeSpeech.starts)) === 1, 'the browser ear is not tried again once the server has it');
await page.click(MIC);
check(!(await listening()) && (await inputValue()) === 'open the file library and pin it ', 'tapping the mic stops the recorder and keeps the words');
await page.screenshot({ path: 'tests/Browser/bespoke-dictation-server-ear.png' });

// A fresh page in this browser goes straight to the server ear.
const page2 = await context2.newPage();
page = page2;
watch(page2);
await stubModel(page2);
await page2.route('**/portal/bespoke/transcribe', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '' }) }));
await page2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
if (!(await page2.evaluate(() => document.querySelector('.tma-bespoke').classList.contains('is-open')))) await page2.click('[data-bespoke-fab]');
await page2.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
await page2.click(MIC);
await page2.waitForFunction(() => document.querySelector('.tma-bespoke [data-bespoke-mic]').classList.contains('is-listening'), null, { timeout: 6000 });
await page2.waitForTimeout(500);
check((await page2.evaluate(() => window.__fakeSpeech.starts)) === 0, 'the remembered choice skips the failing ear on the next visit');
await page2.click(MIC);

// ── done ─────────────────────────────────────────────────────────────────
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
await browser2.close();
if (fail.length || errors.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('\nall checks passed');
