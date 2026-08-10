import { chromium } from 'playwright';

/*
 * The mailbox sidebar, after it was restyled to match the Feed's.
 *
 * It used to be a bare 72px icon rail sitting flush against the main menu,
 * which read as a second strip of the same rail. It is a card now — same
 * border, radius, background and row metrics as .tma-dash__feed-sidebar — with
 * collapsible Mailboxes and Labels groups.
 *
 * Most of what is checked here is *computed* style rather than markup, because
 * the bugs in this area have all been specificity bugs: a blanket width in
 * dashboard-tma-overrides.css (which loads last) and a hardcoded width in a
 * min-width media query both silently beat the sidebar's own rule, and neither
 * is visible from the rule that looks like it should win.
 *
 * See README.md for setup. Needs a staff account.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';

const log = (...a) => console.log(...a);
const failures = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();

async function signIn(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(400);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      // The choice is a hidden input plus a plain submit, not a named button.
      page.click('text=Yes, stay signed in'),
    ]);
    await page.waitForTimeout(400);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

const styleOf = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const c = getComputedStyle(el);
  return {
    width: c.width,
    radius: c.borderTopLeftRadius,
    borderWidth: c.borderTopWidth,
    background: c.backgroundColor,
    padding: c.paddingTop,
  };
}, selector);

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  step(1, 'The sidebar is a card, at its full width');
  await signIn(page);
  // Clear remembered state so the defaults are what is measured.
  await page.evaluate(() => {
    try {
      localStorage.removeItem('tma.email.sidebarCollapsed.v2');
      localStorage.removeItem('tma.email.sidebarGroups');
    } catch (e) { /* ignore */ }
  });
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);

  const sidebar = await styleOf(page, '.tma-dash__email-sidebar');
  check(!!sidebar, 'the sidebar renders');
  // 232px is the Feed's sidebar width. Anything else means a later stylesheet
  // is winning — see the class comment.
  check(sidebar.width === '232px', `it is 232px wide, like the Feed's (got ${sidebar && sidebar.width})`);
  check(sidebar.radius === '16px', 'it has the card radius');
  check(sidebar.borderWidth === '1px', 'it has the card border');

  step(2, 'It opens expanded, showing folder names');
  check(await page.locator('.tma-dash__email-folder-label').first().isVisible(),
    'folder labels are visible by default (not a bare icon rail)');
  check(await page.locator('[data-email-group-toggle="folders"]').count() === 1,
    'the Mailboxes group has a header');
  check(await page.locator('[data-email-group-toggle="labels"]').count() === 1,
    'the Labels group has a header');
  check(await page.locator('.tma-dash__email-sidebar-nav > .tma-dash__email-folder--compose').count() === 1,
    'New Email sits above the groups, so collapsing Mailboxes cannot hide it');

  step(3, 'Counts are small plain numbers, not coloured badges');
  /*
   * "Inbox 24", not a filled circle holding 24. A coloured pill was the
   * loudest thing on the page for a folder that is simply doing its job.
   * Unread still leads, as weight and ink rather than as a badge.
   */
  const badges = await page.evaluate(() => {
    const unread = document.querySelector('.tma-dash__email-folder-count--unread');
    const plain = document.querySelector(
      '.tma-dash__email-folder-count:not(.tma-dash__email-folder-count--unread)'
    );
    const read = (el) => {
      if (!el) return null;
      const s = window.getComputedStyle(el);
      return {
        background: s.backgroundColor,
        radius: parseFloat(s.borderRadius),
        size: parseFloat(s.fontSize),
        weight: Number(s.fontWeight),
      };
    };

    return { unread: read(unread), plain: read(plain) };
  });

  check(!!badges.unread && !!badges.plain, 'both kinds of count are on screen');
  if (badges.unread && badges.plain) {
    const bare = (b) => /rgba\(0, 0, 0, 0\)|transparent/.test(b.background) && b.radius === 0;
    check(bare(badges.unread), `the unread count has no pill (${badges.unread.background})`);
    check(bare(badges.plain), `nor does a plain total (${badges.plain.background})`);
    check(badges.unread.size <= 13 && badges.plain.size <= 13,
      `both stay small (${badges.unread.size}px / ${badges.plain.size}px)`);
    check(badges.unread.weight > badges.plain.weight,
      `unread still reads first, by weight (${badges.unread.weight} vs ${badges.plain.weight})`);
  }

  step(4, 'Groups collapse, and stay collapsed across a reload');
  await page.click('[data-email-group-toggle="labels"]');
  await page.waitForTimeout(400);
  check(await page.locator('[data-email-group-toggle="labels"]').getAttribute('aria-expanded') === 'false',
    'the Labels group closes');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  // Park the pointer away from the main portal rail: if it is left hovering
  // there, the hover-overlay sidebar expands across the email card and eats
  // the click. That is the rail's normal behaviour, not an overlap bug.
  await page.mouse.move(1200, 600);
  await page.waitForTimeout(400);
  check(await page.locator('[data-email-group-toggle="labels"]').getAttribute('aria-expanded') === 'false',
    'it is still closed after a reload');
  await page.click('[data-email-group-toggle="labels"]');
  await page.waitForTimeout(300);

  step(5, 'The collapsed icon rail still works');
  await page.click('[data-email-sidebar-toggle]');
  await page.waitForTimeout(700);

  const rail = await styleOf(page, '.tma-dash__email-sidebar');
  check(rail.width === '72px', `collapsing gives a 72px rail (got ${rail.width})`);
  check(await page.locator('.tma-dash__email-group-head').count() === 0,
    'group headers are not rendered in the rail — there is no room to label them');
  check(await page.locator('.tma-dash__email-folder').count() > 0,
    'the folder icons are still there');

  await page.click('[data-email-sidebar-toggle]');
  await page.waitForTimeout(700);
  check((await styleOf(page, '.tma-dash__email-sidebar')).width === '232px',
    'expanding restores the card width');

  step(6, 'Dark theme gives the card a dark surface');
  await page.evaluate(() => {
    document.querySelector('.tma-dash').setAttribute('data-theme', 'dark');
  });
  await page.waitForTimeout(400);
  const dark = await styleOf(page, '.tma-dash__email-sidebar');
  check(dark.background !== 'rgb(255, 255, 255)' && dark.background !== 'rgba(0, 0, 0, 0)',
    `the sidebar is not left white in dark mode (got ${dark.background})`);

  step(7, 'Mobile is untouched');
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(mobile);
  await mobile.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(2400);
  check(await mobile.locator('.tma-dash__email-list-body').isVisible(),
    'the message list still fills the screen on mobile');
  await mobile.close();
} catch (err) {
  failures.push('threw: ' + err.message);
  log('\nERROR: ' + err.stack);
  await page.screenshot({ path: 'tests/Browser/email-sidebar-error.png' }).catch(() => {});
}

await page.screenshot({ path: 'tests/Browser/email-sidebar.png' }).catch(() => {});
await browser.close();

log('\n' + '─'.repeat(60));
if (errors.length) errors.forEach((e) => log('  ! ' + e));
if (failures.length) {
  log(`FAILED (${failures.length}):`);
  failures.forEach((f) => log('  ✗ ' + f));
  process.exit(1);
}
log('All email sidebar checks passed.');
