// Every dashboard row type must be the height of the skeleton row that
// stands in for it while the data loads.
//
// The tiles paint skeletonFileRows() and then swap in their own markup:
// Recent Files uses .tma-portal-file-row, and Email, Messages, Comments and
// Requests each have their own. Any of them that is not the skeleton's height
// moves its tile, and everything under it, the moment its data lands. That is
// what the browser scores as cumulative layout shift; the dashboard was at
// 0.55, where anything above 0.1 is judged poor.
//
// The right rail is held to the same rule. Its sections paint three
// skeleton rows and then fill with up to six notifications or activities and
// a See all footer, so each section is given the height it reaches full
// (dashboard.css, "Reserved section heights") and every rail row kind must be
// its placeholder's height. The rail here is built the way the shell ships
// it, at the rail's default 280px, and measured at the same 1440x900 the
// vitals harness uses, since the row caps follow the window's height.
//
// Run: node tests/Browser/dashboard-row-heights.mjs
// Exits non-zero, naming the row, if one of them drifts.
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8001';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.addStyleTag({ url: `${BASE}/css/portal.css` });
await page.addStyleTag({ url: `${BASE}/css/dashboard.css` }).catch(() => {});
await page.addStyleTag({ url: `${BASE}/css/tokens.css` }).catch(() => {});
await page.waitForTimeout(400);

const SKELETON =
  '<div class="tma-portal-file-row tma-portal-file-row--skeleton" aria-hidden="true">' +
  '<span class="tma-skeleton tma-skeleton--icon"></span>' +
  '<span class="tma-portal-file-row__meta" style="flex:1">' +
  '<span class="tma-skeleton tma-skeleton--text" style="width:58%"></span>' +
  '<span class="tma-skeleton tma-skeleton--text" style="width:34%;margin-top:6px"></span>' +
  '</span></div>';

const CARD_SKELETON =
  '<article class="tma-dash__card tma-dash__card--blue"><div class="tma-dash__card-head">' +
  '<span class="tma-skeleton tma-skeleton--text" style="width:55%"></span></div>' +
  '<div class="tma-dash__card-row"><span class="tma-skeleton tma-dash__card-value--skeleton"></span>' +
  '<span class="tma-skeleton tma-dash__card-delta--skeleton"></span></div></article>';

const CARD_REAL =
  '<article class="tma-dash__card tma-dash__card--blue"><div class="tma-dash__card-head">' +
  '<span class="tma-dash__card-title">Active clients</span></div>' +
  '<div class="tma-dash__card-row"><span class="tma-dash__card-value">1,284</span>' +
  '<span class="tma-dash__card-delta"><span class="tma-dash__card-delta-text">+12%</span></span></div></article>';

const CASES = {
  'file row (with path)':
    '<button class="tma-portal-file-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-file-row__meta"><span class="tma-portal-file-row__name">Engagement letter.pdf</span>' +
    '<span class="tma-portal-file-row__path">Clients / Chen Wei</span></span></button>',
  'file row (no path)':
    '<button class="tma-portal-file-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-file-row__meta"><span class="tma-portal-file-row__name">Engagement letter.pdf</span>' +
    '</span></button>',
  'email row':
    '<button class="tma-portal-email-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-email-row__body"><span class="tma-portal-email-row__top">' +
    '<span class="tma-portal-email-row__from">Dana Reed</span>' +
    '<span class="tma-portal-email-row__time">09:14</span></span>' +
    '<span class="tma-portal-email-row__subject">Quarterly review</span></span></button>',
  'chat row':
    '<button class="tma-portal-chat-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-email-row__body"><span class="tma-portal-email-row__top">' +
    '<span class="tma-portal-email-row__from">Li Wei</span>' +
    '<span class="tma-portal-email-row__time">09:14</span></span>' +
    '<span class="tma-portal-email-row__subject">Sent the papers over</span></span></button>',
  'comment row':
    '<button class="tma-portal-comment-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-email-row__body"><span class="tma-portal-email-row__top">' +
    '<span class="tma-portal-email-row__from">Ada Admin</span></span>' +
    '<span class="tma-portal-email-row__subject">Please check the stamp</span></span></button>',
  'request row':
    '<button class="tma-portal-request-row"><span style="width:24px;height:24px;display:inline-block"></span>' +
    '<span class="tma-portal-email-row__body"><span class="tma-portal-email-row__top">' +
    '<span class="tma-portal-email-row__from">Birth certificate</span></span>' +
    '<span class="tma-portal-email-row__subject">Awaiting upload</span></span></button>',
};

