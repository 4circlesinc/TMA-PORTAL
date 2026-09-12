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
 * A second browser then plays the desktop shell: recognition exists but
 * every start fails with `network`, so the stage must hand the ear to the
 * server — a real MediaRecorder on Chromium's fake microphone (a looped
 * WAV of silence and tone), the real level meter deciding when the reader
 * has finished, and POST /portal/bespoke/transcribe stubbed like the model.
 *
 * Seed a throwaway SQLite with an approved Administrator (e2e@example.com /
 * password12345), serve with FEATURE_BESPOKE=true and --no-reload, build the
 * bundle, then:
 *   TMA_BASE_URL=http://127.0.0.1:8937 node tests/Browser/bespoke-live.mjs
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
try { writeFileSync(LOG, ''); } catch (e) { /* no log yet */ }

// Fake speech, installed before any portal script runs. `mode: 'network'`
// makes every recognition start fail the way Chromium does where no Google
// speech service backs the API (the desktop shell, Brave).
const fakeSpeech = ({ mode }) => {
  const fake = { queue: [], starts: 0, active: false, spoken: [], cancels: 0, lastLang: '', mode, log: [], hold: mode === 'ok' };
  const T0 = Date.now();
  fake.note = (what) => { fake.log.push(((Date.now() - T0) / 1000).toFixed(2) + ' ' + what); };
  window.__fakeSpeech = fake;
  class FakeRecognition {
    constructor() { this.lang = ''; this.interimResults = false; this.continuous = false; }
    start() {
      fake.starts++;
      fake.active = true;
      fake.lastLang = this.lang;
      const self = this;
      const text = fake.mode === 'network' ? null : fake.queue.shift();
      fake.note('start#' + fake.starts + (text ? ' text=' + JSON.stringify(text) : ' silent'));
      if (fake.mode === 'network') {
        setTimeout(() => {
          fake.active = false;
          self.onerror && self.onerror({ error: 'network' });
          self.onend && self.onend();
        }, 60);
        return;
      }
      // A real browser waits several seconds of silence before no-speech;
      // software WebGL makes the page slow, so the pass must outlast a
      // few round trips of the test.
      if (!text && fake.hold) return; // held open until the test says otherwise
      setTimeout(() => {
        if (!fake.active || self._aborted) return;
        if (!text) {
          fake.note('no-speech#' + fake.starts);
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
      }, text ? 120 : 3000);
    }
    abort() { fake.note('abort'); this._aborted = true; fake.active = false; }
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
      const words = [...String(u.text).matchAll(/\S+/g)];
      const per = 90;
      setTimeout(() => { if (current === u) u.onstart && u.onstart(); }, 10);
      words.forEach((m, i) => {
        setTimeout(() => { if (current === u) u.onboundary && u.onboundary({ name: 'word', charIndex: m.index, charLength: m[0].length }); }, 20 + i * per);
      });
      setTimeout(() => {
        if (current !== u) return;
        current = null;
        synth.speaking = false;
        u.onend && u.onend();
      }, 40 + Math.max(1, words.length) * per);
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
  try { await page.screenshot({ path: 'tests/Browser/_scratch-bespoke-live-fail.png' }); } catch (e) { /* ignore */ }
  if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
  try {
    console.log('url at failure:', page.url());
    console.log('trace:', await page.evaluate(() => JSON.stringify((window.__fakeSpeech.log || []).slice(-30))));
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
  // The harness server has no key; the widget must believe live answers are
  // on, or it will not offer the server ear either.
  await p.route('**/portal/bespoke/suggestions*', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.configured = true;
    await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(json) });
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await context.addInitScript(fakeSpeech, { mode: 'ok' });
page = await context.newPage();
watch(page);
await signIn(page);
await stubModel(page);

const mode = () => page.getAttribute('.tma-bespoke [data-bespoke-stage]', 'data-mode');
// A fresh listening pass that starts after the queue is filled: the fake
// takes its text at start(), so a pass already running would miss it.
async function relisten() {
  const mic = '.tma-bespoke [data-bespoke-live-mic]';
  const before = await page.evaluate(() => window.__fakeSpeech.starts);
  if (!(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-live-mic]').classList.contains('is-off')))) {
    await page.click(mic);
    await waitMode('idle', 4000);
  }
  await page.click(mic);
  await page.waitForFunction((n) => window.__fakeSpeech.starts > n, before, { timeout: 4000 });
}
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
await page.waitForTimeout(400); // past the background transition
const micStyle = await page.evaluate(() => {
  const b = document.querySelector('.tma-bespoke [data-bespoke-live-mic]');
  const cs = getComputedStyle(b);
  return { color: cs.backgroundColor, image: cs.backgroundImage.slice(0, 15), filter: getComputedStyle(b.querySelector('img')).filter };
});
check(micStyle.image === 'linear-gradient' && micStyle.filter === 'none', `the listening mic wears the wash with a dark glyph (${JSON.stringify(micStyle)})`);
await page.screenshot({ path: 'tests/Browser/bespoke-live.png' });

// ── the representative ───────────────────────────────────────────────────
// three.js and the model arrive on demand; software WebGL in headless
// Chromium is slow, so the wait is generous.
await page.waitForSelector('.tma-bespoke [data-bespoke-rep].is-ready', { timeout: 60000 });
check(await page.evaluate(() => !!document.querySelector('.tma-bespoke [data-bespoke-face] canvas')), 'the face renders into the stage');
const repState = await page.evaluate(() => window.TMABespoke.live().rep.debug());
check(repState.ready && repState.running && repState.mode === 'listening', `the face is ready and follows the mode (${JSON.stringify({ ready: repState.ready, running: repState.running, mode: repState.mode })})`);
check(await page.evaluate(() => getComputedStyle(document.querySelector('.tma-bespoke [data-bespoke-orb]')).opacity === '0'), 'the mark steps aside for the face');
await page.waitForTimeout(600);
await page.screenshot({ path: 'tests/Browser/bespoke-live-face.png' });

// ── a spoken question, an answered reply ─────────────────────────────────
scripted = { reply: 'Open **All Files** from [File Library](/folders/all). Then choose a folder → Upload.', actions: [], choices: [] };
const before = await page.evaluate(() => window.__fakeSpeech.spoken.length);
await page.evaluate(() => { window.__fakeSpeech.queue.push('where is the file library'); });
await relisten();
// The turn is quick with a stubbed model and a fake voice; wait on what
// lasts — the voice having been asked to read — not on a passing mode.
await page.waitForFunction((n) => window.__fakeSpeech.spoken.length > n, before, { timeout: 15000 });
// While the voice reads, the mouth shapes follow the words.
const mouth = await page.evaluate(() => new Promise((resolve) => {
  const seen = {};
  const start = Date.now();
  (function poll() {
    const d = window.TMABespoke.live().rep.debug();
    for (const k of Object.keys(d.shapes)) if (k.indexOf('viseme_') === 0 && d.shapes[k] > 0.1) seen[k] = Math.max(seen[k] || 0, d.shapes[k]);
    const over = Date.now() - start;
    if ((d.mode !== 'speaking' && over > 500) || over > 8000) return resolve({ seen, speaking: d.speaking });
    setTimeout(poll, 30);
  })();
}));
check(Object.keys(mouth.seen).length >= 3, `the mouth moves through several shapes while speaking (${Object.keys(mouth.seen).join(', ')})`);
await page.screenshot({ path: 'tests/Browser/bespoke-live-speaking.png' });
const lastUser = lastChatBody && lastChatBody.messages.filter((m) => m.role === 'user').pop();
check(lastUser && lastUser.content === 'where is the file library', 'the transcript goes through the chat endpoint as the reader\'s message');
check(lastChatBody && lastChatBody.clientContext && lastChatBody.clientContext.path === '/', 'the page context rides along as it does when typing');
const caption = await page.textContent('.tma-bespoke [data-bespoke-live-caption]');
check(caption.includes('Open All Files from File Library'), 'the reply is captioned');
check(await page.evaluate(() => !!document.querySelector('.tma-bespoke [data-bespoke-live-caption] a[data-bespoke-nav="/folders/all"]')), 'links in the caption stay links');
await waitMode('listening', 12000);
await page.waitForTimeout(400);
const mouthAfter = await page.evaluate(() => window.TMABespoke.live().rep.debug());
check(!mouthAfter.speaking && !Object.keys(mouthAfter.shapes).some((k) => k.indexOf('viseme_') === 0), 'the mouth closes when the voice stops');
const spoken = await page.evaluate(() => window.__fakeSpeech.spoken);
check(spoken.length === before + 1 && spoken[spoken.length - 1] === 'Open All Files from File Library. Then choose a folder, then Upload.', `the reply is read without its markdown (${JSON.stringify(spoken.slice(-1)[0])})`);
check(await page.evaluate(() => window.__fakeSpeech.starts >= 2), 'it listens again after speaking');

// ── mute the voice ───────────────────────────────────────────────────────
await page.click('.tma-bespoke [data-bespoke-live-speaker]');
check((await page.getAttribute('.tma-bespoke [data-bespoke-live-speaker]', 'aria-pressed')) === 'true', 'the voice can be muted');
scripted = { reply: 'Quiet answer.', actions: [], choices: [] };
const spokenBefore = await page.evaluate(() => window.__fakeSpeech.spoken.length);
await page.evaluate(() => { window.__fakeSpeech.queue.push('say something quietly'); });
await relisten();
await page.waitForFunction(() => /Quiet answer\./.test(document.querySelector('.tma-bespoke [data-bespoke-live-caption]').textContent), null, { timeout: 15000 });
await waitMode('listening', 12000);
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

// With the hold released, two silent passes rest the mic rather than
// listen to an empty room forever.
await page.evaluate(() => { window.__fakeSpeech.hold = false; });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
await page.click('[data-bespoke-voice]');
await waitMode('listening');
await page.waitForFunction(() => /didn’t catch that/.test(document.querySelector('.tma-bespoke [data-bespoke-live-status]').textContent), null, { timeout: 15000 });
check(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-live-mic]').classList.contains('is-off')), 'two silent passes rest the mic');
await page.evaluate(() => { window.__fakeSpeech.hold = true; });
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.tma-bespoke').classList.contains('is-open'), null, { timeout: 4000 });

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

await browser.close();

// ── the server ear ───────────────────────────────────────────────────────
// A browser whose recognition has no service (every start → `network`), a
// fake microphone that plays a WAV on a loop (1 s silence, 1.5 s tone, 3 s
// silence), the real MediaRecorder and level meter, and the transcription
// endpoint stubbed at the network layer as the model is.
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
    for (let k = 0; k < n; k++, i++) {
      buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * k) / rate) * amp * 32767), 44 + i * 2);
    }
  }
  writeFileSync(path, buf);
}
const wav = join(tmpdir(), 'tma-bespoke-live-tone.wav');
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
let transcript = 'open the file library';
await page.route('**/portal/bespoke/transcribe', async (route) => {
  const req = route.request();
  const body = req.postDataBuffer();
  clips.push({ bytes: body ? body.length : 0, type: req.headers()['content-type'] || '', text: body ? body.toString('latin1') : '' });
  const text = transcript;
  transcript = '';
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text }) });
});

