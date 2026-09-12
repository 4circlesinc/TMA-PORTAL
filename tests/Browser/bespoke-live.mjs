/*
 * Bespoke AI live voice: the Talk live button beside Send opens a stage in
 * place of the log, the browser's speech recognition hears the reader, the
 * transcript goes through the same chat endpoint as typing, the reply is
 * captioned and read aloud with the markdown stripped, and the stage listens
 * again on its own. Muting the voice skips the reading; Back to chat returns
 * the log with both turns in it; leaving the full page ends its session.
 *
 * Neither speech API exists in headless Chromium in a usable form, so both
 * are faked before the portal loads: recognition delivers whatever the test
 * queued, synthesis records what it was asked to say. The model is stubbed at
 * the network layer as in bespoke-actions.mjs.
 *
 * Seed a throwaway SQLite with an approved Administrator (e2e@example.com /
 * password12345), serve with FEATURE_BESPOKE=true and --no-reload, build the
 * bundle, then:
 *   TMA_BASE_URL=http://127.0.0.1:8937 node tests/Browser/bespoke-live.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8937';
const LOG = process.env.TMA_LOG || 'storage/logs/laravel.log';

function loginCode() {
  const text = readFileSync(LOG, 'utf8');
  const hits = [...text.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];
  return hits.length ? hits[hits.length - 1][1] : null;
}
try { writeFileSync(LOG, ''); } catch (e) { /* no log yet */ }

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });

// Fake speech, installed before any portal script runs.
await context.addInitScript(() => {
  const fake = { queue: [], starts: 0, active: false, spoken: [], cancels: 0, lastLang: '' };
  window.__fakeSpeech = fake;
  class FakeRecognition {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; }
    start() {
      fake.starts++;
      fake.active = true;
      fake.lastLang = this.lang;
      const self = this;
      const text = fake.queue.shift();
      // A real browser waits several seconds of silence before no-speech.
      setTimeout(() => {
        if (!fake.active || self._aborted) return;
        if (!text) {
          self.onerror && self.onerror({ error: 'no-speech' });
          fake.active = false;
          self.onend && self.onend();
          return;
        }
        const partial = text.split(' ').slice(0, 2).join(' ');
        self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: partial }], { isFinal: false })] });
        setTimeout(() => {
          if (!fake.active || self._aborted) return;
          self.onresult && self.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
          fake.active = false;
          self.onend && self.onend();
        }, 120);
      }, text ? 120 : 1500);
    }
    abort() { this._aborted = true; fake.active = false; }
    stop() { this.abort(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; }
  }
  window.SpeechSynthesisUtterance = FakeUtterance;
  let current = null;
  const synth = {
    speaking: false,
    getVoices() { return [{ name: 'Fake Natural', lang: 'en-US', default: true, localService: false }]; },
    speak(u) {
      fake.spoken.push(u.text);
      current = u;
      synth.speaking = true;
      setTimeout(() => { if (current === u) u.onboundary && u.onboundary({ name: 'word' }); }, 30);
      setTimeout(() => {
        if (current !== u) return;
        current = null;
        synth.speaking = false;
        u.onend && u.onend();
      }, 160);
    },
    cancel() {
      fake.cancels++;
      const u = current;
      current = null;
      synth.speaking = false;
      if (u && u.onerror) u.onerror({ error: 'interrupted' });
    },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {}
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
});

const page = await context.newPage();
const IGNORE = /Origin not allowed|realtime disabled|Reverb|websocket|WebSocket|broadcasting\/auth|favicon/i;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push('pageerror: ' + e); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

async function onFailure(err) {
  console.log('STEP FAILED:', String(err).split('\n')[0]);
  try { await page.screenshot({ path: 'tests/Browser/_scratch-bespoke-live-fail.png' }); } catch (e) { /* ignore */ }
  if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
  try {
    console.log('url at failure:', page.url());
    console.log('state:', await page.evaluate(() => JSON.stringify({
      fake: window.__fakeSpeech,
      mode: (document.querySelector('[data-bespoke-stage]') || {}).getAttribute ? document.querySelector('[data-bespoke-stage]').getAttribute('data-mode') : null,
      status: (document.querySelector('[data-bespoke-live-status]') || {}).textContent,
    })));
  } catch (e) { console.log('state unavailable:', String(e).slice(0, 120)); }
  process.exit(1);
}
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

