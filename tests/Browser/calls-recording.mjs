/*
 * Screen sharing and client-call recording, against a live call.
 *
 * Two things only a real peer connection can prove. Screen share is a
 * replaceTrack on the negotiated video sender — whether the far end actually
 * sees the picture, mid-call, without renegotiation, is the whole feature.
 * And recording is a consent flow: the rule (staff↔client records, staff↔staff
 * never) lives server-side, the notice must reach BOTH sides before capture,
 * and the finished file has to land in /call-recordings as playable bytes.
 *
 * Setup is calls.mjs's: throwaway DB, Reverb, fake devices. Additionally needs
 * a CLIENT account with a conversation to the staff user (paula@example.com in
 * the messaging seed) — a staff↔staff pair alone cannot exercise the rule.
 * `--auto-select-desktop-capture-source` is what lets getDisplayMedia resolve
 * headlessly; without it the picker would hang the share forever.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const STAFF = process.env.TMA_CALLER || 'e2e@example.com';
const CLIENT = process.env.TMA_CLIENT || 'paula@example.com';
const COLLEAGUE = process.env.TMA_CALLEE || 'tom@example.com';

const failures = [];
const errors = [];
const IGNORE = /Origin not allowed|favicon|net::ERR_|Failed to load resource/i;

function step(n, m) { console.log(`\n[${n}] ${m}`); }
function check(ok, m) { console.log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
});

async function signIn(page, email) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await wait(500);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await wait(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function openMessages(page) {
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-messages-row]', { timeout: 20000 });
  await page.waitForFunction(
    () => window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId,
    { timeout: 20000 }
  );
}

async function openConversationWith(page, name) {
  await page.click(`.tma-dash__messages-row:has-text("${name}")`);
  await page.waitForSelector('[data-messages-call="audio"]', { timeout: 10000 });
}

/* Every call starts through the "Call <name>?" chooser now. */
async function startCall(page, kind) {
  await page.click(`[data-messages-call="${kind}"]`);
  await page.waitForSelector('[data-messages-callask]', { timeout: 5000 });
  await page.click(`[data-callask-start="${kind}"]`);
}

async function answer(page) {
  await page.waitForSelector('.tma-call [data-call-action="accept"]', { timeout: 20000 });
  await page.click('.tma-call [data-call-action="accept"]');
  await page.waitForFunction(
    () => {
      const s = window.TMAMessagingCalls && window.TMAMessagingCalls._debug().session;
      return !!(s && s.connected);
    },
    { timeout: 25000 }
  );
}

async function hangup(page) {
  await page.evaluate(() => window.TMAMessagingCalls.end());
}

const debugState = (page) => page.evaluate(() => {
  const s = window.TMAMessagingCalls && window.TMAMessagingCalls._debug().session;
  if (!s) return null;
  return {
    connected: s.connected,
    media: s.media,
    recording: !!s.recording,
    remoteRecording: !!s.remoteRecording,
    screenSharing: !!s.screenSharing,
    remoteScreenSharing: !!s.remoteScreenSharing,
    remoteVideoLive: !!(s.remoteStream && s.remoteStream.getVideoTracks()
      .some((t) => t.readyState === 'live')),
  };
});

const staffPage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const clientPage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const colleaguePage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
for (const [who, page] of [['staff', staffPage], ['client', clientPage], ['colleague', colleaguePage]]) {
  page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push(`${who} pageerror: ${e}`); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`${who} console: ${m.text()}`);
  });
}

