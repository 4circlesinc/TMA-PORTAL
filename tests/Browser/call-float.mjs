/*
 * The floating call window, and the small window it draws.
 *
 * Unlike calls.mjs this needs no server, no database and no second person: it
 * serves `public/` over http://127.0.0.1 — a secure context, which the
 * picture-in-picture API insists on — and drives window.TMAMessagingCalls
 * directly against a real getUserMedia stream from Chromium's fake devices.
 * That is enough to test the three things that are only true or false in a
 * browser:
 *
 *   1. a call opens a genuine operating-system window and moves itself into it,
 *      keeping the same peer connection, the same stream and the same timer;
 *   2. the picture in that window runs edge to edge, with the controls out of
 *      the way until the pointer arrives;
 *   3. re-rendering a live call does not rebuild it — the nodes and the video
 *      element survive, which is what stops the window blinking at rest.
 *
 * Run:  node tests/Browser/call-float.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const PORT = Number(process.env.TMA_FLOAT_PORT || 8912);

const failures = [];
function step(n, m) { console.log(`\n[${n}] ${m}`); }
function check(ok, m) { console.log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* A page carrying only what the calls module needs: the morph layer, the call
 * stylesheet, and a signalling API that goes nowhere. */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>call harness</title>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/theme.css">
<link rel="stylesheet" href="/css/dashboard.css">
</head><body>
<script>
  // Signalling with nobody on the other end: the call still builds its peer
  // connection, opens its window and renders; it simply never connects.
  window.TMAMessagingAPI = { callSignal: () => Promise.resolve({}) };
  window.TMAMessagingSettings = { callDisplay: 'compact', ringtone: 'none' };
</script>
<script src="/js/dom-morph.js"></script>
<script src="/js/messaging-calls.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' }[path.extname(file)]
    || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

/* ── 1. The API is there at all ── */
step(1, 'the browser can give a call a window of its own');
const supported = await page.evaluate(() => ({
  api: typeof window.documentPictureInPicture,
  secure: window.isSecureContext,
  claimed: window.TMAMessagingCalls.floatSupported(),
}));
check(supported.secure, 'the harness is a secure context');
check(supported.api === 'object' && supported.claimed,
  `the call module sees the picture-in-picture API (${supported.api})`);

if (!supported.claimed) {
  console.log('\n  ! No document picture-in-picture in this Chromium — skipping the rest.');
  await browser.close();
  server.close();
  process.exit(1);
}

/* ── 2. Placing a call opens the window and moves the call into it ── */
step(2, 'placing a call floats it');
// A real click, because a floating window can only be asked for from a gesture
// — exactly the constraint the production code is built around.
await page.evaluate(() => {
  const b = document.createElement('button');
  b.id = 'go';
  b.textContent = 'call';
  b.onclick = () => window.TMAMessagingCalls.start('conv-1', 'video', 'Dana Reed', '');
  document.body.appendChild(b);
});
await page.click('#go');
await page.waitForFunction(() => window.TMAMessagingCalls._debug().floating, { timeout: 8000 })
  .catch(() => {});

const floated = await page.evaluate(() => window.TMAMessagingCalls._debug().floating);
check(floated, 'the call opened a window of its own');

// getUserMedia resolves after the window opens; wait for the camera itself.
await page.waitForFunction(
  () => {
    const s = window.TMAMessagingCalls._debug().session;
    return s && s.localStream && s.localStream.getVideoTracks().length;
  },
  { timeout: 8000 },
).catch(() => {});
await wait(400);

const inWindow = await page.evaluate(() => {
  const win = window.documentPictureInPicture.window;
  if (!win) return null;
  const box = win.document.querySelector('.tma-call__compact');
  const video = win.document.querySelector('video[data-call-local]');
  const shown = video && video.getBoundingClientRect();
  return {
    drawn: !!box,
    // The page keeps nothing: no scrim, no window, nothing to click through.
    pageEmpty: !document.querySelector('.tma-call__compact, .tma-call__dialog, .tma-call__pill'),
    hasVideo: !!video,
    playing: !!(video && video.srcObject && !video.paused && video.videoWidth > 0),
    // Nobody has answered yet, so the only picture there is is the caller's
    // own camera — and it has to be the one filling the window.
    previewFills: !!(shown && Math.abs(shown.width - win.innerWidth) < 2 &&
      Math.abs(shown.height - win.innerHeight) < 2),
    // The sound is deliberately left in the page, so moving the picture can
    // never silence the call.
    audioStayedHome: !!document.querySelector('audio[data-call-audio]') &&
      !win.document.querySelector('audio[data-call-audio]'),
    styled: getComputedStyle(win.document.body).backgroundColor,
    controls: [...win.document.querySelectorAll('[data-call-action]')]
      .map((b) => b.getAttribute('data-call-action')),
  };
});
check(inWindow && inWindow.drawn, 'the small window is drawn inside it');
check(inWindow && inWindow.pageEmpty, 'and the page behind it is left completely clear');
check(inWindow && inWindow.hasVideo && inWindow.playing,
  'the live camera moved across and kept playing');
