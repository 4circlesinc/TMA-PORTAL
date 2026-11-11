/*
 * "/" in a chat, Request files, the request card, and a message's details.
 *
 *   node tests/Browser/messages-request-files.mjs
 *
 * Serves the real shell and public/ with a small chat the page can talk to,
 * and drives it as a person would: "/" lists the commands, Request files asks
 * which application (or none, then which folder), the checklist offers the
 * application's outstanding documents, and the card that is posted lists
 * each one. On a card somebody else sent, each document has its own Upload
 * button, and the row ticks off when its file is in. A bubble's menu has
 * Details: sent, seen by whom and when. MessagingFileRequestTest covers the
 * server's half (who may ask, which applications, the filing itself).
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

const PUBLIC = resolve('public')
const SHELL = resolve('resources/views/pages/dashboard.html')
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

const ME = { id: 1, name: 'Ava Admin', email: 'ava@example.com', isStaff: true, isAdmin: true, capabilities: ['clients.view', 'cip.view'] }
const now = () => new Date().toISOString()
const conversation = { id: 'conv-1', type: 'direct', name: 'Gil Contact', photo: null, preview: 'Hello', unread: 0, time: '3:00 PM', timestamp: now(), members: [], memberCount: 2, listed: true, counterpartId: 2 }

function message(over) {
  return Object.assign({
    type: 'text', direction: 'in', body: 'Hello', deleted: false, edited: false,
    sender: { id: 2, name: 'Gil Contact', photo: null }, sentAt: now(), time: '3:00 PM', lane: null, replyTo: null,
    announcement: false, forwarded: false, attachments: [], reactions: [], starred: false, mentions: [], mentionsAll: false,
    mentionsMe: false, systemEvent: null, fileRequest: null, status: null, seenBy: [], can: { edit: false, delete: false },
  }, over)
}

const messages = [
  message({ id: 'm-1', seq: 1, body: 'Hi Ava, how can I help?' }),
  // Gil asked Ava for two documents: Ava answers from the card.
  message({
    id: 'm-in', seq: 2, type: 'file_request', body: 'Requested files: Oath of Allegiance, Proof of payment for CHEN WEI',
    fileRequest: {
      id: 'fr-in', kind: 'documents', title: 'Documents for CHEN WEI', message: 'Signed copies please.',
      application: { id: 'app-1', number: 'CIP-2001', name: 'CHEN WEI', provider: 'Galaxy' }, folder: null,
      documents: [
        { id: 'd1', label: 'Oath of Allegiance', person: 'CHEN WEI', received: false, closed: false },
        { id: 'd2', label: 'Proof of payment', person: 'CHEN WEI', received: false, closed: false },
      ],
      received: 0, maxFiles: 2, open: true, closedReason: null, expiresAt: new Date(Date.now() + 14 * 864e5).toISOString(), requestedBy: 2,
    },
  }),
  message({ id: 'm-2', seq: 3, direction: 'out', body: 'Thanks, sending shortly', sender: { id: 1, name: 'Ava Admin', photo: null }, status: 'read', can: { edit: true, delete: true } }),
]

const APPLICATION = {
  id: 'app-1', number: 'IGA26-00018', internalNumber: 'IGA26-00018', cipNumber: null, phase: 'pre_approval', provider: 'Galaxy', sponsor: null,
  applicant: { id: 'p1', name: 'CHEN WEI', documents: [
    { id: 'd1', type: 'oath', label: 'SL4 - Oath of Allegiance', required: true, status: 'pending_upload', statusLabel: 'Pending upload', statusTone: 'pending' },
    { id: 'd2', type: 'pop', label: 'Proof of payment', required: true, status: 'update_required', statusLabel: 'Update required', statusTone: 'danger' },
    { id: 'd3', type: 'pass', label: 'Passport bio page', required: true, status: 'approved', statusLabel: 'Approved', statusTone: 'success' },
  ] },
  dependents: [{ id: 'p2', name: 'MEI WEI', documents: [
    { id: 'd4', type: 'birth', label: 'Birth certificate', required: true, status: 'pending_upload', statusLabel: 'Pending upload', statusTone: 'pending' },
  ] }],
}

const calls = []
let seq = 10

async function body(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  const ext = extname(path)
  if (ext && ext !== '.html') {
    try {
      const file = join(PUBLIC, path)
      await stat(file)
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
    return
  }
  if (path === '/me') return json(res, 200, ME)
  if (path === '/portal/messaging/conversations') {
    return json(res, 200, { conversations: [conversation], me: { id: 1, name: 'Ava Admin' }, settings: { readReceipts: true }, realtime: { enabled: false }, limits: {}, tabCounts: {} })
  }
  if (path === '/portal/messaging/conversations/conv-1/messages') return json(res, 200, { messages, hasMore: false, conversation })
  if (path === '/portal/messaging/conversations/conv-1/file-requests/options') {
    const q = (url.searchParams.get('q') || '').toLowerCase()
    const apps = [
      { id: 'app-1', number: 'CIP-2001', name: 'CHEN WEI', provider: 'Galaxy' },
      { id: 'app-2', number: 'CIP-2002', name: 'ANA LOPEZ', provider: 'Galaxy' },
    ].filter(a => !q || (a.name + a.number).toLowerCase().includes(q))
    return json(res, 200, { canRequest: true, fixed: null, applications: apps })
  }
  if (path === '/portal/cip/applications/app-1') return json(res, 200, { application: APPLICATION })
  if (path === '/portal/messaging/conversations/conv-1/file-requests' && req.method === 'POST') {
    const data = JSON.parse((await body(req)).toString() || '{}')
    calls.push({ create: data })
    const all = [...APPLICATION.applicant.documents, ...APPLICATION.dependents[0].documents]
    const picked = (data.documents || []).map(id => ({ id, label: all.find(d => d.id === id).label, person: id === 'd4' ? 'MEI WEI' : 'CHEN WEI', received: false, closed: false }))
    seq += 1
    const sent = message({
      id: 'm-' + seq, seq, direction: 'out', type: 'file_request', sender: { id: 1, name: 'Ava Admin', photo: null }, status: 'sent',
      body: 'Requested files', can: { edit: false, delete: true },
      fileRequest: data.folder
        ? { id: 'fr-' + seq, kind: 'folder', title: data.title || 'Files', message: data.message, application: null, folder: { id: data.folder, name: 'Invoices' }, documents: [], received: 0, maxFiles: 5, open: true, closedReason: null, expiresAt: data.expiresAt, requestedBy: 1 }
        : { id: 'fr-' + seq, kind: 'documents', title: 'Documents for CHEN WEI', message: data.message, application: { id: 'app-1', number: 'CIP-2001', name: 'CHEN WEI', provider: 'Galaxy' }, folder: null, documents: picked, received: 0, maxFiles: picked.length, open: true, closedReason: null, expiresAt: data.expiresAt, requestedBy: 1 },
    })
    messages.push(sent)
    return json(res, 201, { message: sent })
  }
  let match = path.match(/^\/portal\/messaging\/messages\/([^/]+)\/file-request-upload$/)
  if (match && req.method === 'POST') {
    const raw = (await body(req)).toString('latin1')
    const doc = (raw.match(/name="document"\r\n\r\n([^\r]+)/) || [])[1]
    calls.push({ upload: match[1], document: doc })
    const fr = messages.find(m => m.id === match[1]).fileRequest
    const row = fr.documents.find(d => d.id === doc)
    if (row) row.received = true
    fr.received += 1
    return json(res, 201, { fileRequest: fr, upload: { name: 'scan.pdf', size: 12, remaining: 1 } })
  }
  match = path.match(/^\/portal\/messaging\/messages\/([^/]+)\/info$/)
  if (match) {
    return json(res, 200, {
      sentAt: now(), sentAtLabel: '11 Nov 2026, 3:04 PM', editedAtLabel: null, sender: 'Ava Admin', mine: true,
      readBy: [{ id: 2, name: 'Gil Contact', avatar: null, seenAt: now(), seenAtLabel: '11 Nov 2026, 3:06 PM' }],
      deliveredTo: [{ id: 3, name: 'Rita Officer', avatar: null }],
      waiting: [{ id: 4, name: 'Sam Clerk', avatar: null }],
    })
  }
  if (path.startsWith('/portal/files')) {
    const inside = url.searchParams.get('folder')
    return json(res, 200, { folders: [{ id: 'fold-1', name: 'Invoices', fileCount: 2, folderCount: 0 }], files: [], breadcrumb: inside ? [{ id: inside, name: 'Invoices' }] : [] })
  }
  if (path.startsWith('/portal/') || path.startsWith('/me/') || path.startsWith('/broadcasting') || path === '/up') return json(res, 200, {})
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(await readFile(SHELL))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await chromium.launch()
} catch (e) {
  browser = await chromium.launch({ channel: 'chrome' })
}

let failures = 0
function check(ok, label) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label)
  if (!ok) failures += 1
}

async function openChat(width) {
  const phone = width < 800
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
  await ctx.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('tma.legalAccepted', '1') } catch (e) { /* asked instead */ } })
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', e => page.errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}/social/messages`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.evaluate(() => document.querySelector('.tma-dash__messages-row').click())
  await page.waitForTimeout(1200)
  return page
}

