import { chromium } from 'playwright';
const BASE='http://127.0.0.1:8000';
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
p.on('pageerror',e=>console.log('PAGEERROR:',e.message.slice(0,150)));
const go=u=>p.goto(u,{waitUntil:'commit',timeout:120000});
await go(`${BASE}/auth/login`);
await p.click('text=Sign in with Email'); await p.waitForSelector('input[name="email"]',{state:'visible'});
await p.fill('input[name="email"]','panelcheck@example.com'); await p.fill('input[name="password"]','password12345');
await p.click('button[type="submit"]:visible');
await p.waitForFunction(()=>!location.pathname.startsWith('/auth/login'),{timeout:45000}).catch(()=>{});
console.log('post-login:', p.url());
if (p.url().includes('/auth/login')) { console.log('LOGIN BLOCKED'); await b.close(); process.exit(0); }
await go(`${BASE}/email`);
await p.waitForFunction(()=>!!window.TMAEmail,{timeout:120000}).catch(()=>console.log('TMAEmail not loaded'));
await p.waitForFunction(()=>document.querySelectorAll('.tma-dash__email-row').length>0,{timeout:60000}).catch(()=>console.log('no rows'));
await p.waitForTimeout(7000);
const s=await p.evaluate(()=>{const rr=e=>e?e.getBoundingClientRect():null;
 const pn=document.querySelector('.tma-mail-sync'); const bar=pn&&pn.querySelector('.tma-portal-upload__bar');
 const fill=pn&&pn.querySelector('.tma-portal-upload__fill'); const av=document.querySelector('.tma-dash__email-row-avatar img');
 return {rows:document.querySelectorAll('.tma-dash__email-row').length, panel:!!pn,
  panelRect: pn?{w:Math.round(rr(pn).width),h:Math.round(rr(pn).height),bottomGap:Math.round(window.innerHeight-rr(pn).bottom),rightGap:Math.round(window.innerWidth-rr(pn).right)}:null,
  barH:bar?Math.round(rr(bar).height):null, fillW:fill?Math.round(rr(fill).width):null, fillBg:fill?getComputedStyle(fill).backgroundColor:null,
  text:pn?pn.innerText.replace(/\n/g,' | '):null,
  avatar:av?(av.src.startsWith('data:image/svg')?'initials-svg':'photo'):'NONE', avatarW:av?Math.round(rr(av).width):null,
  pager:!!document.querySelector('[data-email-pagination]')};});
console.log(JSON.stringify(s,null,1));
await p.screenshot({path:'/tmp/panel.png'});
await b.close();
