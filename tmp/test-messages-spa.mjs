import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8765/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// Expand Social nav
await page.click('[data-expand="social"]');
await page.waitForTimeout(150);
await page.click('[data-nav="so-messages"]');
await page.waitForTimeout(500);

const state = await page.evaluate(() => ({
  path: location.pathname,
  viewHidden: document.querySelector('[data-view="messages"]')?.hidden,
  hasLayout: !!document.querySelector('.tma-dash__messages-layout'),
  hasList: !!document.querySelector('.tma-dash__messages-list'),
  hasChat: !!document.querySelector('.tma-dash__messages-chat'),
  messagesInnerLen: document.querySelector('[data-messages]')?.innerHTML?.length,
  messagesMount: document.querySelector('[data-messages]')?.innerHTML?.slice(0, 300),
  activeNav: document.querySelector('.tma-dash__nav-item--active')?.textContent?.trim(),
  mainHead: document.querySelector('.tma-dash__main-head')?.style.display,
  viewDisplay: document.querySelector('[data-view="messages"]')?.style.display,
}));
console.log('STATE', JSON.stringify(state, null, 2));
console.log('ERRORS', JSON.stringify(errors));
await page.screenshot({ path: '/Users/vernonfrancis/Desktop/Portal/tmp/messages-spa.png', fullPage: true });
await browser.close();
