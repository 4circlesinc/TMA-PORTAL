/*
 * The whole call experience, driven between two real users.
 *
 * Nothing here is mocked: two browser contexts sign in as two people, one
 * places a real WebRTC call, the other answers it, and every check afterwards
 * is made against a live peer connection carrying Chromium's fake camera and
 * microphone. That matters because most of what this feature promises — that
 * changing layout does not restart the call, that mute survives a mode change,
 * that voice→video does not renegotiate — is only true or false against a real
 * connection.
 *
 * Setup (see README): a throwaway database with two users and one conversation
 * between them, Reverb running, and the app served pointing at it. Chromium is
 * launched with fake devices, which also auto-grants the permission prompt.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const CALLER = process.env.TMA_CALLER || 'e2e@example.com';
const CALLEE = process.env.TMA_CALLEE || 'tom@example.com';

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
      page.click('button[name="stay"][value="yes"]'),
    ]);
    await wait(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed for ' + email);
}

async function openMessages(page) {
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-messages-row]', { timeout: 20000 });
  // The call layer only works over a live socket; without one there is no
  // signalling at all and every check below would be meaningless.
  await page.waitForFunction(
    () => window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId,
    { timeout: 20000 }
  );
}

/** Whatever the calls module currently believes, straight from the session. */
function callState(page) {
  return page.evaluate(() => {
    const s = window.TMAMessagingCalls && window.TMAMessagingCalls._debug().session;
    if (!s) return null;
    return {
      mode: s.mode,
      prevMode: s.prevMode,
      media: s.media,
      muted: s.muted,
      cameraOff: s.cameraOff,
      remoteCameraOff: s.remoteCameraOff,
      connected: s.connected,
      swapped: s.swapped,
      role: s.role,
      hasPc: !!s.pc,
      pcId: s.pc ? s.pc.__id : null,
      startedAt: s.startedAt,
      senders: s.pc ? s.pc.getSenders().map((x) => (x.track ? x.track.kind : 'empty')).sort().join(',') : '',
      remoteTracks: s.remoteStream ? s.remoteStream.getTracks().map((t) => t.kind).sort().join(',') : '',
      upgrade: s.upgrade ? s.upgrade.direction : null,
      error: s.error ? s.error.title : null,
    };
  });
}

/* Tag the peer connection so "same connection afterwards" is provable. */
async function tagPeer(page) {
  await page.evaluate(() => {
    const s = window.TMAMessagingCalls._debug().session;
    if (s && s.pc && !s.pc.__id) s.pc.__id = 'pc-' + Math.random().toString(36).slice(2);
  });
}

const callerPage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const calleePage = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
for (const [who, page] of [['caller', callerPage], ['callee', calleePage]]) {
  page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push(`${who} pageerror: ${e}`); });
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`${who} console: ${m.text()}`);
  });
}

await signIn(callerPage, CALLER);
await signIn(calleePage, CALLEE);
await openMessages(callerPage);
await openMessages(calleePage);

// Pin the callee's preferred display so the "answered call lands here" checks
// mean something. Leaving it to whatever the account happens to hold makes
// this pass or fail on unrelated state.
for (const page of [callerPage, calleePage]) {
  await page.evaluate(async () => {
    await window.TMAMessagingAPI.updateSettings({ callDisplay: 'island' });
    window.TMAMessagingCalls.setDisplayPreference('island');
  });
}
console.log('both users on Messages with a live socket');

/* ── 1. An incoming video call opens as a pop-up with a self-preview ── */
step(1, 'incoming video call: large pop-up, not a screen takeover');

// The callee deliberately stays on the chat list with no conversation open —
// this is the case that used to receive nothing at all.
await callerPage.click('[data-messages-row]');
await callerPage.waitForSelector('[data-messages-call="video"]', { timeout: 10000 });
await callerPage.click('[data-messages-call="video"]');

