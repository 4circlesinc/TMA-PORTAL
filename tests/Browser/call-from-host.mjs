/*
 * A call answered on the phone's own call screen, with the app closed.
 *
 * The phone apps ring from a push (CallKit on an iPhone, Android's call
 * notification). By the time the app has opened its page, the websocket's
 * `ring` and the caller's `offer` have both gone by. This drives two real
 * pages with a real peer connection between them and checks the page catches
 * up the way it must:
 *
 *   1. answerFromHost finds the missed ring (LiveCalls), asks the caller for
 *      the offer again, answers, and the call connects on both ends;
 *   2. a call already over is reported to the app ("ended") with nothing left
 *      ringing;
 *   3. answering on another of your own devices stops this one ringing;
 *   4. an iPhone app (CallKit rings) and a call the phone rings itself never
 *      play the page's ringtone on top.
 *
 * No server, no database: signalling is relayed between the two pages here,
 * shaped exactly as App\Events\CallSignal broadcasts it.
 *
 * Run:  node tests/Browser/call-from-host.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const PORT = Number(process.env.TMA_HOSTCALL_PORT || 8913);

const failures = [];
function step(n, m) { console.log(`\n[${n}] ${m}`); }
function check(ok, m) { console.log(`    ${ok ? '✓' : '✗'} ${m}`); if (!ok) failures.push(m); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = (boot) => `<!doctype html>
<html><head><meta charset="utf-8"><title>host call harness</title>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/dashboard.css">
</head><body>
<script>
  ${boot}
  window.__rings = 0;
  var RealAudio = window.Audio;
  window.Audio = function (src) { if (String(src || '').indexOf('ringtone') !== -1) window.__rings++; return new RealAudio(src); };
  window.__toasts = [];
  window.TMAToast = { show: function (m) { window.__toasts.push(m); } };
  window.__phases = [];
  new MutationObserver(function () {
    window.__phases.push(document.documentElement.getAttribute('data-tma-call') || '');
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tma-call'] });
  window.TMAMessagingAPI = {
    callSignal: function (conversationId, body) { return window.__relay(conversationId, JSON.stringify(body)).then(function () { return {}; }); },
    liveCall: function (signalId) { return window.__liveCall(signalId).then(function (raw) { return JSON.parse(raw); }); },
  };
</script>
<script src="/js/dom-morph.js"></script>
<script src="/js/messaging-calls.js"></script>
</body></html>`;

let boots = {};
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.startsWith('/page/')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(boots[url.slice(6)] || ''));
    return;
  }
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
let browser;
try { browser = await chromium.launch({ args }); } catch { browser = await chromium.launch({ args, channel: 'chrome' }); }

const errors = [];
const CONV = 'conv-1';
const ANN = 1; // the caller
const BOB = 2; // the callee
let ring = null; // the LiveCalls record the server would keep
const pages = {}; // userId -> [page...] listening on the socket

async function open(name, userId, boot = '') {
  boots[name] = boot;
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.exposeFunction('__relay', async (conversationId, raw) => {
    const body = JSON.parse(raw);
    const payload = Object.assign({}, body.payload || {});
    if (body.media) payload.media = body.media;
    payload.fromName = userId === ANN ? 'Ann' : 'Bob';
    const signal = { signalId: crypto.randomUUID(), conversationId, fromUserId: userId, type: body.type, payload };
    if (body.type === 'ring') ring = { live: true, outcome: null, signal };
    if (['accept', 'reject', 'hangup'].includes(body.type) && ring) ring = Object.assign({}, ring, { live: false, outcome: body.type });
    // Everyone else in the conversation hears it; accept/reject also reach the sender's own other devices.
    const to = Object.entries(pages).flatMap(([id, list]) => (Number(id) !== userId || ['accept', 'reject'].includes(body.type) ? list : []));
    for (const p of to) {
      if (p === page) continue;
      await p.evaluate((s) => window.TMAMessagingCalls.onSignal(s), signal).catch(() => {});
    }
  });
  await page.exposeFunction('__liveCall', async () => JSON.stringify(ring || { live: false }));
  await page.goto(`http://127.0.0.1:${PORT}/page/${name}`, { waitUntil: 'load' });
  await page.evaluate((id) => window.TMAMessagingCalls.setViewer(id), userId);
  return page;
}
function listen(userId, page) { (pages[userId] = pages[userId] || []).push(page); }
const state = (page) => page.evaluate(() => {
  const d = window.TMAMessagingCalls._debug();
  return { has: !!d.session, connected: !!(d.session && d.session.connected), mode: d.mode, role: d.session && d.session.role };
});

/* ── 1. Answered from the call screen, page opened afterwards ── */
step(1, 'an app opened by its push answers a call whose ring and offer already went by');
const ann = await open('ann', ANN, "window.TMAMessagingSettings = { callDisplay: 'compact', ringtone: 'none' };");
listen(ANN, ann);
await ann.evaluate((c) => window.TMAMessagingCalls.start(c, 'audio', 'Bob', null, 1), CONV);
await wait(1500); // ring, offer and the caller's ICE all go out to nobody
check(ring && ring.signal.type === 'ring', 'the ring was recorded for the push to carry');

