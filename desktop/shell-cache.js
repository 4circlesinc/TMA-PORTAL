'use strict';

/*
 * The last shell the portal served, kept, so the next launch paints it
 * before the network has said a word.
 *
 * This is the first structural piece of turning the app from "a window that
 * navigates to a website" into "a client that talks to an API". A cold start
 * used to be: splash → ask the server for the page → assemble it on screen.
 * With this, the page the server sent last time is on disk, and a navigation
 * is answered from there in under a millisecond — the window opens ON the
 * portal, and the network's only remaining job is data.
 *
 * WHAT EXACTLY IS CACHED
 *
 * The served HTML of the SPA shell — the one document behind every portal
 * page (see `resources/views/pages/dashboard.html`; it announces itself with
 * a `tma-shell:` comment, which is what capture keys on). Not a copy we
 * build: the byte-for-byte body the portal actually sent, with the
 * capabilities PortalShell inlined for this account. That matters because the
 * sidebar prunes itself from those inlined capabilities before first paint —
 * a hand-built shell without them would flash admin rows at a client.
 *
 * WHY IT IS SAFE TO SERVE
 *
 * Three gates, all of them checked at serve time:
 *
 *   1. A session cookie must exist. A signed-out visitor gets the network,
 *      which will bounce them to the sign-in page the way it always has.
 *   2. The path's first segment must have served the shell before. `/auth/*`,
 *      `/r/*`, an invite link — none ever carried the marker, so none is
 *      ever answered from here.
 *   3. The deploy must not have moved. The cache is stamped with the build it
 *      was captured under; when verification learns the portal has deployed,
 *      the copy is dropped and — if it was already on screen — the window is
 *      reloaded from the network. A shell one deploy old references asset
 *      bundles the new deploy may no longer serve, which is a broken page,
 *      not a slow one. Verification is not a launch-time question: the app
 *      stays open for days and the portal deploys under it, so asset-cache.js
 *      asks again on every navigation and on a timer. The first navigation
 *      itself is captured before that name exists — the SPA will not make
 *      another — and stamped the moment the deploy is known.
 *
 * A reload cannot be a fourth gate, though it is the gesture somebody makes
 * when a page looks wrong. Chromium adds `Cache-Control: max-age=0` downstream
 * of `protocol.handle`, so a reload and a first load arrive here byte for byte
 * identical — measured, not assumed. What stands in for it is asset-cache
 * holding a navigation for a fresh build check before asking us anything.
 *
 * And two watchdogs on `/me`, because the shell embeds who the reader is:
 * a 401/419 means the session died since the cookie check (served shell,
 * nobody signed in — reload to the real front door), and an id that differs
 * from the one the shell was captured for means somebody signed in as
 * somebody else (their capabilities are not this shell's — drop and reload).
 *
 * The cache lives in userData, which is the desktop's own disk — the firm's
 * "no client data on a browser's disk" decision explicitly carves out the
 * installed app (see public/js/portal-store.js for the reasoning).
 */

const { app, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/* The shell announces itself in its first kilobyte. */
const MARKER = 'tma-shell:';

/* How much of a body to search for the marker. It sits near the top; reading
   the whole document to find it would mean buffering every page twice. */
const SNIFF_BYTES = 4096;

let dir = null;

/* The account /me last reported, stamped onto captures. */
let accountId = null;

/* The deploy the portal reported, once verification has run. */
let remoteBuild = null;

/* Whether the document on screen came from here. The watchdogs only bite
   when the thing they guard is what the reader is looking at, and a shell the
   network served a moment ago needs no reload to become correct. */
let servingFromCache = false;

/*
 * First segments that are never the SPA shell, and must not be answered with
 * it even when the network is gone. Sign-in, the public file-request link and
 * the invite link are all their own documents; wrapping portal chrome around
 * one would be worse than the offline notice.
 */
const NEVER_SHELL = ['auth', 'r', 'invite', 's', 'sign-in', 'sign-up', 'design', 'up'];

/* Down after an auth or deploy mismatch, until a healthy /me proves the
   world makes sense again. */
let suspended = false;

let callbacks = { stale: null };

function cacheDir() {
  if (!dir) dir = path.join(app.getPath('userData'), 'shell-cache');

  return dir;
}

function htmlFile() { return path.join(cacheDir(), 'shell.html'); }

function metaFile() { return path.join(cacheDir(), 'meta.json'); }

function readMeta() {
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(), 'utf8'));

    return meta && Array.isArray(meta.segments) ? meta : null;
  } catch {
    return null;
  }
}