await calleePage.waitForSelector('.tma-call__dialog--incoming', { timeout: 20000 });
// The pop-up renders before getUserMedia resolves — deliberately, so the call
// is answerable the instant it arrives. Wait for the preview it then attaches.
await calleePage.waitForFunction(() => {
  const v = document.querySelector('[data-call-local]');
  return !!(v && v.srcObject && v.srcObject.getVideoTracks().length);
}, { timeout: 15000 });
const incoming = await calleePage.evaluate(() => {
  const d = document.querySelector('.tma-call__dialog--incoming');
  const local = document.querySelector('[data-call-local]');
  return {
    label: d.getAttribute('aria-label'),
    kind: document.querySelector('.tma-call__incoming-kind')?.textContent.trim(),
    name: document.querySelector('.tma-call__incoming-name')?.textContent.trim(),
    answer: !!document.querySelector('[data-call-action="accept"]'),
    voiceOnly: !!document.querySelector('[data-call-action="accept-audio"]'),
    decline: !!document.querySelector('[data-call-action="decline"]'),
    states: [...document.querySelectorAll('.tma-call__status-pill')].map((p) => p.textContent.trim()),
    fullScreen: d.getBoundingClientRect().height >= window.innerHeight - 2,
    hasAvatar: !!document.querySelector('.tma-call__incoming-avatar'),
    previewPlaying: !!(local && local.srcObject && local.srcObject.getVideoTracks().length),
    previewVisible: !!local && local.getBoundingClientRect().width > 100,
  };
});
check(!!incoming.answer && !!incoming.decline, 'answer and decline are both offered');
check(incoming.voiceOnly, 'video call can be answered without video');
check(/Incoming video call/i.test(incoming.kind || ''), `it says what it is ("${incoming.kind}")`);
check(!!incoming.name, `the caller is named ("${incoming.name}")`);
check(incoming.hasAvatar, "the caller's picture is shown");
check(!incoming.fullScreen, 'the pop-up does not take over the whole screen');
check(incoming.previewPlaying && incoming.previewVisible, 'the callee can see their own camera before answering');
check(incoming.states.length >= 2, `microphone and camera state are shown (${incoming.states.join(' | ')})`);
check(/Incoming video call from/i.test(incoming.label || ''), 'the dialog is labelled for screen readers');

/* The caller must not be receiving anything yet. */
const preAnswer = await callerPage.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  return { remote: s.remoteStream ? s.remoteStream.getTracks().length : 0, connected: !!s.connected };
});
check(preAnswer.remote === 0 && !preAnswer.connected,
  "nothing is sent to the caller before the call is answered");

/* ── 2. Pre-answer controls act on the preview ── */
step(2, 'pre-answer camera and microphone controls');
await calleePage.click('[data-call-action="camera"]');
await wait(300);
let s = await callState(calleePage);
check(s.cameraOff === true, 'the camera can be turned off before answering');
const previewOff = await calleePage.evaluate(() =>
  window.TMAMessagingCalls._debug().session.previewStream.getVideoTracks()[0].enabled);
check(previewOff === false, 'turning it off actually disables the track');
await calleePage.click('[data-call-action="camera"]');
await calleePage.click('[data-call-action="mute"]');
await wait(300);
s = await callState(calleePage);
check(s.cameraOff === false && s.muted === true, 'both toggles work independently');
await calleePage.click('[data-call-action="mute"]');

/* Device pickers are available before answering (§16). */
await calleePage.click('[data-call-action="devices"]');
await calleePage.waitForSelector('.tma-call__sheet--devices', { timeout: 5000 });
const devices = await calleePage.evaluate(() => ({
  camera: !!document.querySelector('[data-call-device="camera"]'),
  mic: !!document.querySelector('[data-call-device="microphone"]'),
}));
check(devices.camera && devices.mic, 'camera and microphone can be chosen before answering');
await calleePage.click('[data-call-action="close-sheet"]');

/* ── 3. Answering connects one call, shown in the preferred display ── */
step(3, 'answering');
await calleePage.click('[data-call-action="accept"]');
await calleePage.waitForFunction(
  () => { const s = window.TMAMessagingCalls._debug().session; return s && s.connected; },
  { timeout: 25000 }
);
await callerPage.waitForFunction(
  () => { const s = window.TMAMessagingCalls._debug().session; return s && s.connected; },
  { timeout: 25000 }
);
await wait(1200);
await tagPeer(callerPage);
await tagPeer(calleePage);

let caller = await callState(callerPage);
let callee = await callState(calleePage);
check(caller.connected && callee.connected, 'both ends report the call connected');
check(caller.remoteTracks.includes('video') && callee.remoteTracks.includes('video'),
  `real media flows both ways (caller sees ${caller.remoteTracks}, callee sees ${callee.remoteTracks})`);
check(callee.mode === 'island', `the answered call went to the preferred display (${callee.mode})`);
check(!!callee.startedAt, 'the call timer started');
check(caller.mode === 'island',
  `the caller's own preference took over once answered (${caller.mode})`);

