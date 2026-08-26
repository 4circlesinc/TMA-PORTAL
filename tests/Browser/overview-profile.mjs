/*
 * The profile cards on the Admin Overview page, and the desktop download promo
 * they carry. Both live in TMAAccount and are rendered in two places now, so
 * this checks the borrowed copy hydrates (a stale one shows "Loading…"), that
 * the flex rows still span the two-column grid, and that the download buttons
 * reflect what is actually published: enabled for a platform with a manifest,
 * inert for one without. Needs the standard `e2e@example.com` account and a
 * `desktop/latest-mac.yml` on the files disk.
 */
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const DIR = process.argv[2] || 'tests/Browser';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });

const IGNORE = /Origin not allowed|realtime disabled|Reverb|WebSocket/;
const errors = [];
page.on('pageerror', (e) => { if (!IGNORE.test(String(e))) errors.push(String(e)); });
page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text()); });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"]:visible'),
]);
if (page.url().includes('/auth/login')) throw new Error('login failed');
// "Stay signed in?" sits in front of the whole portal until it is answered.
if (page.url().includes('stay-signed-in')) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
}

await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__overview-grid .tma-dash__account-block--profile', { timeout: 20000 });
await page.waitForTimeout(2000);

const state = await page.evaluate(() => {
  const grid = document.querySelector('.tma-dash__overview-grid');
  const q = (s) => grid.querySelector(s);
  const btns = [...grid.querySelectorAll('[data-desktop-download]')].map((b) => {
    const icon = b.querySelector('.tma-dash__account-promo-btn-icon');
    return {
      platform: b.getAttribute('data-desktop-download'),
      label: b.textContent.trim(),
      href: b.getAttribute('href'),
      disabled: b.getAttribute('aria-disabled'),
      title: b.title,
      icon: icon ? {
        w: Math.round(icon.getBoundingClientRect().width),
        h: Math.round(icon.getBoundingClientRect().height),
        src: icon.getAttribute('src') || '',
        // A broken SVG still lays out; naturalWidth is what proves it loaded.
        loaded: icon.complete && icon.naturalWidth > 0,
      } : null,
    };
  });
  const rowWidths = [...grid.querySelectorAll(':scope > .tma-dash__account-row')]
    .map((r) => Math.round(r.getBoundingClientRect().width));
  const signInBlock = grid.querySelector('.tma-dash__overview-block--signins');
  return {
    gridWidth: Math.round(grid.getBoundingClientRect().width),
    rowWidths,
    name: q('[data-account-name]')?.textContent?.trim(),
    email: q('[data-account-email]')?.textContent?.trim(),
    details: [...grid.querySelectorAll('[data-account-details] .tma-dash__account-detail-row')]
      .map((r) => ({
        label: r.querySelector('.tma-dash__account-detail-label')?.textContent?.trim(),
        value: r.querySelector('.tma-dash__account-detail-value')?.textContent?.trim(),
        href: r.querySelector('.tma-dash__account-detail-link')?.getAttribute('href') || null,
      })),
    promoTitle: q('.tma-dash__account-promo-title')?.innerText?.trim(),
    buttons: btns,
    heroPresent: !!q('.tma-dash__overview-block--hero'),
    signIns: {
      width: signInBlock ? Math.round(signInBlock.getBoundingClientRect().width) : 0,
      title: signInBlock?.querySelector('.tma-dash__overview-block-title')?.textContent?.trim(),
      rows: [...(signInBlock?.querySelectorAll('.tma-dash__activity') || [])].map((r) => ({
        text: r.querySelector('.tma-dash__notice-title')?.textContent?.trim(),
        when: r.querySelector('.tma-dash__notice-meta')?.textContent?.trim(),
        status: r.getAttribute('data-status'),
        avatar: Math.round(r.querySelector('img')?.getBoundingClientRect().width || 0),
      })),
      skeletons: (signInBlock?.querySelectorAll('.tma-dash__rb-skel') || []).length,
      empty: !!signInBlock?.querySelector('.tma-dash__rb-empty'),
    },
  };
});

