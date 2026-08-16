/*
 * The document-byte cache: that it keeps, that it bounds, and that it lets go
 * in the right order.
 *
 * The budget is the test worth having. A cache that grows without limit is a
 * disk that fills in a month; one that evicts the wrong entries is a cache
 * that throws away the contract somebody opens every day to keep the preview
 * they glanced at in March. So most of this sets a tiny budget and watches
 * which entries survive.
 *
 * Run with: npm run test:file-cache
 */
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileCache = require('./file-cache');

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

setTimeout(() => { console.log('\nFAILED — timed out'); app.exit(1); }, 30000).unref();

const scratch = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tma-file-cache-'));
  fileCache.configure({ dir, budgetBytes: 1024 });

  return dir;
};

const P = (n) => `/portal/files/files/aaaaaaaa-bbbb-cccc-dddd-00000000000${n}/preview`;

const bytes = (n, fill) => Buffer.alloc(n, fill);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  /* ── what is cacheable ──────────────────────────────────────────── */

  // Configured first: an unconfigured cache declines everything, which is
  // the right answer in production and the wrong baseline for these checks.
  scratch();
  const url = (p) => new URL(p, 'https://portal.test');
  check('a preview is cacheable', fileCache.cacheable(url(P(1)), 'GET'), true);
  check('a thumb is too',
    fileCache.cacheable(url('/portal/files/files/aaaaaaaa-bbbb-cccc-dddd-000000000001/thumb'), 'GET'), true);
  check('a download is not — it is a save, not a view',
    fileCache.cacheable(url('/portal/files/files/aaaaaaaa-bbbb-cccc-dddd-000000000001/download'), 'GET'), false);
  check('a listing is not', fileCache.cacheable(url('/portal/files/?section=all'), 'GET'), false);
  check('nor is any write', fileCache.cacheable(url(P(1)), 'POST'), false);

  /* ── keep and serve ─────────────────────────────────────────────── */

  scratch();
  fileCache.store(P(1), bytes(100, 1), 'application/pdf');
  const served = fileCache.serve(P(1));
  check('kept bytes serve back', !!served, true);
  check('with their type', served.headers.get('content-type'), 'application/pdf');
  check('and told not to be double-cached', served.headers.get('cache-control'), 'no-store');
  check('a path never kept serves nothing', fileCache.serve(P(9)), null);
  check('the ledger agrees', fileCache.stats(), { count: 1, bytes: 100, budget: 1024 });

  /* ── the budget, and who gets evicted ───────────────────────────── */

  scratch();
  fileCache.store(P(1), bytes(400, 1), 'a/a');
  await sleep(20);
  fileCache.store(P(2), bytes(400, 2), 'b/b');
  await sleep(20);
  // Touching the OLDEST is what must save it: used, not merely old.
  fileCache.serve(P(1));
  await sleep(20);
  fileCache.store(P(3), bytes(400, 3), 'c/c');

  check('the budget holds', fileCache.stats().bytes <= 1024, true);
  check('the least-recently-USED went', fileCache.serve(P(2)), null);
  check('the touched one stayed', !!fileCache.serve(P(1)), true);
  check('and so did the newcomer', !!fileCache.serve(P(3)), true);

  /* ── the pathological sizes ─────────────────────────────────────── */

  scratch();
  fileCache.store(P(1), bytes(2048, 1), 'a/a');
  check('a file larger than the whole budget is declined, not churned',
    fileCache.stats().count, 0);

  /* ── a crash between blob and index ─────────────────────────────── */

  const dir = scratch();
  fileCache.store(P(1), bytes(100, 1), 'a/a');
  // A blob the index never learned about — the torn-write leftover.
  fs.writeFileSync(path.join(dir, 'orphaned-blob'), bytes(50, 9));
  fileCache.store(P(2), bytes(100, 2), 'b/b');
  check('an orphaned blob is swept on the next write',
    fs.existsSync(path.join(dir, 'orphaned-blob')), false);
  check('without touching the real entries', !!fileCache.serve(P(1)), true);

  /* ── an index pointing at nothing ───────────────────────────────── */

  const dir2 = scratch();
  fileCache.store(P(1), bytes(100, 1), 'a/a');
  fs.readdirSync(dir2).filter((n) => n !== 'index.json')
    .forEach((n) => fs.rmSync(path.join(dir2, n)));
  check('a missing blob answers nothing rather than throwing', fileCache.serve(P(1)), null);
  check('and the lie leaves the ledger', fileCache.stats().count, 0);

  /* ── clearing ───────────────────────────────────────────────────── */

  const dir3 = scratch();
  fileCache.store(P(1), bytes(100, 1), 'a/a');
  fileCache.clear();
  check('clear leaves nothing on disk', fs.existsSync(dir3), false);
  check('and nothing to serve', fileCache.serve(P(1)), null);
  // The account that signs in next starts a fresh cache in the same place.
  fileCache.store(P(2), bytes(10, 2), 'b/b');
  check('and the cache works again after', !!fileCache.serve(P(2)), true);

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  app.exit(2);
});