const out = await page.evaluate(
  ([skeleton, cases]) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:360px';
    document.body.appendChild(host);

    const measure = (html) => {
      host.innerHTML = html;
      return host.firstElementChild.getBoundingClientRect().height;
    };

    const result = { skeleton: measure(skeleton), rows: {} };
    for (const [name, html] of Object.entries(cases)) result.rows[name] = measure(html);

    return result;
  },
  [SKELETON, CASES],
);

console.log(`\n  skeleton row: ${out.skeleton.toFixed(1)}px\n`);
let worst = 0;
for (const [name, h] of Object.entries(out.rows)) {
  const d = h - out.skeleton;
  if (Math.abs(d) > Math.abs(worst)) worst = d;
  const flag = Math.abs(d) < 0.5 ? 'ok  ' : 'SHIFT';
  console.log(`    ${flag} ${name.padEnd(24)} ${h.toFixed(1)}px  (${d >= 0 ? '+' : ''}${d.toFixed(1)})`);
}
console.log(`\n  worst mismatch: ${worst.toFixed(1)}px per row\n`);

const cards = await page.evaluate(([sk, real]) => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:320px';
  document.body.appendChild(host);
  const m = (h) => { host.innerHTML = h; return host.firstElementChild.getBoundingClientRect().height; };
  return { skeleton: m(sk), real: m(real) };
}, [CARD_SKELETON, CARD_REAL]);

const cardDrift = cards.real - cards.skeleton;
console.log(`  KPI card skeleton ${cards.skeleton.toFixed(1)}px  real ${cards.real.toFixed(1)}px  (${cardDrift >= 0 ? '+' : ''}${cardDrift.toFixed(1)})\n`);

/* ── right rail ── */
const RB_SKEL =
  '<div class="tma-dash__rb-skel" aria-hidden="true"><span class="tma-dash__rb-skel-avatar"></span>' +
  '<span class="tma-dash__rb-skel-lines"><span></span><span></span></span></div>';
const RB_SECTION_SKELETON =
  '<section class="tma-dash__rb-section" data-rb-section="notifications">' +
  '<div class="tma-dash__rb-title">Notifications</div>' +
  '<div class="tma-dash__rb-body" data-rb-body="notifications">' + RB_SKEL + RB_SKEL + RB_SKEL + '</div>' +
  '</section>';
const RB_ROWS = {
  'notification row':
    '<div class="tma-dash__notice" role="button" tabindex="0"><span class="tma-dash__notice-icon tma-dash__notice-icon--blue"><img alt=""></span>' +
    '<div class="tma-dash__notice-body"><div class="tma-dash__notice-title">A file was shared with you</div>' +
    '<div class="tma-dash__notice-meta">2h ago</div></div></div>',
  'activity row':
    '<div class="tma-dash__activity" data-activity-id="1"><span class="tma-dash__person-avatar"><img alt=""></span>' +
    '<div class="tma-dash__notice-body"><div class="tma-dash__notice-title">Ada Admin uploaded a file</div>' +
    '<div class="tma-dash__notice-meta">2h ago</div></div></div>',
};
const RB_CONTACT =
  '<div class="tma-dash__contact" role="button" tabindex="0"><img class="tma-dash__rb-avatar" alt="">' +
  '<span class="tma-dash__contact-name">Chen Wei<span class="tma-dash__contact-company">TMA-2026-0042</span></span></div>';
const RB_FOOTER =
  '<div class="tma-dash__rb-footer" data-rb-footer="notifications">' +
  '<button type="button" class="tma-dash__rb-see-all">See all notifications</button></div>';

