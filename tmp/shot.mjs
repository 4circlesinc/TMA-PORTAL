import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8770/public/demo/dashboard.html';
const out = process.argv[3] || '/Users/vernonfrancis/Desktop/Portal/tmp/dashboard-shot.png';
const w = Number(process.argv[4] || 1440);
const h = Number(process.argv[5] || 1024);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const broken = await page.evaluate(() => Array.from(document.images).filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
console.log('BROKEN_IMAGES', JSON.stringify(broken));
const click = process.argv[6];
if (click) { await page.click(click); await page.waitForTimeout(400); }
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