/* ── 4. Large modal ── */
step(4, 'the large call modal');
await calleePage.click('[data-call-action="mode-modal"]');
await calleePage.waitForSelector('.tma-call__dialog--stage', { timeout: 5000 });
const modal = await calleePage.evaluate(() => {
  const d = document.querySelector('.tma-call__dialog--stage');
  const box = d.getBoundingClientRect();
  const controls = [...document.querySelectorAll('.tma-call__controls [data-call-action]')]
    .map((b) => b.getAttribute('data-call-action'));
  const remote = document.querySelector('.tma-call__frame--remote');
  return {
    controls,
    coversMost: box.width > window.innerWidth * 0.6 && box.height > window.innerHeight * 0.6,
    coversAll: box.width >= window.innerWidth - 1 && box.height >= window.innerHeight - 1,
    remoteIsBig: remote.classList.contains('is-big'),
    remoteFillsFrame: remote.getBoundingClientRect().width > 400,
    controlsOverVideo: (() => {
      const c = document.querySelector('.tma-call__controls').getBoundingClientRect();
      const v = document.querySelector('.tma-call__media').getBoundingClientRect();
      return c.top > v.top + v.height / 2 && c.bottom <= v.bottom + 8;
    })(),
    duration: document.querySelector('[data-call-duration]')?.textContent.trim(),
    quality: document.querySelector('.tma-call__quality')?.textContent.trim() || null,
  };
});
check(modal.coversMost && !modal.coversAll, 'the modal uses most of the screen but not all of it');
check(modal.remoteIsBig && modal.remoteFillsFrame, 'the other person fills the main area');
check(modal.controlsOverVideo, 'the controls sit over the lower part of the video');
check(/^\d+:\d\d$/.test(modal.duration || ''), `call duration is shown (${modal.duration})`);
for (const want of ['mute', 'camera', 'switch-voice', 'more', 'swap', 'hangup']) {
  check(modal.controls.includes(want), `the modal offers "${want}"`);
}

/* ── 5. Camera off shows a face, not a black box ── */
step(5, 'camera-off behaviour');
await calleePage.click('.tma-call__controls [data-call-action="camera"]');
await wait(1500);
const off = await calleePage.evaluate(() => {
  const local = document.querySelector('.tma-call__frame--local');
  return {
    faceShown: getComputedStyle(local.querySelector('.tma-call__off')).display !== 'none',
    badge: local.querySelector('.tma-call__off-badge')?.textContent.trim(),
  };
});
check(off.faceShown, 'your own camera-off frame shows a face, not a black box');
check(/camera off/i.test(off.badge || ''), 'a camera-off indicator is shown');

const remoteOff = await callerPage.evaluate(() => {
  const f = document.querySelector('.tma-call__frame--remote');
  const s = window.TMAMessagingCalls._debug().session;
  return {
    told: s.remoteCameraOff,
    faceShown: f ? getComputedStyle(f.querySelector('.tma-call__off')).display !== 'none' : false,
    name: f ? f.querySelector('.tma-call__off-name')?.textContent.trim() : '',
  };
});
check(remoteOff.told, "the other end is told the camera went off");
check(remoteOff.faceShown && !!remoteOff.name,
  `the far end shows their picture and name instead (${remoteOff.name})`);
await calleePage.click('.tma-call__controls [data-call-action="camera"]');
await wait(600);

/* ── 6. Swap, and drag the small video ── */
step(6, 'swapping and dragging the small video');
await calleePage.click('.tma-call__controls [data-call-action="swap"]');
await wait(500);
let swap = await calleePage.evaluate(() => ({
  swapped: window.TMAMessagingCalls._debug().session.swapped,
  localBig: document.querySelector('.tma-call__frame--local').classList.contains('is-big'),
  remotePip: document.querySelector('.tma-call__frame--remote').classList.contains('is-pip'),
}));
check(swap.swapped && swap.localBig && swap.remotePip, 'your own camera can become the large video');
await calleePage.click('.tma-call__controls [data-call-action="swap"]');
await wait(500);
swap = await calleePage.evaluate(() => ({
  localPip: document.querySelector('.tma-call__frame--local').classList.contains('is-pip'),
}));
check(swap.localPip, 'and can be switched back');