const rail = await page.evaluate(
  ([sectionSkeleton, rows, skel, contact, footer]) => {
    const host = document.createElement('aside');
    host.className = 'tma-dash__rightbar';
    host.style.cssText = 'position:absolute;left:-9999px;top:0;width:280px;height:900px;display:flex;flex-direction:column;gap:16px;padding:16px;box-sizing:border-box';
    document.body.appendChild(host);
    const caps = ['notifications', 'activities', 'applications'].map((k) => [k, getComputedStyle(host).getPropertyValue('--rb-cap-' + k).trim()]);
    const measure = (html, sel) => {
      host.innerHTML = html;
      return (sel ? host.querySelector(sel) : host.firstElementChild).getBoundingClientRect().height;
    };
    const body = (inner) => '<section class="tma-dash__rb-section" data-rb-section="notifications"><div class="tma-dash__rb-body">' + inner + '</div></section>';
    const result = { caps, skeleton: measure(body(skel), '.tma-dash__rb-body > *'), rows: {} };
    for (const [name, html] of Object.entries(rows)) result.rows[name] = measure(body(html), '.tma-dash__rb-body > *');
    const apps = (inner) => '<section class="tma-dash__rb-section" data-rb-section="applications"><div class="tma-dash__rb-body">' + inner + '</div></section>';
    result.appSkeleton = measure(apps(skel), '.tma-dash__rb-body > *');
    result.contact = measure(apps(contact), '.tma-dash__rb-body > *');
    const cap = parseInt(caps[0][1], 10) || 6;
    result.sectionSkeleton = measure(sectionSkeleton);
    result.sectionFull = measure(
      '<section class="tma-dash__rb-section" data-rb-section="notifications"><div class="tma-dash__rb-title">Notifications</div>' +
      '<div class="tma-dash__rb-body">' + rows['notification row'].repeat(cap) + '</div>' + footer + '</section>',
    );
    result.sectionEmpty = measure(
      '<section class="tma-dash__rb-section" data-rb-section="notifications"><div class="tma-dash__rb-title">Notifications</div>' +
      '<div class="tma-dash__rb-body"><div class="tma-dash__rb-empty"><span class="tma-dash__rb-empty-icon"><img alt=""></span>' +
      '<span class="tma-dash__rb-empty-text">You are all caught up.</span></div></div>' + footer + '</section>',
    );
    result.cap = cap;
    return result;
  },
  [RB_SECTION_SKELETON, RB_ROWS, RB_SKEL, RB_CONTACT, RB_FOOTER],
);

console.log(`  right rail caps: ${rail.caps.map(([k, v]) => `${k} ${v || '?'}`).join(', ')}`);
console.log(`  rail skeleton row: ${rail.skeleton.toFixed(1)}px`);
const railBad = [];
for (const [name, h] of Object.entries(rail.rows)) {
  const d = h - rail.skeleton;
  const flag = Math.abs(d) < 0.5 ? 'ok  ' : 'SHIFT';
  if (Math.abs(d) >= 0.5) railBad.push([name, h]);
  console.log(`    ${flag} ${name.padEnd(24)} ${h.toFixed(1)}px  (${d >= 0 ? '+' : ''}${d.toFixed(1)})`);
}
const contactDrift = rail.contact - rail.appSkeleton;
if (Math.abs(contactDrift) >= 0.5) railBad.push(['application row', rail.contact]);
console.log(`    ${Math.abs(contactDrift) < 0.5 ? 'ok  ' : 'SHIFT'} ${'application row'.padEnd(24)} ${rail.contact.toFixed(1)}px  (${contactDrift >= 0 ? '+' : ''}${contactDrift.toFixed(1)} vs its ${rail.appSkeleton.toFixed(1)}px skeleton)`);
const fullDrift = rail.sectionFull - rail.sectionSkeleton;
const emptyDrift = rail.sectionEmpty - rail.sectionSkeleton;
if (Math.abs(fullDrift) >= 0.5) railBad.push([`rail section with ${rail.cap} rows and footer`, rail.sectionFull]);
if (Math.abs(emptyDrift) >= 0.5) railBad.push(['rail section, empty state and footer', rail.sectionEmpty]);
console.log(`  rail section: shell skeleton ${rail.sectionSkeleton.toFixed(1)}px  ${rail.cap} rows + footer ${rail.sectionFull.toFixed(1)}px (${fullDrift >= 0 ? '+' : ''}${fullDrift.toFixed(1)})  empty + footer ${rail.sectionEmpty.toFixed(1)}px (${emptyDrift >= 0 ? '+' : ''}${emptyDrift.toFixed(1)})\n`);

await browser.close();

const bad = Object.entries(out.rows).filter(([, h]) => Math.abs(h - out.skeleton) >= 0.5);
if (Math.abs(cardDrift) >= 0.5) bad.push(['KPI card', cards.real]);
bad.push(...railBad);

if (bad.length) {
  console.error(
    'Layout shift: these do not match the placeholder they replace —\n  ' +
    bad.map(([name, h]) => `${name} (${h.toFixed(1)}px)`).join('\n  ') +
    '\n\nGive the row a min-height equal to the skeleton, as .tma-portal-file-row has; a rail section takes its reserved height from --rb-cap-* in dashboard.css.',
  );
  process.exit(1);
}

console.log('  every row matches its placeholder: no shift from this board.\n');