console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: `${DIR}/overview-profile.png`, fullPage: false });
// The card sits below the fold on a 1200px viewport, so shoot it directly.
const signInEl = await page.$('.tma-dash__overview-block--signins');
if (signInEl) await signInEl.screenshot({ path: `${DIR}/overview-signins.png` });

const fail = [];
if (!state.name || state.name === 'Loading…') fail.push(`profile name not hydrated: ${state.name}`);

/* Profile Details must show what the account actually holds, not a column of
   dashes. The seed fills all five, so a dash here means /me dropped a field. */
const want = {
  Company: 'TM ANTOINE Advisory',
  'Contact Phone': '+1 555 123 4567',
  'Job title': 'Managing Attorney',
  LinkedIn: 'linkedin.com/in/vernon-francis',
};
for (const [label, value] of Object.entries(want)) {
  const row = state.details.find((r) => r.label === label);
  if (!row) fail.push(`Profile Details is missing the ${label} row`);
  else if (row.value !== value) fail.push(`${label} shows "${row.value}", want "${value}"`);
}
const linkedin = state.details.find((r) => r.label === 'LinkedIn');
if (linkedin && linkedin.href !== 'https://linkedin.com/in/vernon-francis') {
  fail.push(`LinkedIn row is not a working link: ${linkedin.href}`);
}
if (!state.details.some((r) => r.label === 'Email' && /@/.test(r.value || ''))) {
  fail.push('Email row lost its value');
}
if (!state.heroPresent) fail.push('workspace metrics block disappeared');
if (state.rowWidths.some((w) => w < state.gridWidth - 2)) {
  fail.push(`account rows not full width: ${state.rowWidths} vs grid ${state.gridWidth}`);
}
const mac = state.buttons.find((b) => b.platform === 'mac');
const win = state.buttons.find((b) => b.platform === 'windows');
if (!mac || !win) fail.push('missing download buttons');
if (mac && mac.disabled !== 'false') fail.push(`mac button should be enabled: ${JSON.stringify(mac)}`);
if (win && win.disabled !== 'true') fail.push(`windows button should be disabled: ${JSON.stringify(win)}`);
// Brand artwork: the right file, actually decoded, and boxed at 16px so a
// slow SVG can't stretch the pill.
if (mac && !/AppleLight16\.svg$/.test(mac.icon?.src || '')) fail.push(`mac logo wrong: ${mac.icon?.src}`);
if (win && !/Windows16\.svg$/.test(win.icon?.src || '')) fail.push(`windows logo wrong: ${win.icon?.src}`);
for (const b of [mac, win]) {
  if (!b) continue;
  if (!b.icon?.loaded) fail.push(`${b.platform} logo failed to load: ${b.icon?.src}`);
  if (b.icon?.w !== 16 || b.icon?.h !== 16) fail.push(`${b.platform} logo box is ${b.icon?.w}x${b.icon?.h}, want 16x16`);
}
if (!/macOS \/ Windows/.test(state.promoTitle || '')) fail.push(`promo copy wrong: ${state.promoTitle}`);

// Sign-ins: firm-wide rows, resolved (no skeletons left), full grid width.
const s = state.signIns;
if (!s.width) fail.push('sign-ins card missing');
if (s.width && s.width < state.gridWidth - 2) fail.push(`sign-ins card not full width: ${s.width} vs ${state.gridWidth}`);
if (s.skeletons) fail.push(`sign-ins never resolved: ${s.skeletons} skeleton rows left`);
if (!s.rows.length && !s.empty) fail.push('sign-ins card rendered neither rows nor an empty state');
if (s.rows.some((r) => !r.text || !r.when)) fail.push(`sign-in row missing text or time: ${JSON.stringify(s.rows)}`);
if (s.rows.some((r) => r.avatar < 8 || r.avatar > 64)) fail.push(`sign-in avatar box wrong: ${JSON.stringify(s.rows.map((r) => r.avatar))}`);
if (s.rows.some((r) => /signed out/i.test(r.text || ''))) fail.push('sign-outs leaked into the sign-ins card');

