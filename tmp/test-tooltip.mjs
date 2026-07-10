import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8767/demo/tooltip.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

async function testHover(selector, waitMs, label) {
  const loc = page.locator(selector).first();
  await loc.hover();
  await page.waitForTimeout(waitMs);
  const id = await loc.evaluate((el) => {
    const trigger = el.closest('[data-tooltip-trigger]');
    return trigger ? trigger.getAttribute('data-tooltip-target') : el.getAttribute('data-tooltip-target');
  });
  const visible = await page.locator(`#${id}`).evaluate((el) => el.classList.contains('is-visible'));
  console.log(`${label}: ${visible ? 'PASS' : 'FAIL'} (${waitMs}ms)`);
  return visible;
}

const results = [];
results.push(await testHover('[data-tooltip-target="demo-guidance-tip"]', 1600, 'Guidance 1.5s'));
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

results.push(await testHover('#icon-button-hover [data-tooltip-trigger]', 500, 'Icon button 400ms'));
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

results.push(await testHover('.snowui-tooltip-demo__truncated', 500, 'Truncated text 400ms'));
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

results.push(await testHover('.chart-bar-demo', 500, 'Chart bar 400ms'));

await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