check(inWindow && inWindow.previewFills,
  'the camera preview fills the window while the call is still ringing');
check(inWindow && inWindow.audioStayedHome, 'the remote sound stayed behind in the page');
check(inWindow && /rgb/.test(inWindow.styled || ''), `the window carries the app's styling (${inWindow && inWindow.styled})`);
for (const want of ['mute', 'camera', 'hangup', 'pop-in']) {
  check(inWindow && inWindow.controls.includes(want), `it offers "${want}"`);
}

/* ── 3. Edge to edge, and controls that keep out of the way ── */
step(3, 'the picture is the window');
await wait(2600);   // the controls introduce themselves once, then hide
const layout = await page.evaluate(() => {
  const win = window.documentPictureInPicture.window;
  const box = win.document.querySelector('.tma-call__compact');
  const r = box.getBoundingClientRect();
  const stage = box.querySelector('.tma-call__compact-stage').getBoundingClientRect();
  const bar = box.querySelector('.tma-call__compact-controls');
  const barBox = bar.getBoundingClientRect();
  return {
    stageFills: Math.abs(stage.width - r.width) < 1 && Math.abs(stage.height - r.height) < 1,
    fillsWindow: Math.abs(r.width - win.innerWidth) < 1 && Math.abs(r.height - win.innerHeight) < 1,
    hidden: Number(getComputedStyle(bar).opacity) === 0,
    atBottom: barBox.bottom > r.bottom - 4 && barBox.top > r.top + r.height / 2,
  };
});
check(layout.fillsWindow, 'the call fills the window it was given');
check(layout.stageFills, 'the camera runs edge to edge inside it');
check(layout.hidden, 'the controls are out of the way at rest');
check(layout.atBottom, 'and they live along the bottom edge');

/* Hover is what brings them back. Playwright drives the page's mouse, not the
 * floating window's, so the hover is dispatched inside that document. */
const revealed = await page.evaluate(async () => {
  const win = window.documentPictureInPicture.window;
  const doc = win.document;
  const box = doc.querySelector('.tma-call__compact');
  const bar = box.querySelector('.tma-call__compact-controls');
  box.classList.add('is-revealed');            // what :hover does, without a mouse
  // Polled rather than slept: the fade is a CSS transition, and a window that
  // is not the one being looked at can have its animation clock throttled.
  const until = Date.now() + 2000;
  while (Date.now() < until && Number(getComputedStyle(bar).opacity) < 0.99) {
    await new Promise((r) => setTimeout(r, 60));
  }
  // Read out now, not in the return: getComputedStyle is live, and dropping
  // the class below would rewind every number before it could be reported.
  const style = getComputedStyle(bar);
  const opaque = Number(style.opacity) > 0.9 && style.pointerEvents !== 'none';

  const mute = box.querySelector('[data-call-action="mute"]').getBoundingClientRect();
  // What is actually on top at the button's own centre. Opacity alone is not
  // enough: the video frames carry a z-index of their own in this same stacking
  // context, and the bars spent a while perfectly opaque and painted *under*
  // the picture — visible to every measurement and to nobody's eyes.
  const hit = doc.elementFromPoint(mute.left + mute.width / 2, mute.top + mute.height / 2);
  const onTop = !!(hit && hit.closest('[data-call-action="mute"]'));
  const covered = hit ? String(hit.tagName + '.' + (hit.getAttribute('class') || '')) : null;

  box.classList.remove('is-revealed');
  return { opaque, onTop, covered };
});
check(revealed.opaque, 'bringing them up makes them visible and clickable');
check(revealed.onTop,
  `and they come up in front of the picture, not behind it (${revealed.covered})`);

/* ── 4. A control in that window is the same control ── */
step(4, 'the controls in the window drive the same call');
await page.evaluate(() => {
  window.documentPictureInPicture.window.document
    .querySelector('[data-call-action="mute"]').click();
});
await wait(200);
const muted = await page.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  return {
    flag: !!s.muted,
    track: s.localStream ? s.localStream.getAudioTracks().every((t) => !t.enabled) : null,
    shown: !!window.documentPictureInPicture.window.document
      .querySelector('[data-call-action="mute"].is-off'),
  };
});
check(muted.flag && muted.track === true, 'mute in the floating window really muted the microphone');
check(muted.shown, 'and the button shows it');

