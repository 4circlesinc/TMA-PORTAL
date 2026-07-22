import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8899';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
await page.click('text=Sign in with Email');
await page.waitForSelector('input[name="email"]', { state: 'visible' });
await page.fill('input[name="email"]', 'e2e@example.com');
await page.fill('input[name="password"]', 'password12345');
await Promise.all([page.waitForNavigation({waitUntil:'networkidle'}).catch(()=>{}), page.click('button[type="submit"]:visible')]);
await page.goto(`${BASE}/social/messages`, { waitUntil: 'networkidle' });
await page.waitForSelector('.tma-dash__messages-row');
await page.waitForTimeout(1500);
await page.evaluate(() => { const el=document.querySelector('[data-messages-list-body]'); el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(400);

console.log(JSON.stringify(await page.evaluate(() => {
  const foot = document.querySelector('.tma-dash__messages-list-foot');
  const btn = foot && foot.querySelector('[data-messages-compose]');
  const list = document.querySelector('.tma-dash__messages-list');
  const box = (el) => { if(!el) return null; const r=el.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; };
  const b = btn && btn.getBoundingClientRect();
  const top = b ? document.elementFromPoint(b.left+b.width/2, b.top+b.height/2) : null;
  return {
    viewportH: innerHeight,
    list: box(list), foot: box(foot), btn: box(btn),
    footDisplay: foot ? getComputedStyle(foot).display : null,
    topElement: top ? (top.className || top.tagName) : null,
    footHTML: foot ? foot.innerHTML.slice(0, 400) : null,
    composeAnywhere: document.querySelectorAll('[data-messages-compose]').length,
  };
}, null), null, 2));
await browser.close();
