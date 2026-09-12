/*
 * The order of a person's documents on a CIP application: by what needs a
 * hand, most first. Update required, then Application review, then Ready
 * for submission, then the empty slots (Pending upload) last — on the
 * detail checklist and on the post-approval Edit card alike. Within a band
 * the firm's own arrangement holds, so two documents in the same state keep
 * the order Document Requirements gave them.
 *
 * Both renderers are called directly with a made-up person, because the
 * question is the order the rows come out in, not how an application gets
 * its documents (cip-application-full.mjs pins that). The seed is arranged
 * so that the firm's order and the priority order can never be mistaken
 * for one another.
 *
 * Seed a throwaway SQLite with an approved Administrator (e2e@example.com /
 * password12345), serve with --no-reload, build the bundle, then:
 *   TMA_BASE_URL=http://127.0.0.1:8937 node tests/Browser/cip-document-order.mjs
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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); else console.log('  ok:', m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e));

process.on('unhandledRejection', async (err) => { console.log('STEP FAILED:', String(err).split('\n')[0]); process.exit(1); });
process.on('uncaughtException', async (err) => { console.log('STEP FAILED:', String(err).split('\n')[0]); process.exit(1); });

// ── sign in ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
if (page.url().includes('/auth/login-code')) {
  await page.waitForTimeout(900);
  const code = loginCode();
  if (!code) throw new Error(`no sign-in code in ${LOG}`);
  await page.locator('.tma-auth__otp-digit').first().click();
  await page.keyboard.type(code, { delay: 40 });
  const trust = page.locator('input[type="checkbox"]').first();
  if (await trust.count()) await trust.check().catch(() => {});
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(900);
}
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('form:has(input[name="stay"][value="yes"]) button[type="submit"]')]);
  await page.waitForTimeout(700);
}
if (page.url().includes('/auth/')) throw new Error('login failed: ' + page.url());
console.log('logged in');
await page.waitForFunction(() => !!(window.TMACipSlots && window.TMACipSlots.checklist && window.TMACipSlots.docsCard), null, { timeout: 15000 });

// The firm's order, deliberately the reverse of the priority order, with two
// documents in each band so the tie-break shows.
const person = {
  id: 7,
  documents: [
    { id: 'p1', label: 'Bank reference', uploaded: false, status: 'pending_upload', canUpload: true },
    { id: 'r1', label: 'Passport copy', uploaded: true, fileId: 11, status: 'ready_for_submission', statusLabel: 'Ready for submission', statusTone: 'success', canUpload: true },
    { id: 'a1', label: 'Birth certificate', uploaded: true, fileId: 12, status: 'application_review', statusLabel: 'Application review', statusTone: 'pending', canUpload: true },
    { id: 'u1', label: 'Police record', uploaded: true, fileId: 13, status: 'update_required', statusLabel: 'Update required', statusTone: 'danger', updateReason: 'Expired', canUpload: true },
    { id: 'p2', label: 'Medical form', uploaded: false, status: 'pending_upload', canUpload: true },
    { id: 'r2', label: 'Photo', uploaded: true, fileId: 14, status: 'ready_for_submission', statusLabel: 'Ready for submission', statusTone: 'success', canUpload: true },
    { id: 'a2', label: 'Proof of address', uploaded: true, fileId: 15, status: 'application_review', statusLabel: 'Application review', statusTone: 'pending', canUpload: true },
    { id: 'u2', label: 'Affidavit', uploaded: true, fileId: 16, status: 'update_required', statusLabel: 'Update required', statusTone: 'danger', canUpload: true },
    { id: 'f1', label: 'Old scan', uploaded: true, fileId: 17, status: '', canUpload: true },
  ],
};
// f1 (filed, no decision yet) sits in the Application review band, after a2 by the firm's order.
const WANT = ['u1', 'u2', 'a1', 'a2', 'f1', 'r1', 'r2', 'p1', 'p2'];

const result = await page.evaluate((p) => {
  const ordered = window.TMACipSlots.orderDocs(p.documents).map((d) => d.id);
  const host = document.createElement('div');
  host.innerHTML = window.TMACipSlots.checklist(p, { phase: 'pre_approval' });
  const rows = [...host.querySelectorAll('.tma-dash__clients-checklist-row')];
  const checklist = rows.map((r) => r.getAttribute('data-key'));
  const statuses = rows.map((r) => (r.querySelector('.tma-portal-status') || {}).textContent || 'Pending upload');
  host.innerHTML = window.TMACipSlots.docsCard(p, { phase: 'post_approval' }, {});
  const card = [...host.querySelectorAll('[data-cip-slot-drop]')].map((el) => el.getAttribute('data-cip-slot-drop'));
  return { ordered, checklist, statuses, card, untouched: p.documents.map((d) => d.id) };
}, person);

check(result.ordered.join(',') === WANT.join(','), `the order is Update required, Application review, Ready for submission, Pending upload (${result.ordered.join(' ')})`);
check(result.checklist.join(',') === WANT.map((id) => 'doc-' + id).join(','), 'the detail checklist lists them in that order, each row keyed');
check(result.statuses.slice(0, 2).every((s) => s === 'Update required') && result.statuses.slice(-2).every((s) => s === 'Pending upload'), `the chips read top to bottom (${result.statuses.join(' | ')})`);
check(result.card.join(',') === WANT.join(','), 'the post-approval Edit card follows the same order');
check(result.ordered.indexOf('u1') < result.ordered.indexOf('u2') && result.ordered.indexOf('p1') < result.ordered.indexOf('p2') && result.ordered.indexOf('r1') < result.ordered.indexOf('r2'), 'within a band the firm\'s own order holds');
check(result.ordered.indexOf('f1') > result.ordered.indexOf('a1') && result.ordered.indexOf('f1') < result.ordered.indexOf('r1'), 'a filed document with no decision sits with those awaiting one');
check(result.untouched.join(',') === person.documents.map((d) => d.id).join(','), 'the sort is a view: the person\'s own list is not reordered');

if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)); }
await browser.close();
if (fail.length || errors.length) {
  console.log('\nFAILED:');
  fail.forEach((f) => console.log('  -', f));
  process.exit(1);
}
console.log('\nall checks passed');