/* ── 5. Re-rendering does not rebuild the call ── */
step(5, 'a live call updates in place, without blinking');
const stable = await page.evaluate(async () => {
  const win = window.documentPictureInPicture.window;
  const doc = win.document;
  const before = {
    box: doc.querySelector('.tma-call__compact'),
    video: doc.querySelector('video[data-call-local]'),
    media: doc.querySelector('.tma-call__media'),
  };
  const stream = before.video.srcObject;
  const wasPlaying = !before.video.paused;

  // Twenty renders — far more than a call at rest ever does, and the exact
  // thing that used to make it flash.
  const s = window.TMAMessagingCalls._debug().session;
  for (let i = 0; i < 20; i++) {
    s.quality = i % 2 ? 'good' : 'fair';
    window.TMAMessagingCalls._debug();
    // The module re-renders on its own state changes; poke one it watches.
    doc.querySelector('[data-call-action="mute"]').click();
    await new Promise((r) => setTimeout(r, 12));
  }

  const after = {
    box: doc.querySelector('.tma-call__compact'),
    video: doc.querySelector('video[data-call-local]'),
    media: doc.querySelector('.tma-call__media'),
  };
  return {
    sameBox: before.box === after.box,
    sameVideo: before.video === after.video,
    sameMedia: before.media === after.media,
    sameStream: after.video.srcObject === stream,
    stillPlaying: wasPlaying ? !after.video.paused : true,
  };
});
check(stable.sameBox, 'the window itself was updated, not replaced');
check(stable.sameVideo && stable.sameMedia, 'the video element was never torn out and rebuilt');
check(stable.sameStream && stable.stillPlaying, 'and the picture never stopped');

/* ── 6. Putting it back in the page ── */
step(6, 'popping the call back into the page');
const pcBefore = await page.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  s.pc.__id = s.pc.__id || Math.random();
  return s.pc.__id;
});
await page.evaluate(() => {
  window.documentPictureInPicture.window.document
    .querySelector('[data-call-action="pop-in"]').click();
});
await wait(500);
const home = await page.evaluate(() => {
  const s = window.TMAMessagingCalls._debug().session;
  const video = document.querySelector('video[data-call-local]');
  return {
    floating: window.TMAMessagingCalls._debug().floating,
    windowGone: !window.documentPictureInPicture.window,
    drawnInPage: !!document.querySelector('.tma-call__compact'),
    videoBack: !!video && !!video.srcObject && !video.paused,
    samePc: s.pc.__id,
    live: s.localStream.getTracks().every((t) => t.readyState === 'live'),
  };
});
check(!home.floating && home.windowGone, 'the window closed');
check(home.drawnInPage, 'and the call came back into the page');
check(home.videoBack, 'with the picture still running');
check(home.samePc === pcBefore && home.live,
  'the same peer connection and the same tracks throughout');

/*
 * The same window, drawn in the page. This is also the whole experience in a
 * browser that has no floating window to offer (Safari, Firefox), so it has to
 * stand on its own rather than being a consolation prize.
 */
await wait(2600);   // let the one-off reveal finish
const inPage = await page.evaluate(() => {
  const box = document.querySelector('.tma-call__compact');
  const r = box.getBoundingClientRect();
  const stage = box.querySelector('.tma-call__compact-stage').getBoundingClientRect();
  const bar = box.querySelector('.tma-call__compact-controls');
  return {
    stageFills: Math.abs(stage.width - r.width) < 1 && Math.abs(stage.height - r.height) < 1,
    hidden: Number(getComputedStyle(bar).opacity) === 0,
    offersPopOut: !!box.querySelector('[data-call-action="pop-out"]'),
  };
});
check(inPage.stageFills, 'the in-page window is edge to edge as well');
check(inPage.hidden, 'and its controls stay out of the way too');
check(inPage.offersPopOut, 'and it offers the way back out to a floating window');

await page.hover('.tma-call__compact');
await wait(320);
const hovered = await page.evaluate(() => {
  const bar = document.querySelector('.tma-call__compact-controls');
  const style = getComputedStyle(bar);
  const mute = document.querySelector('.tma-call__compact [data-call-action="mute"]')
    .getBoundingClientRect();
  const hit = document.elementFromPoint(mute.left + mute.width / 2, mute.top + mute.height / 2);
  return {
    up: Number(style.opacity) > 0.9 && style.pointerEvents !== 'none',
    onTop: !!(hit && hit.closest('[data-call-action="mute"]')),
  };
});
check(hovered.up, 'a real hover brings the in-page controls up and makes them clickable');
check(hovered.onTop, 'and they are the thing on top, not painted under the picture');

/* ── 7. Ending the call takes the window with it ── */
step(7, 'ending the call');
await page.evaluate(() => window.TMAMessagingCalls.end());
await wait(300);
const done = await page.evaluate(() => ({
  session: window.TMAMessagingCalls.isActive(),
  overlay: !!document.querySelector('.tma-call'),
  audio: !!document.querySelector('audio[data-call-audio]'),
}));
check(!done.session && !done.overlay, 'the call and its overlay are gone');
check(!done.audio, 'and so is the audio element it parked in the page');

const noise = errors.filter((e) => !/Origin not allowed|favicon/i.test(e));
check(noise.length === 0, `no page errors${noise.length ? ': ' + noise.join(' | ') : ''}`);

await browser.close();
server.close();

console.log(`\n${failures.length ? `✗ ${failures.length} failed` : '✓ all checks passed'}`);
failures.forEach((f) => console.log(`   - ${f}`));
process.exit(failures.length ? 1 : 0);