function invalidate() {
  try { fs.rmSync(htmlFile(), { force: true }); } catch { /* nothing to drop */ }
  try { fs.rmSync(metaFile(), { force: true }); } catch { /* as above */ }
}

/** Wire what happens when a served shell turns out to be wrong. */
function on(handlers) {
  callbacks = { ...callbacks, ...handlers };
}

/*
 * A mismatch discovered after the fact. Everything lands here: a deploy that
 * moved, a session that died, an account that changed. The response is the
 * same — stop serving from disk, drop the copy, and if the wrong shell is on
 * screen, tell the app so it can reload from the network.
 */
function goStale(reason) {
  suspended = true;
  invalidate();
  if (servingFromCache && callbacks.stale) callbacks.stale(reason);
}

/** Is this request the window navigating to a page? (Subresources ask for
    css/js/images; only a navigation leads its Accept with text/html.) */
function isNavigation(request) {
  return request.method === 'GET'
    && (request.headers.get('accept') || '').startsWith('text/html');
}

function firstSegment(pathname) {
  const m = String(pathname).match(/^\/([^/]+)/);

  return m ? m[1] : '';
}

/**
 * The cached shell for this navigation, or null for "use the network".
 *
 * @param {URL} url
 * @param {Request} request
 * @returns {Promise<Response|null>}
 */
/**
 * @param {{offline?: boolean}} [opts]
 *   `offline` is asked only after the network has already failed to answer.
 *   It relaxes the "this segment has served the shell before" gate, because
 *   that gate is about not guessing while a perfectly good network is there
 *   to tell us — and with no network there is nothing to guess against. The
 *   shell is one document for every SPA route, so serving the kept copy for a
 *   portal path we happen not to have captured lets the router take over
 *   client-side, which is the whole point of having kept it.
 *
 *   The prefixes that never carried the shell are still refused, offline or
 *   not: /auth/*, /r/* and the like are not the SPA, and answering them with
 *   it would put a portal chrome around a sign-in or an invite link.
 */
async function maybeServe(url, request, opts) {
  if (suspended || !isNavigation(request)) return null;

  const meta = readMeta();
  if (!meta) return null;

  // The root is the shell's own page; anything else must have earned it —
  // unless there is no network to earn it from.
  if (url.pathname !== '/' && !meta.segments.includes(firstSegment(url.pathname))) {
    if (!(opts && opts.offline) || NEVER_SHELL.includes(firstSegment(url.pathname))) return null;
  }

  // A deploy known to differ: the copy is dead, not merely suspect.
  if (remoteBuild && meta.build && meta.build !== remoteBuild) {
    invalidate();

    return null;
  }

  // Captured before verification named the deploy. Online, after we know
  // which deploy this is, the network can still tell us whether the copy
  // is current. Offline — or before that name has arrived — this copy is
  // the portal, and refusing it is the "You're offline" screen.
  if (remoteBuild && !meta.build && !(opts && opts.offline)) return null;

  // No session, no shell — the network will route a stranger to sign-in.
  if (!(await hasSessionCookie(url.origin))) return null;

  let html;
  try {
    html = fs.readFileSync(htmlFile());
  } catch {
    return null;
  }

  servingFromCache = true;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Our copy, not one the renderer should keep a second copy of.
      'cache-control': 'no-store',
    },
  });
}

async function hasSessionCookie(origin) {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: origin });

    return cookies.some((c) => c.name.includes('session') || c.name.startsWith('remember'));
  } catch {
    return false;
  }
}