const before = await calleePage.evaluate(() => {
  const r = document.querySelector('.tma-call__frame--local').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await calleePage.mouse.move(before.x, before.y);
await calleePage.mouse.down();
await calleePage.mouse.move(before.x - 260, before.y - 140, { steps: 12 });
await calleePage.mouse.up();
await wait(600);
const dragged = await calleePage.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  const r = document.querySelector('.tma-call__frame--local').getBoundingClientRect();
  const host = document.querySelector('.tma-call__media').getBoundingClientRect();
  const controls = document.querySelector('.tma-call__controls').getBoundingClientRect();
  return {
    remembered: !!s.localPos,
    moved: Math.abs(r.x + r.width / 2 - (host.right - 100)) > 60,
    insideHost: r.left >= host.left - 1 && r.right <= host.right + 1 &&
      r.top >= host.top - 1 && r.bottom <= host.bottom + 1,
    clearOfControls: r.bottom <= controls.top + 1 || r.right <= controls.left || r.left >= controls.right,
  };
});
check(dragged.moved, 'the small video can be dragged');
check(dragged.insideHost, 'it stays inside the call modal');
check(dragged.clearOfControls, 'it does not settle on top of the controls');
check(dragged.remembered, 'its position is remembered for the call');

/* ── 7. Mode changes reuse the same call ── */
step(7, 'moving between display modes');
const pcBefore = (await callState(calleePage)).pcId;
const startedBefore = (await callState(calleePage)).startedAt;

await calleePage.click('.tma-call__controls [data-call-action="mute"]');  // mute in the modal
await wait(300);
await calleePage.click('[data-call-action="mode-compact"]');
await calleePage.waitForSelector('.tma-call__compact', { timeout: 5000 });
const compact = await calleePage.evaluate(() => {
  const box = document.querySelector('.tma-call__compact');
  const r = box.getBoundingClientRect();
  const sidebar = document.querySelector('.tma-dash__sidebar');
  return {
    controls: [...box.querySelectorAll('[data-call-action]')].map((b) => b.getAttribute('data-call-action')),
    controlsAtTop: box.querySelector('.tma-call__compact-bar').getBoundingClientRect().top < r.top + 40,
    name: box.querySelector('.tma-call__compact-name')?.textContent.trim(),
    duration: box.querySelector('[data-call-duration]')?.textContent.trim(),
    kind: box.querySelector('.tma-call__compact-kind')?.textContent.trim(),
    muteShown: !!box.querySelector('[data-call-action="mute"].is-off'),
    hasVideo: !!box.querySelector('[data-call-remote]'),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    clearOfSidebar: !sidebar || r.left >= sidebar.getBoundingClientRect().right - 1,
  };
});
check(compact.controlsAtTop, 'the compact window puts its controls at the top');
for (const want of ['restore', 'mode-modal', 'mode-island', 'hangup', 'mute']) {
  check(compact.controls.includes(want), `the compact window offers "${want}"`);
}
check(!!compact.name && /^\d+:\d\d$/.test(compact.duration || ''),
  `it shows who and how long (${compact.name}, ${compact.duration})`);
check(/video/i.test(compact.kind || ''), `it shows the call type (${compact.kind})`);
check(compact.hasVideo, 'a video call shows live video in the compact window');
check(compact.muteShown, 'the mute set in the modal is still muted here');
check(compact.inViewport && compact.clearOfSidebar, 'it sits inside the viewport and clear of the sidebar');

await calleePage.click('[data-call-action="mode-island"]');
await calleePage.waitForSelector('.tma-call__pill', { timeout: 5000 });
const island = await calleePage.evaluate(() => ({
  muted: !!document.querySelector('.tma-call__pill [data-call-action="mute"].is-off'),
  cameraVisible: !!document.querySelector('.tma-call__pill [data-call-action="camera"]'),
  duration: document.querySelector('.tma-call__pill [data-call-duration]')?.textContent.trim(),
}));
check(island.muted, 'still muted in Dynamic Island');
check(/^\d+:\d\d$/.test(island.duration || ''), `the same timer keeps running (${island.duration})`);

const after = await callState(calleePage);
check(after.pcId === pcBefore && after.pcId !== null,
  'every mode change reused the same peer connection');
check(after.startedAt === startedBefore, 'and the same call timer');
check(after.connected, 'the call never dropped while changing modes');
const stillFlowing = await calleePage.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  return s.remoteStream.getTracks().every((t) => t.readyState === 'live');
});
check(stillFlowing, 'the media streams were never recreated');
await calleePage.click('[data-call-action="mute"]');   // unmute again