// ── sign in ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
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
    page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]'),
  ]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/')) throw new Error('login failed: ' + page.url());
console.log('logged in');

// ── stub the model ───────────────────────────────────────────────────────
let lastChatBody = null;
let scripted = { reply: 'Stubbed.', actions: [], choices: [] };
await page.route('**/portal/bespoke/chat', async (route) => {
  lastChatBody = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      reply: scripted.reply,
      configured: true,
      source: 'model',
      conversationId: lastChatBody.conversationId,
      title: 'Stub',
      actions: scripted.actions,
      choices: scripted.choices,
    }),
  });
});

const mode = () => page.getAttribute('.tma-bespoke [data-bespoke-stage]', 'data-mode');
const waitMode = (want, timeout = 6000) => page.waitForFunction(
  (w) => { const el = document.querySelector('.tma-bespoke [data-bespoke-stage]'); return !!el && el.getAttribute('data-mode') === w; },
  want, { timeout }
);

// ── the launcher ─────────────────────────────────────────────────────────
await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
const panelWidth = await page.evaluate(() => document.querySelector('.tma-bespoke__panel').getBoundingClientRect().width);
check(Math.round(panelWidth) === 420, `the panel is wider for the extra control (${Math.round(panelWidth)}px)`);
check(await page.isVisible('[data-bespoke-voice]'), 'Talk live sits in the composer beside Send');

await page.click('[data-bespoke-voice]');
await page.waitForSelector('.tma-bespoke [data-bespoke-stage]:not([hidden])', { timeout: 4000 });
check(await page.evaluate(() => document.querySelector('.tma-bespoke__panel').classList.contains('is-live')), 'the panel switches to the live stage');
check(!(await page.isVisible('.tma-bespoke [data-bespoke-form]')), 'the composer steps aside while live');
check(await page.isVisible('.tma-bespoke [data-bespoke-orb] img'), 'the mark sits in the orb');
await waitMode('listening');
check(await page.evaluate(() => window.__fakeSpeech.starts >= 1), 'listening starts on its own');
check((await page.evaluate(() => window.__fakeSpeech.lastLang)) === 'en-US', `recognition speaks the page language (${await page.evaluate(() => window.__fakeSpeech.lastLang)})`);
check(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-live-mic]').classList.contains('is-listening')), 'the mic button shows it is listening');
await page.screenshot({ path: 'tests/Browser/bespoke-live.png' });

// ── a spoken question, an answered reply ─────────────────────────────────
scripted = { reply: 'Open **All Files** from [File Library](/folders/all). Then choose a folder → Upload.', actions: [], choices: [] };
const before = await page.evaluate(() => window.__fakeSpeech.spoken.length);
await page.evaluate(() => { window.__fakeSpeech.queue.push('where is the file library'); });
// The current pass hears silence, ends, and the next start takes the queued text.
await waitMode('thinking', 8000);
check(await page.isVisible('.tma-bespoke [data-bespoke-live-caption]'), 'the transcript is captioned while it thinks');
await waitMode('speaking', 8000);
const lastUser = lastChatBody && lastChatBody.messages.filter((m) => m.role === 'user').pop();
check(lastUser && lastUser.content === 'where is the file library', 'the transcript goes through the chat endpoint as the reader\'s message');
check(lastChatBody && lastChatBody.clientContext && lastChatBody.clientContext.path === '/', 'the page context rides along as it does when typing');
const caption = await page.textContent('.tma-bespoke [data-bespoke-live-caption]');
check(caption.includes('Open All Files from File Library'), 'the reply is captioned');
check(await page.evaluate(() => !!document.querySelector('.tma-bespoke [data-bespoke-live-caption] a[data-bespoke-nav="/folders/all"]')), 'links in the caption stay links');
await waitMode('listening', 8000);
const spoken = await page.evaluate(() => window.__fakeSpeech.spoken);
check(spoken.length === before + 1 && spoken[spoken.length - 1] === 'Open All Files from File Library. Then choose a folder, then Upload.', `the reply is read without its markdown (${JSON.stringify(spoken.slice(-1)[0])})`);
check(await page.evaluate(() => window.__fakeSpeech.starts >= 2), 'it listens again after speaking');

