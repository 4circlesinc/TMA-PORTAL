import { chromium } from 'playwright';

/*
 * Every picture the portal asks for, and whether it arrives.
 *
 * Three different things all read as "a missing icon" on screen and none of
 * them shows up in a grep:
 *
 *   1. An <img> whose file 404s — the alt text or a broken-image glyph.
 *   2. A masked span with no mask-image. The portal tints icons by masking a
 *      span rather than drawing an <img>, because an <img> of a Phosphor icon
 *      is always black; a mask that fails leaves a coloured rectangle or
 *      nothing at all, and the element is still there so nothing errors.
 *   3. A CSS background-image that 404s. Same silence.
 *
 * So this walks the portal's screens with the network watched, and reports
 * per screen: requests that answered 404, images that decoded to nothing, and
 * icon-shaped elements with no art on them.
 *
 * It asserts nothing about *which* icons should exist — that is the point. It
 * is a sweep, run when somebody says "there are icons missing", and its output
 * is the list to fix.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

const SCREENS = [
  '/', '/overview', '/clients', '/cbi', '/email', '/social/messages',
  '/social/feed', '/calendar', '/signatures', '/folders', '/workflows',
  '/people', '/users', '/account-settings', '/projects',
  '/clients/companies/new', '/clients/new', '/users/new',
  '/people/contacts', '/people/teams', '/people/directory',
  '/storage-usage', '/notifications', '/activity', '/getting-started',
  '/design/mail', '/design/auth', '/components', '/design-system',
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

/* Every asset the portal failed to fetch, wherever it was asked for. */
const notFound = new Map();
page.on('response', res => {
  if (res.status() !== 404) return;
  const url = new URL(res.url());
  if (url.origin !== new URL(BASE).origin) return;
  if (!/\.(svg|png|jpe?g|gif|webp|ico|woff2?)$/i.test(url.pathname)) return;
  notFound.set(url.pathname, (notFound.get(url.pathname) || 0) + 1);
});

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
await page.waitForTimeout(700);
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
    page.click('text=Yes, stay signed in'),
  ]);
  await page.waitForTimeout(700);
}

/*
 * What is on screen and has no art on it.
 *
 * Only visible elements: the shell keeps every page in the DOM, so counting
 * hidden views would report the whole portal's icons as broken on every
 * screen. An element with no box is not something a reader can miss.
 */
const audit = () => page.evaluate(() => {
  const seen = el => {
    const r = el.getBoundingClientRect();

    return r.width > 0 && r.height > 0;
  };

  const brokenImages = [...document.images]
    .filter(img => seen(img) && img.complete && img.naturalWidth === 0)
    .map(img => img.getAttribute('src') || '(no src)');

  const blankMasks = [];
  const blankBackgrounds = [];
  document.querySelectorAll('span, i, div').forEach(el => {
    if (!seen(el)) return;
    const cs = getComputedStyle(el);
    const mask = cs.maskImage || cs.webkitMaskImage;
    const looksIcon = /icon|glyph|logo|mark|avatar/i.test(el.className || '');

    // A class that says "icon" with nothing painting it. Masked spans are how
    // the portal tints icons, so an empty one is an icon that is not there.
    if (looksIcon && (!mask || mask === 'none') && cs.backgroundImage === 'none'
      && !el.querySelector('img, svg') && !el.textContent.trim()) {
      blankMasks.push((el.className || '').toString().slice(0, 80));
    }
    if (cs.backgroundImage && cs.backgroundImage.includes('url(') && el.dataset.bgBroken) {
      blankBackgrounds.push(el.className);
    }
  });

  return { brokenImages, blankMasks, blankBackgrounds };
});

const report = [];
for (const path of SCREENS) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const found = await audit();
  const broken = [...new Set(found.brokenImages)];
  const blank = [...new Set(found.blankMasks)];
  if (broken.length || blank.length) report.push({ path, broken, blank });
  console.log(`${path.padEnd(20)} broken:${broken.length}  blank:${blank.length}`);
}

console.log('\n── 404s ──');
if (!notFound.size) console.log('  none');
[...notFound.entries()].sort().forEach(([p, n]) => console.log(`  ${p}  ×${n}`));

console.log('\n── detail ──');
report.forEach(r => {
  console.log(`\n${r.path}`);
  r.broken.slice(0, 20).forEach(s => console.log('  broken img:', s));
  r.blank.slice(0, 20).forEach(s => console.log('  blank icon:', s));
});

await browser.close();
