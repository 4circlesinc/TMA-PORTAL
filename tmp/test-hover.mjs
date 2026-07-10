import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1024}, deviceScaleFactor:2 });
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(300);
const broken = await p.evaluate(()=>Array.from(document.images).filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));
console.log('BROKEN', broken.length);
// hover the Mac bar (2nd device bar)
const bars = p.locator('.snowui-dash__panel--device .snowui-dash__vbar');
await bars.nth(1).hover();
await p.waitForTimeout(350);
const tipVisible = await p.evaluate(()=>!!document.querySelector('.snowui-tooltip.is-visible'));
const tipText = await p.evaluate(()=>{const t=document.querySelector('.snowui-tooltip.is-visible .snowui-tooltip__text');return t?t.textContent:null;});
console.log('TIP visible=',tipVisible,'text=',tipText);
await p.screenshot({ path:'./hover-device.png', clip:{x:150,y:430,width:700,height:260} });
console.log('ERRORS', JSON.stringify(errs));
await b.close();
