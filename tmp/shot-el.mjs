import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1024}, deviceScaleFactor:3 });
await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(300);
await p.locator('.snowui-dash__search').screenshot({ path:'./search-el.png' });
// also focus it to check focus state
await p.locator('.snowui-dash__search').focus();
await p.waitForTimeout(150);
await p.locator('.snowui-dash__header-right').screenshot({ path:'./search-focus.png' });
await b.close(); console.log('ok');