const bob = await open('bob', BOB, "window.TMAMessagingSettings = { ringtone: 'ringtone-1' };");
listen(BOB, bob);
const answered = await bob.evaluate((s) => window.TMAMessagingCalls.answerFromHost({ signalId: s.signalId, conversationId: s.conversationId }, false), ring.signal);
check(answered === true, 'answerFromHost found the call');
let ok = false;
for (let i = 0; i < 40 && !ok; i++) {
  await wait(250);
  const [a, b] = [await state(ann), await state(bob)];
  ok = a.connected && b.connected;
}
check(ok, 'the call connected on both ends');
check((await bob.evaluate(() => window.__rings)) === 0, 'the page did not ring over the phone\'s own call screen');
await ann.evaluate(() => window.TMAMessagingCalls.end());
await wait(300);
check(!(await state(bob)).has, 'hanging up on one end ends the other');

/* ── 2. A call already over ── */
step(2, 'a call that ended before the app opened is reported, not rung');
ring = Object.assign({}, ring, { live: false, outcome: 'missed' });
const bob2 = await open('bob2', BOB);
const found = await bob2.evaluate((s) => window.TMAMessagingCalls.answerFromHost({ signalId: s.signalId, conversationId: s.conversationId }), ring.signal);
await wait(200);
const after = await bob2.evaluate(() => ({ phases: window.__phases, toasts: window.__toasts, attr: document.documentElement.getAttribute('data-tma-call') }));
check(found === false, 'nothing to answer');
check(after.phases.includes('ended') && after.attr === null, 'the app is told "ended", and the page is left with no call');
check(after.toasts.includes('Call ended'), 'and the person is told why');
await bob2.close();

/* ── 3. Answered on another device ── */
step(3, 'answering on another of your devices stops this one ringing');
pages[BOB] = [];
const tablet = await open('tablet', BOB, "window.TMAMessagingSettings = { ringtone: 'ringtone-1' };");
const phone = await open('phone', BOB, "window.TMAMessagingSettings = { ringtone: 'ringtone-1' };");
listen(BOB, tablet); listen(BOB, phone);
await ann.evaluate((c) => window.TMAMessagingCalls.start(c, 'audio', 'Bob', null, 1), CONV);
await wait(800);
check((await state(tablet)).mode === 'incoming' && (await state(phone)).mode === 'incoming', 'both of Bob\'s devices ring');
check((await tablet.evaluate(() => window.__rings)) > 0, 'a browser with no call screen of its own rings out loud');
await phone.evaluate(() => window.TMAMessagingCalls.accept(false));
await wait(800);
check(!(await state(tablet)).has, 'the other device stopped ringing');
check((await tablet.evaluate(() => window.__toasts)).includes('Answered on another device'), 'and says where it went');
check((await state(phone)).has, 'the device that answered keeps the call');
await ann.evaluate(() => window.TMAMessagingCalls.end());
await wait(300);
for (const p of [tablet, phone]) await p.close();

/* ── 4. The iPhone app's CallKit rings, the page does not ── */
step(4, 'with CallKit ringing the page plays no ringtone of its own');
pages[BOB] = [];
const iphone = await open('iphone', BOB, "window.TMADesktop = { isIOS: true, callKit: true }; window.TMAMessagingSettings = { ringtone: 'ringtone-1' };");
listen(BOB, iphone);
await ann.evaluate((c) => window.TMAMessagingCalls.start(c, 'video', 'Bob', null, 1), CONV);
await wait(800);
const call = await iphone.evaluate(() => ({ rings: window.__rings, info: JSON.parse(document.documentElement.getAttribute('data-tma-call-info') || '{}') }));
check((await state(iphone)).mode === 'incoming', 'the pop-up is there');
check(call.rings === 0, 'no page ringtone under CallKit');
check(call.info.signalId === ring.signal.signalId && call.info.conversationId === CONV, 'the call-info names the ring, so the app matches it to its push');
await iphone.evaluate(() => window.TMAMessagingCalls.declineFromHost({ conversationId: 'conv-1' }));
await wait(300);
check(!(await state(iphone)).has && !(await state(ann)).has, 'declining from the call screen ends it on both ends');

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