/**
 * Watch what the network answered, and learn from it.
 *
 * Called with every response the handler passes through. Two things are worth
 * keeping: a navigation that carried the shell marker (that is tomorrow's
 * instant boot), and `/me` (that is the watchdog). Everything else flows
 * through untouched. The response is cloned before reading so the renderer
 * gets the stream it was always getting.
 */
function observe(url, request, response) {
  if (!response || typeof response.clone !== 'function') return response;

  try {
    if (url.pathname === '/me' && request.method === 'GET') {
      watchMe(response.clone());
    } else if (isNavigation(request) && response.ok) {
      captureIfShell(url, response.clone());
    }
  } catch { /* observation must never break the page it observes */ }

  return response;
}

async function captureIfShell(url, copy) {
  const type = copy.headers.get('content-type') || '';
  if (!type.includes('text/html')) return;

  /*
   * Keep the document even before verification has named the deploy.
   *
   * The first navigation is the only full document load the SPA usually
   * makes, and it races verification: install() does not wait, and after
   * paint the router is pushState. Skipping this capture used to mean the
   * shell was never on disk at all — quit, go offline, reopen, and the
   * app had nothing to paint but the offline notice. An unstamped copy
   * is stamped the moment noteBuild learns the deploy; until then it is
   * served only when there is no network to ask (see maybeServe).
   */
  const html = Buffer.from(await copy.arrayBuffer());
  if (!html.subarray(0, SNIFF_BYTES).toString('utf8').includes(MARKER)) return;

  const meta = readMeta() || { segments: [] };
  const segment = firstSegment(url.pathname);

  // The network just served a shell, so that is what the window is about to
  // paint — whatever happens to the copy on disk from here, the reader is not
  // looking at it, and a mismatch found in a moment costs them no reload.
  servingFromCache = false;

  fs.mkdirSync(cacheDir(), { recursive: true });
  fs.writeFileSync(htmlFile(), html);
  fs.writeFileSync(metaFile(), JSON.stringify({
    build: remoteBuild || meta.build || null,
    account: accountId ?? meta.account ?? null,
    segments: [...new Set([...meta.segments, segment])].filter(Boolean),
    savedAt: new Date().toISOString(),
  }));

  // A healthy capture is proof the world is consistent again.
  suspended = false;
}

async function watchMe(copy) {
  if (copy.status === 401 || copy.status === 419) {
    // The cookie existed but the session behind it did not. The shell on
    // screen belongs to nobody; the network knows the way to sign-in.
    if (servingFromCache) goStale('signed-out');

    return;
  }

  if (!copy.ok) return;

  try {
    const me = await copy.json();
    if (!me || me.id == null) return;

    const id = String(me.id);
    const meta = readMeta();

    // The shell was captured for somebody else: its inlined capabilities are
    // theirs, and the sidebar pruned itself from them before first paint.
    if (meta && meta.account && meta.account !== id && servingFromCache) {
      accountId = id;
      goStale('account-changed');

      return;
    }

    accountId = id;
    suspended = false;
  } catch { /* a /me that is not JSON is the server's problem, not ours */ }
}

/**
 * Verification's report of which deploy the portal is running.
 *
 * The moment it is known, a cached shell from another deploy is dropped —
 * and reloaded out from under the reader if it is already on screen, because
 * the assets it references may no longer exist to fetch.
 */
function noteBuild(build) {
  if (!build) return;
  remoteBuild = String(build);

  const meta = readMeta();
  if (!meta) return;

  if (!meta.build) {
    try {
      fs.writeFileSync(metaFile(), JSON.stringify({ ...meta, build: remoteBuild }));
    } catch { /* the next noteBuild retries; maybeServe already knows this case */ }

    return;
  }

  if (meta.build !== remoteBuild) goStale('deploy-changed');
}

/** Test seam: point the cache at a scratch directory and reset state. */
function _reset(overrideDir) {
  dir = overrideDir || null;
  accountId = null;
  remoteBuild = null;
  servingFromCache = false;
  suspended = false;
  callbacks = { stale: null };
}

module.exports = {
  maybeServe,
  observe,
  noteBuild,
  on,
  invalidate,
  readMeta,
  isNavigation,
  firstSegment,
  MARKER,
  _reset,
};