/* ── 8. Minimize returns to the previous mode ── */
step(8, 'minimize returns where the call came from');
await calleePage.click('.tma-call__pill [data-call-action="mode-compact"]');
await calleePage.waitForSelector('.tma-call__compact');
await calleePage.click('.tma-call__compact [data-call-action="mode-modal"]');
await calleePage.waitForSelector('.tma-call__dialog--stage');
await calleePage.click('.tma-call__stage-head-actions [data-call-action="minimize"]');
await wait(500);
check((await callState(calleePage)).mode === 'compact',
  'minimizing from the modal returned it to the compact window');

await calleePage.click('[data-call-action="mode-island"]');
await calleePage.waitForSelector('.tma-call__pill');
await calleePage.click('.tma-call__pill [data-call-action="mode-modal"]');
await calleePage.waitForSelector('.tma-call__dialog--stage');
await calleePage.keyboard.press('Escape');
await wait(500);
const escaped = await callState(calleePage);
check(escaped.mode === 'island', 'Escape from the modal returned it to Dynamic Island');
check(escaped.connected, 'Escape minimized the call rather than ending it');

/* ── 9. Video → voice, and voice → video ── */
step(9, 'switching between video and voice');
await calleePage.click('.tma-call__pill [data-call-action="mode-modal"]');
await calleePage.waitForSelector('.tma-call__dialog--stage');
await calleePage.click('.tma-call__controls [data-call-action="switch-voice"]');
await wait(1500);
const toVoice = await callState(calleePage);
const callerAfterVoice = await callState(callerPage);
check(toVoice.media === 'audio', 'the call became voice only');
check(toVoice.pcId === pcBefore, 'switching to voice did not restart the connection');
check(callerAfterVoice.media === 'audio', 'the other end followed to voice only');
const facesShown = await callerPage.evaluate(() => {
  const face = document.querySelector('.tma-call__audio-face, .tma-call__compact-face, .tma-call__pill-avatar');
  return !!face;
});
check(facesShown, 'a voice call shows a profile picture rather than a blank video area');
const cameraStillThere = await calleePage.evaluate(() =>
  !!document.querySelector('.tma-call__controls [data-call-action="camera"]'));
check(cameraStillThere, 'the camera button stays visible during a voice call');

// Back to video: a request the other side has to accept.
await calleePage.click('.tma-call__controls [data-call-action="camera"]');
await calleePage.waitForSelector('[data-call-action="upgrade-confirm"]', { timeout: 10000 });
const confirmStep = await calleePage.evaluate(() => ({
  previewing: !!window.TMAMessagingCalls._debug().session.upgradePreview,
  sentYet: window.TMAMessagingCalls._debug().session.upgrade.direction,
}));
check(confirmStep.previewing, 'switching to video previews your camera first');
check(confirmStep.sentYet === 'confirm', 'and nothing is sent until you confirm');

await calleePage.click('[data-call-action="upgrade-confirm"]');
await callerPage.waitForSelector('[data-call-action="upgrade-accept"]', { timeout: 10000 });
check(true, 'the other participant is asked before video starts');
await callerPage.click('[data-call-action="upgrade-accept"]');
await wait(2000);
const backToVideo = await callState(calleePage);
const callerVideo = await callState(callerPage);
check(backToVideo.media === 'video' && callerVideo.media === 'video', 'both ends switched back to video');
check(backToVideo.pcId === pcBefore, 'the upgrade reused the same connection');
check(callerVideo.remoteTracks.includes('video'), 'video is flowing again');

/* ── 10. Ending ── */
step(10, 'ending the call');
await calleePage.click('.tma-call__controls [data-call-action="hangup"]');
await wait(1500);
const ended = await calleePage.evaluate(() => ({
  session: !!(window.TMAMessagingCalls._debug().session),
  overlay: !!document.querySelector('.tma-call'),
}));
const callerEnded = await callerPage.evaluate(() => ({
  session: !!(window.TMAMessagingCalls._debug().session),
}));
check(!ended.session && !ended.overlay, 'ending clears the call and its window');
check(!callerEnded.session, 'the other end hung up too');

