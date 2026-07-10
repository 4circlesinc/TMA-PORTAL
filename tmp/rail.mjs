import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1024}, deviceScaleFactor:2 });
await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(300);
await p.click('[data-action="toggle-sidebar"]'); // collapse
await p.waitForTimeout(300);
const sb = await p.locator('.snowui-dash__sidebar').boundingBox();
console.log('rail width=', Math.round(sb.width));
await p.screenshot({ path:'./rail.png', clip:{x:0,y:0,width:340,height:1024} });
await b.close();
