/*
 * The bottom-right sync cards (public/js/sync-toasts.js), driven for the
 * mailbox — the service that had no card at all once its first import was
 * over, because /me/sync-status answered 'done' from then on.
 *
 * No server and no login: the script is loaded into a blank page over a
 * stubbed /me/sync-status, which is the only practical way to move a queued
 * sync through queued → running → finished on cue.
 *
 *   node tests/Browser/sync-toasts.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = readFileSync(
  fileURLToPath(new URL('../../public/js/sync-toasts.js', import.meta.url)),
  'utf8',
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');

await page.evaluate(() => {
  window.__state = { email: { state: 'done', synced: 12345 } };
  window.fetch = () => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(window.__state),
  });
});

await page.addScriptTag({ content: SCRIPT });

const read = () => page.evaluate(() => {
  const el = document.querySelector('.tma-sync-toast[data-sync-key="email"]');
  if (!el) return null;
  return {
    title: el.querySelector('.tma-sync-toast__title').textContent,
    detail: el.querySelector('.tma-sync-toast__detail').textContent,
    done: el.classList.contains('tma-sync-toast--done'),
    indeterminate: el.querySelector('.tma-sync-toast__fill')
      .classList.contains('tma-sync-toast__fill--indeterminate'),
  };
});

const results = [];
const check = (label, ok, extra) => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
};

const until = async (label, predicate, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await read();
    if (predicate(last)) { check(label, true, last); return true; }
    await page.waitForTimeout(200);
  }
  check(label, false, last);
  return false;
};

// 1. Nothing syncing at load: no card.
await page.waitForTimeout(500);
check('quiet at load', (await read()) === null);

// 2. The page announces a sync it just started — card, immediately.
await page.evaluate(() => window.TMASyncToasts.watch('email'));
const first = await read();
check('card appears immediately', !!first && first.title === 'Syncing email…' && first.indeterminate, first);

// 3. Server still says 'done' (job queued, no worker has taken it yet).
await page.waitForTimeout(4000);
const held = await read();
check('held through the queue grace', !!held && held.title === 'Syncing email…' && !held.done, held);

// 4. The run starts for real.
await page.evaluate(() => { window.__state = { email: { state: 'syncing', synced: 12345, mode: 'incremental' } }; });
// Two pending-cadence polls, so the server's 'syncing' is definitely seen and
// the queue grace is released — otherwise a 'done' below is still held.
await page.waitForTimeout(5000);
await until('follows the running pass', (c) => c && c.detail === 'Checking for new mail…');

// 5. …and finishes.
await page.evaluate(() => { window.__state = { email: { state: 'done', synced: 12400 } }; });
await until('reports done', (c) => c && c.title === 'Email synced' && c.done);

// 6. …then clears itself.
await until('retires itself', (c) => c === null, 10000);

// 7. The mail page's own import panel supersedes the toast.
await page.evaluate(() => {
  const panel = document.createElement('div');
  panel.className = 'tma-mail-sync';
  document.body.appendChild(panel);
  window.TMASyncToasts.watch('email');
});
await page.waitForTimeout(1000);
check('stands down for the mail panel', (await read()) === null, await read());

console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
