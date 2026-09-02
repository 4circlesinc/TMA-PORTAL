// Preview the desktop app's blue title bar (narrow window) over the local
// portal: injects the real titlebar.js CSS + DOM the way the app does.
import { chromium } from 'playwright';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const titlebar = require('../../desktop/titlebar.js');

const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();

async function login(page) {
  await page.goto(BASE + '/auth/login', { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(600);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  }
}

async function shoot(width, name) {
  const context = await browser.newContext({ viewport: { width, height: 700 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await login(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: titlebar.buildCss('darwin') });
  await page.evaluate(titlebar.script({ canGoBack: true, canGoForward: false }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `tests/Browser/_scratch-titlebar-${name}.png`, clip: { x: 0, y: 0, width, height: 140 } });
  await page.screenshot({ path: `tests/Browser/_scratch-titlebar-${name}-full.png` });
  await context.close();
}

await shoot(1000, 'narrow');
await shoot(1300, 'wide');
await browser.close();
