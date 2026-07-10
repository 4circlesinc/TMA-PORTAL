import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1024}, deviceScaleFactor:2 });
await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(300);
const bar = p.locator('.snowui-dash__panel--device .snowui-dash__vbar').nth(3); // Windows
await bar.scrollIntoViewIfNeeded();
await bar.hover();
await p.waitForTimeout(350);
const box = await p.locator('.snowui-dash__panel--device').boundingBox();
await p.screenshot({ path:'./hover-device2.png', clip:{ x:box.x-4, y:box.y-30, width:box.width+8, height:box.height+40 } });
await b.close(); console.log('ok');
