import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Phase 4: voice notes.
//
// Runs Chromium with a **fake audio device**, so this records for real —
// MediaRecorder, the Web Audio analyser, the blob, the upload — rather than
// stubbing the browser APIs and proving nothing.
//
//   --use-fake-device-for-media-capture  synthesises a microphone
//   --use-fake-ui-for-media-stream       auto-grants permission
//
// The one thing it cannot exercise is a *denied* microphone, so that path is
// checked separately by overriding getUserMedia to reject.
//
// See README.md for setup. Needs the messaging seed.
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_EMAIL || 'e2e@example.com';

const log = (...a) => console.log(...a);
const failures = [];
const errors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-capture',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1400, height: 950 },
  permissions: ['microphone'],
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/403|404|422|favicon/.test(m.text())) errors.push('console: ' + m.text());
});

async function openConversation() {
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.tma-dash__messages-row', { timeout: 15000 });
  await page.locator('.tma-dash__messages-row', { hasText: 'Ana Ruiz' }).first().click();
  await page.waitForTimeout(1500);
}

try {
  step(1, 'Sign in and open a conversation');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await openConversation();
  check(await page.locator('.tma-dash__messages-bubble').count() > 0, 'thread loaded');

  step(2, 'The microphone button is live, not disabled');
  const mic = page.locator('[data-messages-composer-voice]');
  check(await mic.count() === 1, 'microphone button present');
  check(!(await mic.isDisabled()), 'microphone button is enabled');

  step(3, 'Recording starts and shows a running duration');
  await mic.click();
  await page.waitForTimeout(1200);

  check(await page.locator('.tma-dash__messages-recorder').count() === 1, 'the recorder replaced the composer');
  check(
    await page.locator('[data-messages-composer-input]').count() === 0,
    'the text field is out of the way while recording',
  );

  const firstTime = await page.textContent('.tma-dash__messages-recorder-time');
  await page.waitForTimeout(1800);
  const laterTime = await page.textContent('.tma-dash__messages-recorder-time');
  check(firstTime !== laterTime, `the timer runs (${firstTime.trim()} → ${laterTime.trim()})`);

  const liveBars = await page.locator('.tma-dash__messages-wave--live .tma-dash__messages-wave-bar').count();
  check(liveBars > 0, `a live waveform is drawn (${liveBars} bars)`);

  step(4, 'Pausing holds the timer');
  await page.click('[data-messages-record-pause]');
  await page.waitForTimeout(300);
  const pausedAt = await page.textContent('.tma-dash__messages-recorder-time');
  await page.waitForTimeout(1500);
  const stillPaused = await page.textContent('.tma-dash__messages-recorder-time');
  check(pausedAt.trim() === stillPaused.trim(), `paused at ${pausedAt.trim()} and stayed there`);

  await page.click('[data-messages-record-pause]');   // resume
  await page.waitForTimeout(1200);

  step(5, 'Stopping produces a reviewable recording, not a sent message');
  const bubblesBefore = await page.locator('.tma-dash__messages-bubble').count();
  await page.click('[data-messages-record-stop]');
  await page.waitForTimeout(1500);

  check(
    await page.locator('.tma-dash__messages-recorder--review').count() === 1,
    'the recording is offered for review',
  );
  check(
    await page.locator('.tma-dash__messages-bubble').count() === bubblesBefore,
    'nothing was sent yet',
  );
  const reviewLength = await page.textContent('.tma-dash__messages-recorder--review .tma-dash__messages-recorder-time');
  check(/[1-9]/.test(reviewLength), `the recording has a length (${reviewLength.trim()})`);
  check(
    await page.locator('[data-messages-record-play]').count() === 1,
    'it can be played before sending',
  );

  step(6, 'Discarding leaves no trace');
  await page.click('[data-messages-record-discard]');
  await page.waitForTimeout(800);
  check(await page.locator('.tma-dash__messages-recorder').count() === 0, 'the recorder closed');
  check(
    await page.locator('[data-messages-composer-input]').count() === 1,
    'the text field came back',
  );
  check(
    await page.locator('.tma-dash__messages-bubble').count() === bubblesBefore,
    'still nothing sent',
  );

  step(7, 'Record and send for real');
  await page.click('[data-messages-composer-voice]');
  await page.waitForTimeout(2500);
  await page.click('[data-messages-record-stop]');
  await page.waitForTimeout(1500);
  await page.click('[data-messages-record-send]');
  await page.waitForTimeout(4000);

  const players = await page.locator('.tma-dash__messages-voice').count();
  check(players > 0, `the voice note renders as a player (${players})`);
  check(
    await page.locator('.tma-dash__messages-voice video, .tma-dash__messages-attachment--video').count() === 0,
    'it is NOT rendered as a video (WebM audio would otherwise look like one)',
  );

  step(8, 'The server stored it as a voice note with real metadata');
  const stored = await page.evaluate(async (base) => {
    const list = await fetch(base + '/portal/messaging/conversations', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());
    const conv = list.conversations.find((c) => c.name === 'Ana Ruiz');
    const thread = await fetch(base + '/portal/messaging/conversations/' + conv.id + '/messages', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((r) => r.json());

    const voice = thread.messages
      .flatMap((m) => (m.attachments || []).map((a) => ({ a, type: m.type })))
      .filter((x) => x.a.kind === 'voice')
      .pop();

    if (!voice) return null;

    const bytes = await fetch(voice.a.url, { credentials: 'same-origin' })
      .then((r) => r.arrayBuffer());

    return {
      kind: voice.a.kind,
      messageType: voice.type,
      durationMs: voice.a.durationMs,
      waveformPoints: (voice.a.waveform || []).length,
      shelf: voice.a.shelf,
      bytes: bytes.byteLength,
    };
  }, BASE);

  check(!!stored, 'a voice attachment exists server-side');
  check(stored?.kind === 'voice', `attachment kind is "voice" (${stored?.kind})`);
  check(stored?.messageType === 'voice', `message type is "voice" (${stored?.messageType})`);
  check(stored?.durationMs > 0, `duration was recorded (${stored?.durationMs}ms)`);
  check(stored?.waveformPoints > 0, `waveform peaks stored (${stored?.waveformPoints})`);
  check(stored?.shelf === 'voice', `kept off the media/document shelves (${stored?.shelf})`);
  check(stored?.bytes > 500, `real audio was uploaded (${stored?.bytes} bytes)`);

  step(9, 'Playback: play, seek and speed');
  // Playback speed is a persisted preference, so a previous run can leave it at
  // 2x — fast enough that a short note finishes before the assertion and the
  // next render resets the bar. Pin it to 1x first.
  await page.evaluate(async (base) => {
    const csrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
    await fetch(base + '/portal/messaging/settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-XSRF-TOKEN': csrf ? decodeURIComponent(csrf[1]) : '',
      },
      body: JSON.stringify({ voicePlaybackSpeed: 1 }),
    });
  }, BASE);
  await openConversation();

  const player = page.locator('.tma-dash__messages-voice').last();
  await player.locator('[data-messages-voice-play]').click();

  // Sample repeatedly: the bar is only mid-way for a moment on a short note.
  let progressed = 0;
  for (let i = 0; i < 25; i++) {
    progressed = await player.locator('[data-messages-voice-progress]').evaluate(
      (el) => parseFloat(el.style.width) || 0
    );
    if (progressed > 0) break;
    await page.waitForTimeout(120);
  }
  check(progressed > 0, `progress advances while playing (${progressed.toFixed(1)}%)`);

  const speedBtn = player.locator('[data-messages-voice-speed]');
  const before = (await speedBtn.textContent()).trim();
  await speedBtn.click();
  await page.waitForTimeout(900);
  const after = (await speedBtn.textContent()).trim();
  check(before !== after, `playback speed cycles (${before} → ${after})`);

  const savedSpeed = await page.evaluate(async (base) => {
    const r = await fetch(base + '/portal/messaging/settings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then((res) => res.json());
    return r.settings.voicePlaybackSpeed;
  }, BASE);
  check(savedSpeed !== 1, `the speed preference persisted (${savedSpeed})`);

  step(10, 'A blocked microphone explains itself');
  await page.evaluate(() => {
    // Simulate a denial the fake device cannot produce.
    navigator.mediaDevices.getUserMedia = () => {
      const err = new Error('denied');
      err.name = 'NotAllowedError';
      return Promise.reject(err);
    };
  });
  await page.click('[data-messages-composer-voice]');
  await page.waitForTimeout(1500);

  const toast = (await page.locator('.tma-dash__messages-toast, [class*="toast"]').allTextContents()).join(' ');
  check(/microphone/i.test(toast), `a clear message is shown (${toast.trim().slice(0, 70)})`);
  check(/allow|block/i.test(toast), 'and it says what to do about it');
  check(
    await page.locator('.tma-dash__messages-recorder').count() === 0,
    'the recorder did not open on a denial',
  );

  await page.screenshot({ path: join(HERE, 'messaging-phase4.png') });
  log('\nwrote messaging-phase4.png');
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  log('\nPage errors:');
  errors.forEach((e) => log('  ' + e));
}

log('\n' + (failures.length ? `FAILED (${failures.length})` : 'ALL CHECKS PASSED'));
failures.forEach((f) => log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