/* ── 11. Incoming voice call, declined ── */
step(11, 'incoming voice call');
await callerPage.click('[data-messages-call="audio"]');
await calleePage.waitForSelector('.tma-call__dialog--incoming', { timeout: 20000 });
const voiceIn = await calleePage.evaluate(() => ({
  kind: document.querySelector('.tma-call__incoming-kind')?.textContent.trim(),
  fullScreen: document.querySelector('.tma-call__dialog--incoming')
    .getBoundingClientRect().height >= window.innerHeight - 2,
  hasAvatar: !!document.querySelector('.tma-call__incoming-avatar'),
  micState: [...document.querySelectorAll('.tma-call__status-pill')].map((p) => p.textContent.trim()),
  voiceOnlyButton: !!document.querySelector('[data-call-action="accept-audio"]'),
}));
check(/Incoming voice call/i.test(voiceIn.kind || ''), `a voice call says so ("${voiceIn.kind}")`);
check(!voiceIn.fullScreen, 'the voice pop-up does not take over the screen either');
check(voiceIn.hasAvatar, "the caller's picture is shown");
check(voiceIn.micState.some((t) => /mic/i.test(t)), 'microphone state is shown');
check(!voiceIn.voiceOnlyButton, 'a voice call does not offer a pointless "voice only" answer');

await calleePage.click('[data-call-action="decline"]');
await wait(1500);
const declined = await callerPage.evaluate(() => !!window.TMAMessagingCalls._debug().session);
check(!declined, 'declining ends the call for the caller too');

/* ── 12. The call log recorded all of it ── */
step(12, 'the call log');
const log = await callerPage.evaluate(async () => {
  const r = await fetch('/portal/messaging/calls', { headers: { Accept: 'application/json' } });
  return (await r.json()).calls || [];
});
check(log.length >= 2, `the calls were written to the log (${log.length} entries)`);
check(log.some((c) => c.event === 'call_missed'), 'the declined call is recorded as missed');
check(log.some((c) => c.event === 'call_ended'), 'the answered call is recorded as ended');

/* ── 13. A genuinely missed call badges the Calls tab ── */
step(13, 'the missed-call badge');
// Unlike step 11, nobody declines here: the caller gives up while it rings,
// which is the only case that is a missed call for the person it rang for.
const navCount = (page, label) => page.evaluate((want) => {
  const btn = [...document.querySelectorAll('.tma-dash__messages-nav-btn')]
    .find((b) => b.querySelector('.tma-dash__messages-nav-label').textContent.trim() === want);
  const badge = btn && btn.querySelector('.tma-dash__messages-nav-count');
  return { count: badge ? badge.textContent.trim() : null, aria: btn && btn.getAttribute('aria-label') };
}, label);

const badgeBefore = await navCount(calleePage, 'Calls');
// The seed gives this account its own missed calls, so the caller's badge is
// checked for *movement*, not for being empty.
const callerBefore = await navCount(callerPage, 'Calls');
await callerPage.click('[data-messages-call="audio"]');
await calleePage.waitForSelector('.tma-call__dialog--incoming', { timeout: 20000 });
await wait(1200);
await callerPage.click('.tma-call__controls [data-call-action="hangup"]');   // gave up
await wait(2500);

const badgeAfter = await navCount(calleePage, 'Calls');
check(badgeAfter.count !== badgeBefore.count && badgeAfter.count !== null,
  `the missed call appears on the Calls badge (${badgeBefore.count} → ${badgeAfter.count})`);
check(/missed call/i.test(badgeAfter.aria || ''),
  `and is announced, not just drawn (${badgeAfter.aria})`);

const callerAfter = await navCount(callerPage, 'Calls');
check(callerAfter.count === callerBefore.count,
  `the caller who gave up is not badged for their own unanswered call (${callerBefore.count} → ${callerAfter.count})`);

await calleePage.click('[data-messages-nav-calls]');
await wait(1500);
check((await navCount(calleePage, 'Calls')).count === null, 'opening the tab clears the badge');
await calleePage.reload({ waitUntil: 'networkidle' });
await calleePage.waitForSelector('.tma-dash__messages-list-foot', { timeout: 20000 });
await wait(1500);
check((await navCount(calleePage, 'Calls')).count === null,
  'and it stays cleared across a reload — the marker is server-side');

/* ── report ── */
console.log('\n' + '='.repeat(64));
if (errors.length) {
  console.log(`JS errors (${errors.length}):`);
  [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  ' + e));
}
if (failures.length) {
  console.log(`FAILED (${failures.length}):`);
  failures.forEach((f) => console.log('  ✗ ' + f));
} else {
  console.log('all checks passed');
}
await browser.close();
process.exit(failures.length ? 1 : 0);
