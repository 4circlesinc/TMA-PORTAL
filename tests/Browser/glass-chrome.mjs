/**
 * The iPhone app's Liquid Glass bar and header: what glass-chrome.js tells it.
 *
 * On iOS 26 and later the app draws the bottom bar and the header's bubbles
 * itself, in the system's material (ios/TMAPortal/GlassChrome.swift), so they
 * follow the device's Liquid Glass look and accessibility settings. The page
 * describes them: where each sits, its buttons, icons, the open tab, counts,
 * and whether something covers it; a tap on the glass comes back as a click
 * on the page's own button. This plays the app (window.TMADesktop with
 * glassChrome and setGlassChrome, as ios/TMAPortal/preload.js sets them) over
 * the real shell and stylesheets at a phone's size, and checks:
 *
 * - the page's own bar and bubbles stop painting but keep their boxes;
 * - the bar and both bubbles are described where the page has them, with the
 *   open tab, PNG icons (symbols as such, the avatar in its own colours);
 * - a tap by key clicks the page's button, and the next message follows;
 * - counts are carried with their colours;
 * - a sheet over the bar takes it away, a clear tap-catching layer leaves it
 *   showing but inert, and the menu sliding over the header takes that away;
 * - nothing is described at desktop width, nothing happens without the app's
 *   say-so, and resend() sends every icon again.
 *
 * No portal seed required.
 *
 *   node tests/Browser/glass-chrome.mjs
 *   TMA_BROWSER=webkit node tests/Browser/glass-chrome.mjs
 */
