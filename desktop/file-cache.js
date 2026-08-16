'use strict';

/*
 * File bytes, kept on this machine — the offline plan's phase 6.
 *
 * The record replica (portal JS) holds every file's ROW: name, folder,
 * review status. This holds the bytes behind a row, so a document somebody
 * has looked at opens again with no network — and it lives HERE, in the
 * protocol handler's world, because the viewer never fetches: it renders
 * `<img src>`, `<iframe src>`, `<video src>`, and the only place every one
 * of those loads passes through is `protocol.handle`. Caching at that seam
 * needs no portal change at all, and it keeps the bytes off browser disks,
 * which is the firm's standing decision.
 *
 * NETWORK FIRST, ALWAYS
 *
 * A file's URL does not change when its content does — a new version is new
 * bytes behind the same path — so cache-first would show yesterday's
 * contract to someone who watched a colleague upload today's. The cache is
 * only consulted when the network could NOT answer (the 502 the handler
 * makes of a dead connection). A real answer, including a 404, stands.
 *
 * BOUNDED, AND EVICTED BY DISUSE
 *
 * A budget in bytes, least-recently-USED evicted first — used meaning
 * served or stored, so the documents somebody keeps opening stay while the
 * one-off preview from March goes. The default is deliberately conservative;
 * the firm's real figure is an open question in docs/offline-plan.md and one
 * number to change here when it is answered.
 *
 * The index (path → size, lastUsed, contentType) is one JSON file beside the
 * blobs. Written after every mutation: this cache's loss costs a re-download,
 * so crash-safety niceties would buy nothing worth their complexity. If the
 * index and the blobs disagree — a crash between writes — the blob without an
 * index entry is invisible and swept on the next eviction pass.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/* 512 MB. See the note above — a placeholder for the firm's answer. */
const DEFAULT_BUDGET = 512 * 1024 * 1024;

/*
 * What is worth keeping: the bytes behind the viewer. Thumbs ride along —
 * they are small, numerous, and exactly what makes an offline folder look
 * like a folder rather than a list of grey squares. Avatars too, for the
 * same reason at the other scale: a boot screen with every face grey is a
 * boot screen that looks half-loaded whatever else painted.
 */
const CACHEABLE = /^\/(?:portal\/files\/files\/[a-f0-9-]{36}\/(?:preview|thumb)|media\/avatars\/[a-f0-9-]{36}\.jpg)$/;

let dir = null;

let budget = DEFAULT_BUDGET;

/** path -> { file, size, lastUsed, contentType } */
let index = null;

function configure(options) {
  dir = options.dir;
  if (Number.isFinite(options.budgetBytes) && options.budgetBytes > 0) {
    budget = options.budgetBytes;
  }
  index = null;
}

function indexFile() { return path.join(dir, 'index.json'); }

function blobFile(name) { return path.join(dir, name); }

function loadIndex() {
  if (index) return index;
  try {
    index = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    if (!index || typeof index !== 'object') index = {};
  } catch {
    index = {};
  }

  return index;
}

function saveIndex() {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile(), JSON.stringify(index));
  } catch { /* a cache that cannot persist its index is just smaller */ }
}

function cacheable(url, method) {
  return method === 'GET' && !!dir && CACHEABLE.test(url.pathname);
}

/** Keep one response's bytes. */
function store(pathname, buffer, contentType) {
  if (!dir || !buffer || !buffer.length) return;
  // A single file larger than the whole budget would evict everything and
  // still not fit; it is simply not cacheable at this budget.
  if (buffer.length > budget) return;

  const entries = loadIndex();
  const name = crypto.createHash('sha256').update(pathname).digest('hex');

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(blobFile(name), buffer);
  } catch {
    return; // full disk — the cache just declines to grow
  }

  entries[pathname] = {
    file: name,
    size: buffer.length,
    lastUsed: Date.now(),
    contentType: contentType || 'application/octet-stream',
  };

  evictOver(budget);
  saveIndex();
}

/** The kept bytes for a path, or null. Serving counts as use. */
function serve(pathname) {
  if (!dir) return null;

  const entries = loadIndex();
  const entry = entries[pathname];
  if (!entry) return null;

  let body;
  try {
    body = fs.readFileSync(blobFile(entry.file));
  } catch {
    // The blob went missing under us — drop the lie from the index.
    delete entries[pathname];
    saveIndex();

    return null;
  }

  entry.lastUsed = Date.now();
  saveIndex();

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': entry.contentType,
      'content-length': String(body.length),
      // Kept bytes are possibly stale bytes — the renderer must re-ask next
      // time, so a restored connection shows the server's copy, not ours.
      'cache-control': 'no-store',
      'x-tma-file-cache': 'offline',
    },
  });
}

/**
 * Shrink to the limit, least-recently-used first — and sweep any blob the
 * index does not know, which is how a crash between blob and index write
 * heals instead of leaking disk for ever.
 */
function evictOver(limit) {
  const entries = loadIndex();

  const known = new Set(Object.values(entries).map((e) => e.file));
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n !== 'index.json');
  } catch { /* nothing on disk yet */ }
  names.forEach((name) => {
    if (!known.has(name)) {
      try { fs.rmSync(blobFile(name), { force: true }); } catch { /* next sweep */ }
    }
  });

  let total = Object.values(entries).reduce((sum, e) => sum + e.size, 0);
  if (total <= limit) return;

  const oldestFirst = Object.keys(entries)
    .sort((a, b) => entries[a].lastUsed - entries[b].lastUsed);

  for (const key of oldestFirst) {
    if (total <= limit) break;
    try { fs.rmSync(blobFile(entries[key].file), { force: true }); } catch { /* gone is gone */ }
    total -= entries[key].size;
    delete entries[key];
  }
}

/**
 * Everything, gone. What an account change runs: the bytes were fetched with
 * one person's session, and the next person to sign in on this machine has
 * their own right — or none — to every one of them.
 */
function clear() {
  if (!dir) return;
  index = {};
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* a locked file loses the race; the next clear gets it */ }
}

function stats() {
  const entries = loadIndex();
  const values = Object.values(entries);

  return {
    count: values.length,
    bytes: values.reduce((sum, e) => sum + e.size, 0),
    budget: budget,
  };
}

module.exports = { configure, cacheable, store, serve, clear, stats, CACHEABLE, DEFAULT_BUDGET };