const lastCall = kind => calls.filter(c => c[kind]).pop()

try {
  console.log('\nA phone: the card and the list fit')
  let page = await openChat(390)
  const fit = await page.evaluate(() => {
    const card = document.querySelector('[data-messages-id="m-in"] .tma-dash__messages-request')
    const r = card.getBoundingClientRect()
    return { inside: r.left >= 0 && r.right <= innerWidth, wide: document.scrollingElement.scrollWidth > innerWidth, buttons: card.querySelectorAll('[data-chatreq-upload]').length }
  })
  check(fit.inside && !fit.wide, 'the request card sits inside the screen')
  check(fit.buttons === 2, 'a card somebody else sent has an Upload button per document')
  await page.locator('[data-messages-composer-input]').click()
  await page.keyboard.type('/')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => { const m = document.querySelector('[data-messages-slash-menu]'); return !m.hidden && /Request files/.test(m.innerText) }), '"/" lists Request files')
  check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''))
  await page.context().close()

  console.log('\nRequest files for an application')
  page = await openChat(1440)
  await page.locator('[data-messages-composer-input]').click()
  await page.keyboard.type('/req')
  await page.waitForTimeout(200)
  check(await page.evaluate(() => /Request files/.test(document.querySelector('[data-messages-slash-menu]').innerText)), '"/req" narrows to Request files')
  await page.keyboard.type('zz')
  await page.waitForTimeout(200)
  check(await page.evaluate(() => document.querySelector('[data-messages-slash-menu]').hidden), 'nothing matches "/reqzz": the list hides')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(900)
  check(await page.evaluate(() => document.querySelector('[data-messages-composer-input]').textContent === ''), 'the "/" leaves the message box')
  const listed = await page.evaluate(() => document.querySelector('[data-chatreq-list]').innerText)
  check(/No application/.test(listed) && /CHEN WEI/.test(listed) && /ANA LOPEZ/.test(listed), 'which application, or none')
  await page.fill('[data-chatreq-search]', 'chen')
  await page.waitForTimeout(600)
  check(!/ANA LOPEZ/.test(await page.evaluate(() => document.querySelector('[data-chatreq-list]').innerText)), 'search narrows the applications')
  await page.click('[data-chatreq-app="app-1"]')
  await page.waitForTimeout(900)
  const offered = await page.evaluate(() => [...document.querySelectorAll('[data-docreq-doc]')].map(b => b.getAttribute('data-docreq-doc')))
  check(offered.join(',') === 'd1,d2,d4', `the checklist offers what is still outstanding, everyone's (${offered.join(',')})`)
  const chooser0 = await page.evaluate(() => ({
    title: document.querySelector('.tma-portal-modal__title, .tma-portal-modal h2').textContent,
    face: !!document.querySelector('.tma-dash__clients-card-person-face'),
    facts: document.querySelector('.tma-cip-docreq__facts').innerText,
    ticked: document.querySelectorAll('[data-docreq-doc]:checked').length,
    words: [...document.querySelectorAll('.tma-portal-modal .tma-portal-modal__text')].length,
  }))
  check(/Request documents/.test(chooser0.title) && chooser0.face && /Application number[\s\S]*IGA26-00018/.test(chooser0.facts),
    'the application page\'s own chooser: its title, the face, the numbers')
  check(chooser0.ticked === 3, 'everything outstanding starts ticked, as on the application page')
  check(chooser0.words === 0, 'no paragraph of explanation')
  await page.uncheck('[data-docreq-doc="d2"]')
  await page.fill('[data-chatreq-message]', 'Scans of the originals, please.')
  await page.click('[data-chatreq-send]')
  await page.waitForTimeout(1200)
  const created = lastCall('create')
  check(created && created.create.application === 'app-1' && created.create.documents.join(',') === 'd1,d4' && created.create.message === 'Scans of the originals, please.' && created.create.expiresAt,
    'the request carries the application, the ticked documents, the instructions and a date')
  const mine = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.tma-dash__messages-bubble--out .tma-dash__messages-request')].pop()
    return { text: card.innerText, buttons: card.querySelectorAll('[data-chatreq-upload]').length }
  })
  check(/SL4 - Oath of Allegiance/.test(mine.text) && /Birth certificate/.test(mine.text) && /0 of 2 received/.test(mine.text) && mine.buttons === 0,
    'my card: the documents and "0 of 2 received", no Upload buttons for the person who asked')
  check(!/waiting/i.test(mine.text) && !/Please upload/.test(mine.text), 'no Waiting chips, no sentence repeating the list')

  console.log('\nAnswering from the card')
  const chooser = page.waitForEvent('filechooser')
  await page.evaluate(() => document.querySelector('[data-chatreq-upload="m-in"][data-chatreq-doc="d1"]').click())
  await (await chooser).setFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') })
  await page.waitForTimeout(1200)
  const uploaded = lastCall('upload')
  check(uploaded && uploaded.upload === 'm-in' && uploaded.document === 'd1', 'the file goes up against that document')
  const answered = await page.evaluate(() => document.querySelector('[data-messages-id="m-in"] .tma-dash__messages-request').innerText)
  check(/Oath of Allegiance[\s\S]*received/i.test(answered) && /Proof of payment[\s\S]*Upload/.test(answered), 'that row reads Received; the other still has its button')

  console.log('\nMessage details')
  await page.evaluate(() => document.querySelector('[data-messages-menu="m-2"]').click())
  await page.waitForTimeout(300)
  check(await page.evaluate(() => !!document.querySelector('.tma-dash__messages-message-menu [data-menu-action="details"]')), 'the menu has Details')
  await page.evaluate(() => document.querySelector('.tma-dash__messages-message-menu [data-menu-action="details"]').click())
  await page.waitForTimeout(800)
  const info = await page.evaluate(() => document.querySelector('[data-msginfo-body]').innerText)
  check(/11 Nov 2026, 3:04 PM/.test(info) && /Gil Contact/.test(info) && /Seen 11 Nov 2026, 3:06 PM/.test(info), 'when it was sent, who has seen it and when')
  check(/Rita Officer/.test(info) && /Sam Clerk/.test(info), 'who has it but has not opened it, and who it has not reached')
  await page.evaluate(() => document.querySelector('[data-msginfo-close]').click())
  await page.evaluate(() => document.querySelector('[data-messages-menu="m-in"]').click())
  await page.waitForTimeout(300)
  check(!(await page.evaluate(() => !!document.querySelector('.tma-dash__messages-message-menu [data-menu-action="forward"]'))), 'a request card is not forwarded')
  await page.keyboard.press('Escape')

  console.log('\nNo application: files into a folder')
  await page.locator('[data-messages-composer-input]').click()
  await page.keyboard.type('/')
  await page.waitForTimeout(200)
  await page.evaluate(() => document.querySelector('[data-messages-slash-pick="0"]').click())
  await page.waitForTimeout(800)
  await page.click('[data-chatreq-none]')
  await page.waitForTimeout(400)
  await page.fill('[data-chatreq-title]', 'Your October invoices')
  await page.click('[data-chatreq-send]')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => !!document.querySelector('[data-chatreq-title]')), 'a folder is needed before it sends')
  await page.click('[data-chatreq-folder]')
  await page.waitForTimeout(700)
  await page.click('[data-save-open="fold-1"]')
  await page.waitForTimeout(600)
  await page.click('[data-save-ok]')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelector('[data-chatreq-title]').value === 'Your October invoices'), 'back from the folder picker with what was typed')
  await page.click('[data-chatreq-send]')
  await page.waitForTimeout(1000)
  const folderCall = lastCall('create')
  check(folderCall.create.folder === 'fold-1' && folderCall.create.title === 'Your October invoices' && !folderCall.create.application, 'the request names the folder')
  const folderCard = await page.evaluate(() => [...document.querySelectorAll('.tma-dash__messages-request')].pop().innerText)
  check(/Your October invoices/.test(folderCard) && /Invoices · by/.test(folderCard), 'the card says what is needed and where it goes')

  check(page.errors.length === 0, 'no page errors' + (page.errors.length ? ': ' + page.errors.join(' | ') : ''))
} finally {
  await browser.close()
  server.close()
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
