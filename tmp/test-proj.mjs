import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1440,height:1100}, deviceScaleFactor:1.5 });
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); p.on('pageerror',e=>errs.push('PE '+e.message));
await p.goto('file:///Users/vernonfrancis/Desktop/Portal/public/index.html',{waitUntil:'networkidle'});
await p.waitForTimeout(300);
// hover Aug bar (index 7) -> expect 26,598
const bars = p.locator('.snowui-dash__panel--overview .snowui-dash__vbar');
await bars.nth(7).hover(); await p.waitForTimeout(300);
const tip = await p.evaluate(()=>{const t=document.querySelector('.snowui-tooltip.is-visible .snowui-tooltip__text');return t?t.textContent:null;});
console.log('TIP=',tip);
// dark mode
await p.click('[data-action="toggle-theme"]'); await p.waitForTimeout(250);
await p.mouse.move(10,10);
await p.screenshot({ path:'./projects-dark.png' });
console.log('ERRORS',JSON.stringify(errs));
await b.close();
