import { chromium } from 'playwright';
const b = await chromium.launch();
for (const w of [1120, 1440, 1760]) {
  const p = await b.newPage({ viewport:{width:w,height:1100}, deviceScaleFactor:1 });
  await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
  await p.waitForTimeout(250);
  const s = await p.locator('.snowui-dash__panel--status').boundingBox();
  const t = await p.locator('.snowui-dash__panel--tasklist').boundingBox();
  console.log('w='+w, 'status='+Math.round(s.height), 'tasklist='+Math.round(t.height), s&&t&&Math.abs(s.height-t.height)<2?'OK-equal':'MISMATCH');
  await p.close();
}
await b.close();