try {
  await signIn(staffPage, STAFF);
  await signIn(clientPage, CLIENT);
  await signIn(colleaguePage, COLLEAGUE);
  await openMessages(staffPage);
  await openMessages(clientPage);
  await openMessages(colleaguePage);
  // The modal keeps every control on screen; where an answered call lands is
  // per-account state, so pin it rather than inherit it.
  for (const page of [staffPage, clientPage, colleaguePage]) {
    await page.evaluate(async () => {
      await window.TMAMessagingAPI.updateSettings({ callDisplay: 'modal' });
      window.TMAMessagingCalls.setDisplayPreference('modal');
    });
  }
  console.log('all three users on Messages with live sockets');

  /* ── 1. A staff↔client call records, and says so on BOTH sides ── */
  step(1, 'a staff↔client call is recorded, with the notice on both sides');
  await openConversationWith(staffPage, 'Paula Client');
  await startCall(staffPage, 'audio');
  await answer(clientPage);

  // The recording is arranged server-side after connect; give it a beat.
  await staffPage.waitForFunction(
    () => !!(window.TMAMessagingCalls._debug().session || {}).recording,
    { timeout: 15000 }
  ).catch(() => {});

  const staffMid = await debugState(staffPage);
  check(!!staffMid && staffMid.recording, 'the staff side is recording');

  await clientPage.waitForFunction(
    () => !!(window.TMAMessagingCalls._debug().session || {}).remoteRecording,
    { timeout: 10000 }
  ).catch(() => {});
  const clientMid = await debugState(clientPage);
  check(!!clientMid && clientMid.remoteRecording, 'the client side was told it is being recorded');

  for (const [who, page] of [['staff', staffPage], ['client', clientPage]]) {
    const notice = await page.locator('.tma-call__prompt--recording').textContent().catch(() => '');
    check(
      /This call is being recorded for client service and record-keeping purposes/.test(notice || ''),
      `${who} sees the consent sentence`,
    );
    const chip = await page.locator('.tma-call__rec').count();
    check(chip >= 1, `${who} sees the persistent REC chip`);
  }

  // Long enough for real audio to accumulate before hanging up.
  await wait(4000);

  /* ── 2. Screen share reaches the far end without renegotiating ── */
  step(2, 'screen sharing inside the live call');
  await staffPage.click('.tma-call__controls [data-call-action="share-screen"]');
  await staffPage.waitForFunction(
    () => !!(window.TMAMessagingCalls._debug().session || {}).screenSharing,
    { timeout: 10000 }
  ).catch(() => {});
  const sharing = await debugState(staffPage);
  check(!!sharing && sharing.screenSharing, 'the staff side reports sharing');
  check(!!sharing && sharing.media === 'audio', 'sharing did not pretend the voice call became video');

  const shareBtnActive = await staffPage.locator(
    '.tma-call__controls [data-call-action="share-screen"].is-active'
  ).count();
  check(shareBtnActive === 1, 'the Share Screen control shows it is on');

  await clientPage.waitForFunction(
    () => {
      const s = window.TMAMessagingCalls._debug().session;
      return !!(s && s.remoteScreenSharing && s.remoteStream &&
        s.remoteStream.getVideoTracks().some((t) => t.readyState === 'live'));
    },
    { timeout: 15000 }
  ).catch(() => {});
  const seen = await debugState(clientPage);
  check(!!seen && seen.remoteScreenSharing, 'the client side is told a screen is being shared');
  check(!!seen && seen.remoteVideoLive, 'the shared picture actually arrives as a live track');
  const remoteShown = await clientPage.evaluate(() => {
    const media = document.querySelector('.tma-call__media');
    const tag = document.querySelector('[data-call-remote-tag]');
    return {
      hasRemoteVideo: !!(media && media.classList.contains('has-remote-video')),
      tag: tag ? tag.textContent : '',
    };
  });
  check(remoteShown.hasRemoteVideo, 'the client sees the video frame, not a voice face');
  check(/sharing screen/i.test(remoteShown.tag), `the frame is labelled (${remoteShown.tag})`);

  await staffPage.click('.tma-call__controls [data-call-action="share-screen"]');
  await wait(1200);
  const stopped = await debugState(staffPage);
  const clientAfterStop = await debugState(clientPage);
  check(!!stopped && !stopped.screenSharing, 'stopping the share stops it');
  check(!!clientAfterStop && !clientAfterStop.remoteScreenSharing, 'the far end is told it stopped');

  /* ── 3. Hanging up finishes the recording into /call-recordings ── */
  step(3, 'the finished recording lands in the Call Recordings area');
  await hangup(staffPage);
  // The last chunk and the finish call ride out after the session dies.
  let recordings = [];
  for (let i = 0; i < 20; i++) {
    await wait(1000);
    recordings = await staffPage.evaluate(async () => {
      const r = await fetch('/portal/call-recordings', {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      });
      return (await r.json()).recordings || [];
    });
    if (recordings.length && recordings[0].status === 'ready') break;
  }
  check(recordings.length >= 1, `the recording is listed (${recordings.length})`);
  const rec = recordings[0] || {};
  check(rec.status === 'ready', `it finished as ready (${rec.status})`);
  check(rec.clientName === 'Paula Client', `it is filed under the client (${rec.clientName})`);
  check(rec.media === 'audio', `call type recorded (${rec.media})`);
  check((rec.durationMs || 0) > 2000, `duration was measured (${rec.durationMs}ms)`);
  check((rec.participants || []).length === 2, 'both participants are named');
  check(!!rec.startedAt && !!rec.endedAt, 'start and end instants are stored');
  check(!!rec.conversationId, 'the conversation is linked');

  const media = await staffPage.evaluate(async (id) => {
    const r = await fetch('/portal/call-recordings/' + id + '/media', { credentials: 'same-origin' });
    const buf = await r.arrayBuffer();
    return { status: r.status, bytes: buf.byteLength, type: r.headers.get('content-type') };
  }, rec.id);
  check(media.status === 200 && media.bytes > 1000,
    `the recording streams back (${media.status}, ${media.bytes} bytes, ${media.type})`);

  /* ── 4. The client can not reach the area; a colleague sees nothing ── */
  step(4, 'access follows the permission model');
  const clientStatus = await clientPage.evaluate(async () => {
    const r = await fetch('/portal/call-recordings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return r.status;
  });
  check(clientStatus === 404, `the client is told the area does not exist (${clientStatus})`);
  const colleagueRows = await colleaguePage.evaluate(async () => {
    const r = await fetch('/portal/call-recordings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return (await r.json()).recordings || [];
  });
  check(colleagueRows.length === 0, 'an uninvolved employee sees an empty list');

  /* ── 5. A staff↔staff call never records ── */
  step(5, 'an ordinary staff call is not recorded');
  await openConversationWith(staffPage, 'Tom Field');
  await startCall(staffPage, 'audio');
  await answer(colleaguePage);
  await wait(4000);
  const staffCall = await debugState(staffPage);
  const colleagueCall = await debugState(colleaguePage);
  check(!!staffCall && !staffCall.recording && !staffCall.remoteRecording,
    'no recording on the caller side');
  check(!!colleagueCall && !colleagueCall.recording && !colleagueCall.remoteRecording,
    'no recording on the callee side');
  const chips = await staffPage.locator('.tma-call__rec').count();
  check(chips === 0, 'no REC chip is shown');
  await hangup(staffPage);
  await wait(2000);
  const after = await staffPage.evaluate(async () => {
    const r = await fetch('/portal/call-recordings', {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
    return (await r.json()).recordings || [];
  });
  check(after.length === recordings.length, 'the staff call added no recording row');

  /* ── 6. An unanswered call says "Ringing…" and gives up at 15 seconds ── */
  step(6, 'an unanswered call shows Ringing… and auto-ends at 15s');
  const ringStart = Date.now();
  await startCall(staffPage, 'audio');
  await colleaguePage.waitForSelector('.tma-call [data-call-action="accept"]', { timeout: 15000 });

  // "Calling…" becomes "Ringing…" once the far end acknowledges the ring.
  await staffPage.waitForFunction(() => {
    const el = document.querySelector('[data-call-status]');
    return !!el && /Ringing/i.test(el.textContent || '');
  }, { timeout: 10000 }).catch(() => {});
  const ringStatus = await staffPage.evaluate(() => {
    const el = document.querySelector('[data-call-status]');
    return el ? el.textContent.trim() : '';
  });
  check(/Ringing/i.test(ringStatus), `the caller sees the far end ringing ("${ringStatus}")`);

  // Nobody answers — the caller must give up on its own, and not early.
  await staffPage.waitForFunction(
    () => !window.TMAMessagingCalls._debug().session,
    { timeout: 22000 }
  ).catch(() => {});
  const ringElapsed = Date.now() - ringStart;
  const callerGaveUp = await staffPage.evaluate(() => !window.TMAMessagingCalls._debug().session);
  check(callerGaveUp, 'the caller auto-ended the unanswered call');
  check(ringElapsed >= 14000 && ringElapsed <= 21000,
    `it rang the full window first (${Math.round(ringElapsed / 1000)}s)`);
  await colleaguePage.waitForFunction(
    () => !window.TMAMessagingCalls._debug().session,
    { timeout: 8000 }
  ).catch(() => {});
  const calleeClosed = await colleaguePage.evaluate(() => !window.TMAMessagingCalls._debug().session);
  check(calleeClosed, "the callee's pop-up closed with it");
} catch (err) {
  failures.push('threw: ' + err.message);
  console.log('\nERROR: ' + err.message);
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('\nPage errors:');
  errors.forEach((e) => console.log('  ' + e));
}
if (failures.length) {
  console.log(`\nFAILED (${failures.length})`);
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
