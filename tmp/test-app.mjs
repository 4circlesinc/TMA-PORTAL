import { chromium } from 'playwright';

const URL = 'file:///Users/vernonfrancis/Desktop/Portal/public/index.html';
const OUT = '/Users/vernonfrancis/Desktop/Portal/tmp/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const broken = await page.evaluate(() => Array.from(document.images).filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
console.log('BROKEN', JSON.stringify(broken));

// 1) Expand Account group + navigate to Billing
await page.click('[data-expand="account"]');
await page.waitForTimeout(150);
await page.click('[data-nav="ac-billing"]');
await page.waitForTimeout(150);
const crumb = await page.textContent('[data-breadcrumb]');
const title = await page.textContent('[data-page-title]');
console.log('NAV title=', title.trim(), '| crumb=', crumb.replace(/\s+/g, ' ').trim());

// 2) Today dropdown -> This week
await page.click('[data-action="open-today"]');
await page.waitForTimeout(120);
await page.click('[data-today="This week"]');
const today = await page.textContent('[data-today-label]');
console.log('TODAY=', today.trim());

// 3) Theme toggle (dark)
await page.click('[data-action="toggle-theme"]');
await page.waitForTimeout(200);
const themed = await page.getAttribute('.snowui-dash', 'data-theme');
console.log('THEME=', themed);
await page.screenshot({ path: OUT + 'app-dark.png' });

// back to light
await page.click('[data-action="toggle-theme"]');
await page.waitForTimeout(150);

// 4) Search palette
await page.keyboard.press('/');
await page.waitForTimeout(150);
await page.fill('[data-cmd-input]', 'team');
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + 'app-search.png' });
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const title2 = await page.textContent('[data-page-title]');
console.log('SEARCH-NAV title=', title2.trim());

// 5) Sidebar collapse (desktop)
await page.click('[data-action="toggle-sidebar"]');
await page.waitForTimeout(200);
const collapsed = await page.evaluate(() => document.querySelector('.snowui-dash').classList.contains('is-sidebar-collapsed'));
console.log('SIDEBAR-COLLAPSED=', collapsed);
await page.screenshot({ path: OUT + 'app-collapsed.png' });

console.log('CONSOLE_ERRORS', JSON.stringify(errors));
await browser.close();