import { chromium, webkit } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = join(ROOT, 'public');
const SHELL = readFileSync(join(ROOT, 'resources/views/pages/dashboard.html'), 'utf8');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const ME = { id: 1, name: 'Bruce Wayne', firstName: 'Bruce', email: 'bruce@wayne.test', accountType: 'Administrator', status: 'approved', preferences: {}, desktopNotifications: { enabled: false }, permissions: [], pages: [] };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = join(PUBLIC, decodeURIComponent(url.pathname));
  if (file.startsWith(PUBLIC) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }
  if (!extname(url.pathname) && (req.headers.accept || '').includes('text/html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(SHELL);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(url.pathname === '/me' ? JSON.stringify(ME) : '{}');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

const engine = process.env.TMA_BROWSER === 'webkit' ? webkit : chromium;
let browser;
try {
  browser = await engine.launch();
} catch (e) {
  if (engine !== chromium) throw e;
  browser = await chromium.launch({ channel: 'chrome' });
}

/** The app's side of the bridge: every message kept, parsed. */
function host(glass) {
  return `
    window.__glass = [];
    window.TMADesktop = {
      isDesktop: true, isIOS: true, platform: 'ios', store: 'app-store', pushEnabled: false,
      playTone: function () { return true; }, setEdgeBack: function () {},
      glassChrome: ${glass},
      setGlassChrome: function (json) { window.__glass.push(JSON.parse(json)); }
    };`;
}

const results = [];
function check(label, ok, detail) {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function phone(glass) {
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.addInitScript(host(glass));
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tma-dash__tabbar');
  await page.waitForTimeout(1500);
  return page;
}

const latest = (page) => page.evaluate(() => {
  const all = window.__glass;
  const icons = {};
  all.forEach((m) => Object.assign(icons, m.icons || {}));
  return { state: all.length ? all[all.length - 1].state : undefined, icons, count: all.length };
});
const group = (state, id) => (state && state.groups || []).find((g) => g.id === id);
/* Waits for the page's next description to satisfy a test. */
async function until(page, test, ms = 3000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await latest(page);
    if (test(last.state, last)) return last;
    await page.waitForTimeout(60);
  }
  return last;
}

try {
  const page = await phone(true);

  // The page's copies: invisible, still in place.
  const own = await page.evaluate(() => ['.tma-dash__tabbar', '.tma-dash__header-left', '.tma-dash__header-icons'].map((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { sel, opacity: getComputedStyle(el).opacity, w: r.width, h: r.height };
  }));
  check('html.tma-native-glass is set', await page.evaluate(() => document.documentElement.classList.contains('tma-native-glass')));
  own.forEach((o) => check(`${o.sel} stops painting but keeps its box`, o.opacity === '0' && o.w > 0 && o.h > 0, `opacity ${o.opacity}, ${o.w}x${o.h}`));
  // The glass carries the labels to VoiceOver; the copies would be heard twice.
  const silent = await page.evaluate(() => ['.tma-dash__tabbar', '.tma-dash__header-left', '.tma-dash__header-icons'].every((sel) => document.querySelector(sel).getAttribute('aria-hidden') === 'true'));
  check('the copies under the glass are hidden from VoiceOver', silent);

  // The description.
  let { state, icons } = await until(page, (s) => group(s, 'bar') && group(s, 'lead') && group(s, 'trail'));
  const bar = group(state, 'bar');
  const pageBar = await page.evaluate(() => { const r = document.querySelector('.tma-dash__tabbar').getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 2) / 2); });
  check('the bar is described where the page has it', bar && JSON.stringify(bar.rect) === JSON.stringify(pageBar), `${bar && bar.rect} vs ${pageBar}`);
  check('the bar is marked as the bar, shown, a capsule', bar && bar.bar === true && bar.shown === true && bar.radius >= bar.rect[3] / 2, bar && `radius ${bar.radius}`);
  const keys = bar ? bar.items.map((i) => i.key) : [];
  check('its tabs are the page\'s visible tabs', ['bar:dashboard', 'bar:messages', 'bar:profile'].every((k) => keys.includes(k)) && !keys.includes('bar:cip'), keys.join(' '));
  check('the open tab is marked', bar && bar.items.filter((i) => i.active).map((i) => i.key).join() === 'bar:dashboard');
  const drawn = (state.groups || []).flatMap((g) => g.items).filter((i) => i.icon);
  check('every icon it names was sent, as a PNG', drawn.length >= 6 && drawn.every((i) => /^data:image\/png;base64,/.test(icons[i.icon] || '')), `${drawn.length} icons`);
  const house = bar.items.find((i) => i.key === 'bar:dashboard');
  check('a tab icon is a symbol, sized as the page draws it', house && !house.original && house.iconRect[2] === 24 && house.iconRect[3] === 24, house && JSON.stringify(house.iconRect));
  const profile = bar.items.find((i) => i.key === 'bar:profile');
  check('the avatar keeps its own colours, round', profile && profile.original === true && profile.round === true);
  const trail = group(state, 'trail');
  check('the presence status comes as a coloured dot', trail && trail.items.some((i) => i.dot && /rgb/.test(i.dot.color)));
  const lead = group(state, 'lead');
  check('the logo keeps its own colours', lead && lead.items.some((i) => i.key === 'lead:header-logo' && i.original));

  // A tap by key clicks the page's button.
  const tapped = await page.evaluate(() => window.__tmaGlassChrome.tap('bar:messages'));
  ({ state } = await until(page, (s) => group(s, 'bar') && group(s, 'bar').items.some((i) => i.key === 'bar:messages' && i.active)));
  const pageActive = await page.evaluate(() => document.querySelector('.tma-dash__tab-btn--active').getAttribute('data-tab'));
  check('a tap by key opens the tab on the page', tapped === true && pageActive === 'messages', pageActive);
  check('and the next message has it open', group(state, 'bar').items.find((i) => i.active).key === 'bar:messages');
  check('an unknown key does nothing', (await page.evaluate(() => window.__tmaGlassChrome.tap('bar:nothing'))) === false);
  await page.evaluate(() => window.__tmaGlassChrome.tap('bar:dashboard'));

  // Counts, set the page's own way: seven unread, then the shell's badge sync.
  await page.evaluate(() => {
    window.TMAMessages = window.TMAMessages || {};
    window.TMAMessages.getInboxUnreadCount = () => 7;
    window.TMAMessages.getMissedCallCount = () => 0;
    document.querySelector('.tma-dash')._syncTabBarBadges();
  });
  ({ state } = await until(page, (s) => group(s, 'bar') && group(s, 'bar').items.some((i) => i.badge)));
  const badge = group(state, 'bar').items.map((i) => i.badge).find(Boolean);
  check('a count is carried with its colours', badge && badge.text === '7' && /rgb/.test(badge.background) && /rgb/.test(badge.foreground), JSON.stringify(badge));

  // Something over the bar.
  await page.evaluate(() => {
    const sheet = document.createElement('div');
    sheet.id = 'glass-test-sheet';
    sheet.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:240px;background:#fff;z-index:9999';
    document.body.appendChild(sheet);
  });
  ({ state } = await until(page, (s) => group(s, 'bar') && group(s, 'bar').shown === false));
  check('a sheet over the bar takes it away', group(state, 'bar').shown === false && group(state, 'trail').shown === true);
  await page.evaluate(() => document.getElementById('glass-test-sheet').remove());
  ({ state } = await until(page, (s) => group(s, 'bar') && group(s, 'bar').shown === true));
  check('and it comes back when the sheet goes', group(state, 'bar').shown === true && !group(state, 'bar').inert);

  await page.evaluate(() => {
    const clear = document.createElement('button');
    clear.id = 'glass-test-clear';
    clear.style.cssText = 'position:fixed;inset:0;background:transparent;border:0;z-index:9999';
    document.body.appendChild(clear);
  });
  ({ state } = await until(page, (s) => group(s, 'bar') && group(s, 'bar').inert === true));
  check('under a clear tap-catching layer it shows, inert', ['bar', 'lead', 'trail'].every((id) => group(state, id).shown && group(state, id).inert === true));
  await page.evaluate(() => document.getElementById('glass-test-clear').remove());

  await page.evaluate(() => document.querySelector('[data-action="toggle-sidebar"]').click());
  ({ state } = await until(page, (s) => group(s, 'lead') && group(s, 'lead').shown === false));
  check('the menu sliding over the header takes it away', group(state, 'lead').shown === false);

  // Search bars. The menu's is a button: glass that is tapped like one.
  const fieldGroups = (s) => (s && s.groups || []).filter((g) => g.field);
  ({ state, icons } = await until(page, (s) => fieldGroups(s).some((g) => !g.inert)));
  const menuSearch = fieldGroups(state).find((g) => !g.inert);
  check('the menu\'s search button is drawn as glass, tappable', !!menuSearch && menuSearch.items[0].key.startsWith('search:'), menuSearch && menuSearch.items[0].key);
  const menuMarks = menuSearch ? menuSearch.items[0].marks : [];
  check('with its icon and its "Search" label as marks', menuMarks.some((m) => m.tone === 'secondary' && !m.original && /\.svg/.test(m.icon)) && menuMarks.some((m) => m.icon.startsWith('t') && /^data:image\/png;base64,/.test(icons[m.icon] || '')), JSON.stringify(menuMarks.map((m) => m.icon.slice(0, 32))));
  await page.evaluate((key) => window.__tmaGlassChrome.tap(key), menuSearch.items[0].key);
  await page.waitForTimeout(500);
  check('tapping it opens the menu\'s search', await page.evaluate(() => document.querySelector('.tma-dash__sidebar').classList.contains('tma-dash__sidebar--mobile-search')));
  await page.evaluate(() => { const s = document.querySelector('.tma-dash__scrim'); if (s) s.click(); });
  await page.waitForTimeout(400);

  // A search input is the page's own field, in the glass look, never a
  // picture of it: the real input takes the tap, the caret and the keyboard.
  await page.evaluate(() => window.__tmaGlassChrome.tap('bar:messages'));
  await page.waitForSelector('.tma-dash__messages-search[data-glass="field"]');
  ({ state } = await until(page, (s) => !!s));
  const shell = await page.evaluate(() => { const el = document.querySelector('.tma-dash__messages-search'); return { mark: el.getAttribute('data-glass'), opacity: getComputedStyle(el).opacity, fill: getComputedStyle(el).backdropFilter || getComputedStyle(el).webkitBackdropFilter }; });
  check('the Messages search input is not drawn by the app', !fieldGroups(state).some((g) => g.inert));
  check('the page\'s own field shows, in the glass look', shell.mark === 'field' && shell.opacity === '1' && /blur/.test(shell.fill || ''), JSON.stringify(shell));
  // Messages re-renders through TMAMorph, which resets attributes to its markup.
  const kept = await page.evaluate(() => {
    const el = document.querySelector('.tma-dash__messages-search');
    const parent = el.parentElement;
    const fresh = parent.cloneNode(true);
    fresh.querySelectorAll('[data-glass]').forEach((n) => n.removeAttribute('data-glass'));
    window.TMAMorph.patch(parent, fresh.innerHTML);
    const after = document.querySelector('.tma-dash__messages-search');
    return { same: after === el, mark: after.getAttribute('data-glass'), opacity: getComputedStyle(after).opacity };
  });
  check('a re-render through TMAMorph keeps the mark, so the field doesn\'t flash', kept.same && kept.mark === 'field' && kept.opacity === '1', JSON.stringify(kept));

  await page.focus('.tma-dash__messages-search-input');
  await page.keyboard.type('Ada');
  // A re-render mid-word must patch the marked field, not rebuild it: a new
  // input would drop the focus and the keyboard after one letter.
  const midWord = await page.evaluate(() => {
    const input = document.activeElement;
    const parent = document.querySelector('.tma-dash__messages-search').parentElement;
    const fresh = parent.cloneNode(true);
    fresh.querySelectorAll('[data-glass]').forEach((n) => n.removeAttribute('data-glass'));
    window.TMAMorph.patch(parent, fresh.innerHTML);
    return { focused: document.activeElement === input, value: input.value, mark: input.closest('[data-glass]') && input.closest('[data-glass]').getAttribute('data-glass') };
  });
  check('a re-render while typing keeps the input, its focus and what is typed', midWord.focused && midWord.value === 'Ada' && midWord.mark === 'field', JSON.stringify(midWord));
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(300);
  const blurred = await page.evaluate(() => { const el = document.querySelector('.tma-dash__messages-search'); return { mark: el.getAttribute('data-glass'), opacity: getComputedStyle(el).opacity, value: el.querySelector('input').value }; });
  check('and stays the page\'s field on blur, showing what was typed', blurred.mark === 'field' && blurred.opacity === '1' && blurred.value === 'Ada', JSON.stringify(blurred));
  await page.evaluate(() => { const i = document.querySelector('.tma-dash__messages-search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // Which inputs count: a search box by name wears the glass; a form field
  // that only starts its placeholder with "Search" doesn't.
  await page.evaluate(() => {
    const main = document.querySelector('.tma-dash__main');
    const a = document.createElement('div');
    a.className = 'glass-test-search';
    a.style.cssText = 'position:fixed;top:300px;left:20px;width:200px;height:36px;background:#fff;border-radius:18px;z-index:5000';
    a.innerHTML = '<input placeholder="Search things" style="width:180px;margin:6px 10px;border:0;background:transparent">';
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:360px;left:20px;width:200px;height:36px;background:#fff;border-radius:8px;z-index:5000';
    b.innerHTML = '<input id="glass-test-address" placeholder="Search for an address…" style="width:180px;margin:6px 10px;border:0;background:transparent">';
    main.append(a, b);
  });
  await page.waitForSelector('.glass-test-search[data-glass="field"]');
  const marks = await page.evaluate(() => ({
    search: document.querySelector('.glass-test-search').getAttribute('data-glass'),
    address: document.querySelector('#glass-test-address').parentElement.getAttribute('data-glass'),
  }));
  check('a search box by name is a search bar', marks.search === 'field', JSON.stringify(marks));
  check('an address field is not', marks.address === null, JSON.stringify(marks));

  // Desktop width: nothing to draw, and the page's own copies are heard again.
  await page.setViewportSize({ width: 1280, height: 900 });
  ({ state } = await until(page, (s) => s === null));
  check('at desktop width nothing is described', state === null);
  check('and the page\'s copies are back within VoiceOver\'s reach', await page.evaluate(() => !document.querySelector('.tma-dash__tabbar').hasAttribute('aria-hidden') && !document.querySelector('.tma-dash__header-icons').hasAttribute('aria-hidden')));

  // resend(): every icon again.
  await page.setViewportSize({ width: 402, height: 874 });
  await until(page, (s) => !!group(s, 'bar'));
  const before = (await latest(page)).count;
  await page.evaluate(() => window.__tmaGlassChrome.resend());
  const after = await until(page, (_s, all) => all.count > before);
  const resent = await page.evaluate((n) => window.__glass.slice(n).some((m) => m.icons && Object.keys(m.icons).length >= 6), before);
  check('resend() sends every icon again', after.count > before && resent);
  await page.close();

  // Without the app's say-so: the page draws its own.
  const plain = await phone(false);
  const untouched = await plain.evaluate(() => ({
    cls: document.documentElement.classList.contains('tma-native-glass'),
    sent: window.__glass.length,
    api: typeof window.__tmaGlassChrome,
    opacity: getComputedStyle(document.querySelector('.tma-dash__tabbar')).opacity,
  }));
  check('without glassChrome the page keeps its own bar', !untouched.cls && untouched.sent === 0 && untouched.api === 'undefined' && untouched.opacity === '1', JSON.stringify(untouched));
  await plain.close();
} finally {
  await browser.close();
  server.close();
}

console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