await page.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
await page.click('[data-bespoke-fab]');
await page.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
check(await page.isVisible('[data-bespoke-voice]'), 'Talk live is offered where recognition exists but has no service');
scripted = { reply: 'File Library is in the sidebar.', actions: [], choices: [] };
await page.click('[data-bespoke-voice]');
await waitMode('listening');
await page.waitForFunction(() => window.__fakeSpeech.starts >= 1 && localStorage.getItem('tma.bespoke.voiceEngine') === 'server', null, { timeout: 6000 });
check(true, 'a network failure hands the ear to the server and remembers it');
const statusAfterSwitch = await page.textContent('.tma-bespoke [data-bespoke-live-status]');
check(!/isn’t available/.test(statusAfterSwitch), `the reader never sees the failure (${JSON.stringify(statusAfterSwitch)})`);
await waitMode('thinking', 20000);
check(clips.length === 1 && clips[0].bytes > 2000 && /multipart\/form-data/.test(clips[0].type), `the recorded clip is uploaded (${clips[0] ? clips[0].bytes : 0} bytes)`);
check(clips.length === 1 && /name="audio"; filename="speech\.webm"/.test(clips[0].text) && /name="language"\r\n\r\nen/.test(clips[0].text), 'the clip is named by its container and carries the language');
await waitMode('speaking', 10000);
const heard = lastChatBody && lastChatBody.messages.filter((m) => m.role === 'user').pop();
check(heard && heard.content === 'open the file library', 'the transcript goes through the chat endpoint as the reader\'s message');
check((await page.textContent('.tma-bespoke [data-bespoke-live-caption]')).includes('File Library is in the sidebar.'), 'the reply is captioned');
await waitMode('listening', 10000);
check((await page.evaluate(() => window.__fakeSpeech.starts)) === 1, 'the browser ear is not tried again once the server has it');
// Two empty transcriptions in a row rest the mic.
await page.waitForFunction(() => /didn’t catch that/.test(document.querySelector('.tma-bespoke [data-bespoke-live-status]').textContent), null, { timeout: 40000 });
check(clips.length === 3, `silence from the provider counts as a silent pass (${clips.length} clips)`);
check(await page.evaluate(() => document.querySelector('.tma-bespoke [data-bespoke-live-mic]').classList.contains('is-off')), 'the mic rests after two silent passes');
await page.screenshot({ path: 'tests/Browser/bespoke-live-server-ear.png' });
await page.click('.tma-bespoke [data-bespoke-live-end]');
check(await page.evaluate(() => {
  const live = document.querySelector('.tma-bespoke [data-bespoke-stage]');
  return live.hidden && (!window.__fakeSpeech.active);
}), 'Back to chat stops the recorder too');

// A fresh page in this browser goes straight to the server ear.
const page2 = await context2.newPage();
page = page2;
watch(page2);
await stubModel(page2);
await page2.route('**/portal/bespoke/transcribe', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '' }) }));
await page2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('[data-bespoke-fab]', { timeout: 15000 });
// The panel was left open on the first page, and that is remembered.
if (!(await page2.evaluate(() => document.querySelector('.tma-bespoke').classList.contains('is-open')))) await page2.click('[data-bespoke-fab]');
await page2.waitForSelector('.tma-bespoke.is-open [data-bespoke-input]', { timeout: 8000 });
await page2.click('[data-bespoke-voice]');
await page2.waitForFunction(() => { const el = document.querySelector('.tma-bespoke [data-bespoke-stage]'); return !!el && el.getAttribute('data-mode') === 'listening'; }, null, { timeout: 6000 });
await page2.waitForTimeout(500);
check((await page2.evaluate(() => window.__fakeSpeech.starts)) === 0, 'the remembered choice skips the failing ear on the next visit');
await page2.click('.tma-bespoke [data-bespoke-live-end]');

// ── done ─────────────────────────────────────────────────────────────────
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
await browser2.close();
if (fail.length || errors.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('\nall checks passed');
