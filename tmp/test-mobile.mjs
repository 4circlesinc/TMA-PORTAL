import { chromium } from 'playwright';
const URL = 'file:///Users/vernonfrancis/Desktop/Portal/public/index.html';
const OUT = '/Users/vernonfrancis/Desktop/Portal/tmp/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const broken = await page.evaluate(() => Array.from(document.images).filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
console.log('BROKEN', JSON.stringify(broken));

// closed: dashboard + bottom tab bar
await page.screenshot({ path: OUT + 'mob-home.png' });

// open mobile menu via bottom Home tab
await page.click('[data-tab="home"]');
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + 'mob-menu.png' });

// select Billing from favorites -> navigate, menu closes
await page.click('[data-mrow][data-nav="ac-billing"]');
await page.waitForTimeout(200);
const title = await page.textContent('[data-page-title]');
const crumb = await page.textContent('[data-breadcrumb]');
const menuHidden = await page.evaluate(() => document.querySelector('[data-mmenu]').hidden);
console.log('NAV title=', title.trim(), '| crumb=', crumb.replace(/\s+/g,' ').trim(), '| menuHidden=', menuHidden);

// open notifications drawer via bell tab
await page.click('[data-tab="alerts"]');
await page.waitForTimeout(250);
const rbOpen = await page.evaluate(() => document.querySelector('.snowui-dash').classList.contains('is-rb-open'));
console.log('RB-OPEN=', rbOpen);
await page.screenshot({ path: OUT + 'mob-rb.png' });

console.log('ERRORS', JSON.stringify(errors));
await browser.close();
