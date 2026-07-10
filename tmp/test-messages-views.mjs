import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.click('[data-expand="social"]');
await page.waitForTimeout(150);
await page.click('[data-nav="so-messages"]');
await page.waitForTimeout(500);

const views = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.tma-dash__view')).map(v => ({
    view: v.getAttribute('data-view'),
    hidden: v.hidden,
    display: getComputedStyle(v).display,
    visibility: getComputedStyle(v).visibility,
    hasEmail: !!v.querySelector('.tma-dash__email'),
    hasMessages: !!v.querySelector('.tma-dash__messages'),
    emailVisible: v.querySelector('.tma-dash__email') ? getComputedStyle(v.querySelector('.tma-dash__email')).display : null,
  }));
});
console.log(JSON.stringify(views, null, 2));
await browser.close();