// ── mute the voice ───────────────────────────────────────────────────────
await page.click('.tma-bespoke [data-bespoke-live-speaker]');
check((await page.getAttribute('.tma-bespoke [data-bespoke-live-speaker]', 'aria-pressed')) === 'true', 'the voice can be muted');
scripted = { reply: 'Quiet answer.', actions: [], choices: [] };
const spokenBefore = await page.evaluate(() => window.__fakeSpeech.spoken.length);
await page.evaluate(() => { window.__fakeSpeech.queue.push('say something quietly'); });
await waitMode('thinking', 8000);
await waitMode('listening', 8000);
check((await page.evaluate(() => window.__fakeSpeech.spoken.length)) === spokenBefore, 'a muted voice reads nothing aloud');
check((await page.textContent('.tma-bespoke [data-bespoke-live-caption]')).includes('Quiet answer.'), 'the reply is still captioned');
await page.click('.tma-bespoke [data-bespoke-live-speaker]');

// ── mic off and on ───────────────────────────────────────────────────────
await page.click('.tma-bespoke [data-bespoke-live-mic]');
await waitMode('idle', 4000);
check(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-live-mic]').classList.contains('is-off')), 'tapping the mic while listening turns it off');
check((await page.textContent('.tma-bespoke [data-bespoke-live-status]')).includes('Microphone off'), 'the status says so');
await page.click('.tma-bespoke [data-bespoke-live-mic]');
await waitMode('listening', 4000);
check(true, 'tapping again listens');

// ── back to chat ─────────────────────────────────────────────────────────
await page.click('.tma-bespoke [data-bespoke-live-end]');
check(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-stage]').hidden), 'Back to chat hides the stage');
check(await page.isVisible('.tma-bespoke [data-bespoke-form]'), 'the composer is back');
check(await page.evaluate(() => window.__fakeSpeech.active === false), 'recognition is stopped');
const bubbles = await page.$$eval('.tma-bespoke [data-bespoke-log] .tma-bespoke__bubble', (els) => els.map((e) => e.textContent.trim()));
check(bubbles.some((b) => b === 'where is the file library') && bubbles.some((b) => b.startsWith('Open All Files')), 'both spoken turns are in the chat log');
check(bubbles.some((b) => b === 'say something quietly') && bubbles.some((b) => b === 'Quiet answer.'), 'the muted turn is there too');

// Escape closes the panel and with it a running session.
await page.click('[data-bespoke-voice]');
await waitMode('listening');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.tma-bespoke').classList.contains('is-open'), null, { timeout: 4000 });
check(await page.evaluate(() => window.__fakeSpeech.active === false && document.querySelector('.tma-bespoke [data-bespoke-stage]').hidden), 'closing the panel ends the live session');

// ── the full page ────────────────────────────────────────────────────────
await page.click('.tma-dash__sidebar [data-nav="bespoke"]');
await page.waitForSelector('[data-bespoke-page-voice]', { timeout: 8000 });
check(await page.isVisible('[data-bespoke-page-voice]'), 'the full page composer has Talk live too');
await page.click('[data-bespoke-page-voice]');
await page.waitForFunction(() => {
  const el = document.querySelector('.tma-bespoke-page__thread [data-bespoke-stage]');
  return !!el && !el.hidden && el.getAttribute('data-mode') === 'listening';
}, null, { timeout: 6000 });
check(await page.evaluate(() => document.querySelector('.tma-bespoke-page__thread').classList.contains('is-live')), 'the page thread switches to the live stage');
await page.screenshot({ path: 'tests/Browser/bespoke-live-page.png' });
await page.click('.tma-dash__sidebar [data-nav="home"], .tma-dash__sidebar [data-nav="dashboard"], .tma-dash__sidebar a[href="/"]');
await page.waitForFunction(() => location.pathname === '/', null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
check(await page.evaluate(() => window.__fakeSpeech.active === false), 'leaving the page ends its live session');
check(await page.evaluate(() => {
  const el = document.querySelector('.tma-bespoke-page__thread [data-bespoke-stage]');
  return !el || el.hidden;
}), 'the page stage is put away');

// ── done ─────────────────────────────────────────────────────────────────
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
await browser.close();
if (fail.length || errors.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('\nall checks passed');
