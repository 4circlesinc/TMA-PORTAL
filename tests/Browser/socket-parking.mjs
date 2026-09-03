/*
 * Idle-tab socket parking.
 *
 * The WebSocket cluster admits a limited number of connections and every
 * open tab holds one. messaging-realtime.js now parks a long-hidden tab's
 * socket when another tab of the same browser is connected, and takes it
 * back on visibility or when the holder disappears. What only a browser can
 * check: three real pages in one profile coordinating over a real
 * BroadcastChannel against a real Reverb, parking closing the socket
 * without arming the retry loop, and unparking re-authing the channels.
 *
 * Headless pages don't report real visibility, so document.hidden is
 * stubbed per page and visibilitychange dispatched by hand; the park timer
 * is not waited on either — parkCheck() is driven directly with a rewound
 * _hiddenAt. Everything downstream of those two inputs is the real code.
 *
 * Needs the app served with a Reverb alongside (see live-updates.mjs).
 *
 *   TMA_BASE_URL=http://127.0.0.1:8899 node tests/Browser/socket-parking.mjs
 */

import { chromium } from 'playwright'

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899'

let failures = 0
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`)
  if (!ok) failures += 1
}

const browser = await chromium.launch()
const context = await browser.newContext()

const errors = []
const HIDDEN_STUB = `
  window.__forceHidden = false;
  Object.defineProperty(document, 'hidden', { get: () => window.__forceHidden === true });
  Object.defineProperty(document, 'visibilityState', { get: () => (window.__forceHidden ? 'hidden' : 'visible') });
`

async function newPortalPage(label) {
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.addInitScript(HIDDEN_STUB)
  return page
}

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
  await page.click('text=Sign in with Email')
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 })
  await page.fill('input[name="email"]', 'e2e@example.com')
  await page.fill('input[name="password"]', 'password12345')
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ])
  await page.waitForTimeout(500)

  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.click('.tma-auth__submit:has-text("Yes")'),
    ])
    await page.waitForTimeout(300)
  }

  if (page.url().includes('/auth/')) throw new Error(`stuck on auth: ${page.url()}`)
}

const rtState = (page) =>
  page.evaluate(() => {
    const rt = window.TMAMessagingRealtime
    return rt && {
      connected: rt.connected,
      parked: rt.parked,
      socketId: rt.socketId,
      retryArmed: !!rt.retryTimer,
      subscribedChannels: Object.keys(rt.channels).filter((c) => rt.channels[c].subscribed),
    }
  })

const waitConnected = (page, want = true) =>
  page.waitForFunction(
    (want) => {
      const rt = window.TMAMessagingRealtime
      return !!rt && rt.connected === want
    },
    want,
    { timeout: 15000 }
  )

const setHidden = (page, hidden) =>
  page.evaluate((hidden) => {
    window.__forceHidden = hidden
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)

/* Rewind the hidden clock past the park threshold and run one park sweep. */
const sweep = (page) =>
  page.evaluate(() => {
    const rt = window.TMAMessagingRealtime
    if (rt._hiddenAt) rt._hiddenAt = Date.now() - 6 * 60 * 1000
    rt.parkCheck()
  })

console.log('\nSocket parking — three tabs, one browser\n')

const page1 = await newPortalPage('tab1')
await signIn(page1)
await page1.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })

const page2 = await newPortalPage('tab2')
await page2.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })
const page3 = await newPortalPage('tab3')
await page3.goto(`${BASE}/folders/all`, { waitUntil: 'networkidle' })

await waitConnected(page1)
await waitConnected(page2)
await waitConnected(page3)
check(true, 'three tabs, three connected sockets')

// Freshen the heartbeats so every tab knows about its two peers.
for (const p of [page1, page2, page3]) await p.evaluate(() => window.TMAMessagingRealtime.beat())
await page1.waitForTimeout(400)

// --- Hidden tabs park while a visible tab holds the socket ---------------
await setHidden(page2, true)
await setHidden(page3, true)
await sweep(page2)
await sweep(page3)
await page1.waitForTimeout(400)

let s1 = await rtState(page1)
let s2 = await rtState(page2)
let s3 = await rtState(page3)
check(s2.parked && !s2.connected && !s2.socketId, 'hidden tab 2 parked and released its socket')
check(s3.parked && !s3.connected && !s3.socketId, 'hidden tab 3 parked and released its socket')
check(!s2.retryArmed && !s3.retryArmed, 'parking did not arm the reconnect loop')
check(s1.connected && !s1.parked, 'visible tab 1 kept its socket')

// --- A parked tab that becomes visible reconnects and re-subscribes ------
await setHidden(page2, false)
await waitConnected(page2)
await page2.waitForFunction(
  () => {
    const rt = window.TMAMessagingRealtime
    return Object.keys(rt.channels).some((c) => rt.channels[c].subscribed)
  },
  { timeout: 15000 }
)
s2 = await rtState(page2)
check(s2.connected && !s2.parked && !!s2.socketId, 'tab 2 reconnected on becoming visible')
check(s2.subscribedChannels.length > 0, `tab 2 re-authorised its channels (${s2.subscribedChannels.join(', ')})`)

// --- A lone parked survivor takes the socket back --------------------------
// Park tab 2 again, then remove the other two tabs: tab 3 dies abruptly
// (a crash sends no goodbye — its peer entry is aged past the freshness
// window here, standing in for the 2.5 minutes a real survivor waits) and
// tab 1 navigates away, which fires the pagehide goodbye for real. The
// parked survivor must notice nobody is connected any more and reconnect
// even while hidden, so notifications still have somewhere to arrive.
await setHidden(page2, true)
await sweep(page2)
s2 = await rtState(page2)
check(s2.parked, 'tab 2 parked again while tabs 1 and 3 remain')

await page3.close()
await page1.goto('about:blank')
await page2.waitForTimeout(600) // the goodbye broadcast reaches tab 2

const sawGoodbye = await page2.evaluate(() => {
  const rt = window.TMAMessagingRealtime
  return Object.keys(rt._peers).some((id) => rt._peers[id].connected === false)
})
check(sawGoodbye, "tab 1's pagehide goodbye reached the survivor")

await page2.evaluate(() => {
  const rt = window.TMAMessagingRealtime
  Object.keys(rt._peers).forEach((id) => { rt._peers[id].at -= 3 * 60 * 1000 })
})
await sweep(page2)
await waitConnected(page2)
s2 = await rtState(page2)
check(s2.connected && !s2.parked, 'last surviving tab took the socket back while hidden')

// --- No parking without a connected peer ----------------------------------
// Tab 2 is now alone and hidden; a sweep must never strand it.
await sweep(page2)
s2 = await rtState(page2)
check(s2.connected && !s2.parked, 'a lone hidden tab refuses to park')

const noise = errors.filter((e) => !/favicon/i.test(e))
check(noise.length === 0, noise.length ? `page errors: ${noise.join(' | ')}` : 'no page errors')

await browser.close()
console.log(failures ? `\n${failures} failure(s)\n` : '\nall good\n')
process.exit(failures ? 1 : 0)