/* The whole point of the feed is that it is firm-wide, but the viewer's own
   logins pile up at the top across runs — so ask the API rather than the
   visible slice, and check somebody else is in there. */
const feed = await page.evaluate(async () => {
  const r = await fetch('/portal/sign-ins?limit=50', { headers: { Accept: 'application/json' } });
  return r.ok ? r.json() : null;
});
const mine = state.name;
const others = (feed?.items || []).filter((i) => i.actor && i.actor.name !== mine);
console.log('firm-wide rows from other people:', others.length, others[0]?.description || '');
if (!feed) fail.push('/portal/sign-ins did not answer');
else if (!others.length) fail.push('feed carried only the viewer — not firm-wide');
if ((feed?.items || []).some((i) => 'ip' in i || 'device' in i)) fail.push('feed leaked ip/device');

if (errors.length) fail.push(`console errors: ${errors.slice(0, 4).join(' | ')}`);

// "See all activity" switches tabs in place rather than navigating away.
await page.click('[data-overview-view-all-activity]');
await page.waitForTimeout(800);
const afterSeeAll = await page.evaluate(() => ({
  url: location.search,
  activityShown: !document.querySelector('.tma-dash__overview-activity-tab')?.hidden,
  gridHidden: !!document.querySelector('.tma-dash__overview-grid')?.hidden,
}));
console.log('see all activity:', JSON.stringify(afterSeeAll));
if (!afterSeeAll.activityShown || !afterSeeAll.gridHidden) {
  fail.push(`See all activity did not open the Activity tab: ${JSON.stringify(afterSeeAll)}`);
}

/* Edit Profile has to land on the real editor — the form that PUTs /profile —
   without a page load, and with the fields already filled from the account. */
await page.goto(`${BASE}/overview`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-account-edit-profile]', { timeout: 20000 });
await page.evaluate(() => { window.__tmaNoReload = true; });
await page.click('[data-account-edit-profile]');
await page.waitForSelector('[data-pf-save]', { timeout: 20000 }).catch(() => {});
const editor = await page.evaluate(() => {
  const val = (n) => document.querySelector(`[data-pf="${n}"]`)?.value || '';
  return {
    survivedInPage: !!window.__tmaNoReload,
    saveButton: !!document.querySelector('[data-pf-save]'),
    company: val('company'),
    jobTitle: val('job_title'),
    linkedin: val('linkedin_url'),
    phone: val('phone'),
  };
});
console.log('edit profile:', JSON.stringify(editor));
if (!editor.saveButton) fail.push('Edit Profile did not open the profile editor');
if (!editor.survivedInPage) fail.push('Edit Profile reloaded the page instead of routing in place');
if (editor.company !== 'TM ANTOINE Advisory') fail.push(`editor company field: "${editor.company}"`);
if (editor.jobTitle !== 'Managing Attorney') fail.push(`editor job title field: "${editor.jobTitle}"`);
if (!/linkedin\.com\/in\/vernon-francis/.test(editor.linkedin)) fail.push(`editor linkedin field: "${editor.linkedin}"`);

// The account page must still work, and its promo is the same component.
await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__account-panel--overview [data-desktop-download="mac"]', { timeout: 20000 });
await page.waitForTimeout(1500);
const acct = await page.evaluate(() => {
  const b = document.querySelector('.tma-dash__account-panel--overview [data-desktop-download="mac"]');
  return { present: !!b, disabled: b?.getAttribute('aria-disabled'), title: b?.title };
});
console.log('account page:', JSON.stringify(acct));
await page.screenshot({ path: `${DIR}/account-profile.png` });
if (!acct.present) fail.push('account page lost its promo buttons');
if (acct.disabled !== 'false') fail.push(`account page mac button not enabled: ${JSON.stringify(acct)}`);

await browser.close();
if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exit(1); }
console.log('PASS');
