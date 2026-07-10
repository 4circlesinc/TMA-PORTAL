import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8765/social/messages';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(500);

const state = await page.evaluate(() => ({
  viewHidden: document.querySelector('[data-view="messages"]')?.hidden,
  hasLayout: !!document.querySelector('.tma-dash__messages-layout'),
  hasList: !!document.querySelector('.tma-dash__messages-list'),
  hasChat: !!document.querySelector('.tma-dash__messages-chat'),
  messagesInner: document.querySelector('[data-messages]')?.innerHTML?.slice(0, 200),
  activeNav: document.querySelector('.tma-dash__nav-item--active')?.textContent?.trim(),
  mainHeadDisplay: document.querySelector('.tma-dash__main-head') ? getComputedStyle(document.querySelector('.tma-dash__main-head')).display : null,
}));
console.log('STATE', JSON.stringify(state, null, 2));
console.log('ERRORS', JSON.stringify(errors));
await page.screenshot({ path: '/Users/vernonfrancis/Desktop/Portal/tmp/messages-page.png', fullPage: true });
await browser.close();
