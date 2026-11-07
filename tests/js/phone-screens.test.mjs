/**
 * Screens a section opens on a phone, as history entries.
 *
 * Run: node tests/js/phone-screens.test.mjs
 *
 * Back (the header's button, the iPhone's edge swipe, Android's back) has to
 * step back exactly one screen, a list that closes itself must not leave an
 * entry that a later swipe lands on with nothing to close, forward must
 * reopen, and another page of the portal must still be the route's business.
 * A browser's history is modelled here: pushState is immediate, back and
 * forward land later as a popstate, the way WebKit delivers them.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, 'public/js/phone-screens.js'), 'utf8');

function browser(path) {
  const entries = [{ state: null, path }];
  let index = 0;
  const location = { pathname: path, get href() { return 'https://portal.test' + this.pathname; } };
  const pending = [];
  const routeChanges = [];

  function go(delta) {
    pending.push(() => {
      const next = index + delta;
      if (next < 0 || next >= entries.length) return;
      index = next;
      location.pathname = entries[index].path;
      // dashboard.js's popstate: screens answer first.
      if (!window.TMAPhoneScreens.handlePop({ state: entries[index].state })) routeChanges.push(location.pathname);
    });
  }

  const history = {
    get state() { return entries[index].state; },
    pushState(state, _title, url) {
      entries.length = index + 1;
      const p = url ? new URL(url, 'https://portal.test').pathname : location.pathname;
      entries.push({ state, path: p });
      index += 1;
      location.pathname = p;
    },
    back() { go(-1); },
    forward() { go(1); },
  };
  const window = { history, location };
  window.window = window;
  runInContext(source, createContext(window));
  return {
    screens: window.TMAPhoneScreens,
    history,
    routeChanges,
    /* Deliver every queued back/forward, as the event loop would. */
    settle() { while (pending.length) pending.shift()(); },
    /* dashboard.js going to another page of the portal. */
    route(p) { history.pushState({ navId: p }, '', p); window.TMAPhoneScreens.left(); },
  };
}

function ui() {
  const shown = [];
  return {
    shown,
    screen(name, b) {
      shown.push(name);
      return b.screens.open(
        () => { assert.equal(shown.at(-1), name, 'closes the top screen'); shown.pop(); },
        () => { shown.push(name); },
      );
    },
  };
}

// Back steps one screen at a time, and the section stays the page.
{
  const b = browser('/account-settings');
  const u = ui();
  u.screen('Notifications', b);
  u.screen('Notification sound', b);
  assert.equal(b.history.state.tmaScreen, 2);

  assert.equal(b.screens.back(), true, 'the header back is history');
  b.settle();
  assert.deepEqual(u.shown, ['Notifications']);

  b.history.back(); // the edge swipe
  b.settle();
  assert.deepEqual(u.shown, []);
  assert.equal(b.screens.depth(), 0);
  assert.deepEqual(b.routeChanges, [], 'never treated as leaving the page');
  assert.equal(b.screens.back(), false, 'nothing open: the caller closes things itself');
}

// Swiping forward reopens what back closed.
{
  const b = browser('/account-settings');
  const u = ui();
  u.screen('Notifications', b);
  u.screen('Notification sound', b);
  b.history.back();
  b.settle();
  b.history.forward();
  b.settle();
  assert.deepEqual(u.shown, ['Notifications', 'Notification sound']);
}

// A list that closes itself (an option chosen) takes its entry with it, so
// the next swipe goes to the menu instead of landing on nothing.
{
  const b = browser('/account-settings');
  const u = ui();
  u.screen('Notifications', b);
  const list = u.screen('Toast position', b);
  u.shown.pop();
  b.screens.closed(list);
  b.settle();
  assert.equal(b.history.state.tmaScreen, 1);
  b.history.back();
  b.settle();
  assert.deepEqual(u.shown, []);
}

// A screen opened before that pop lands waits for it, then gets its entry.
{
  const b = browser('/account-settings');
  const u = ui();
  u.screen('Notifications', b);
  const list = u.screen('Toast position', b);
  u.shown.pop();
  b.screens.closed(list);
  u.screen('Display duration', b);
  b.settle();
  assert.equal(b.history.state.tmaScreen, 2);
  b.history.back();
  b.settle();
  assert.deepEqual(u.shown, ['Notifications']);
}

// Another page of the portal is the route's: back from Home to the section
// is a route change, and the screen left open there closes on the next back.
{
  const b = browser('/account-settings');
  const u = ui();
  u.screen('Notifications', b);
  b.route('/');
  b.history.back();
  b.settle();
  assert.deepEqual(b.routeChanges, ['/account-settings']);
  assert.deepEqual(u.shown, ['Notifications'], 'still open, as the section was left');
  b.history.back();
  b.settle();
  assert.deepEqual(u.shown, []);
  assert.deepEqual(b.routeChanges, ['/account-settings'], 'closing it is not another route change');
}

// Back with no screens open is the route's own.
{
  const b = browser('/account-settings');
  b.route('/');
  b.history.back();
  b.settle();
  assert.deepEqual(b.routeChanges, ['/account-settings']);
}

console.log('phone-screens: ok');
