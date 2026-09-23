import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8941';
const LOG='storage/logs/laravel.log';
const loginCode=()=>{const t=readFileSync(LOG,'utf8');const h=[...t.matchAll(/letter-spacing:\.24em[^>]*>(\d{6})</g)];return h.length?h[h.length-1][1]:null;};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1500,height:1000} });

async function signIn(page){
  await page.goto(`${BASE}/auth/login`,{waitUntil:'domcontentloaded'});
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]',{state:'visible'});
  await page.fill('input[name="email"]','e2e@example.com');
  await page.fill('input[name="password"]','password12345');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}).catch(()=>{}),page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if(page.url().includes('/auth/login-code')){
    await page.waitForTimeout(900);
    const code=loginCode(); if(!code) throw new Error('no code');
    await page.locator('.tma-auth__otp-digit').first().click();
    await page.keyboard.type(code,{delay:40});
    const t=page.locator('input[type="checkbox"]').first();
    if(await t.count()) await t.check().catch(()=>{});
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}).catch(()=>{}),page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(900);
  }
  if(page.url().includes('/auth/stay-signed-in')){
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}).catch(()=>{}),page.click('button[type="submit"]:visible')]);
    await page.waitForTimeout(700);
  }
}

const a = await ctx.newPage();
await signIn(a);
const b = await ctx.newPage();   // second tab, same session

const track = (page,name)=>{
  const hits=[];
  page.on('request',r=>{const u=r.url(); if(u.includes('/portal/cip/')) hits.push({t:Date.now(),u:u.replace(BASE,'')});});
  page.on('pageerror',e=>console.log(`PAGEERROR[${name}]:`,String(e).slice(0,160)));
  return hits;
};
const ha = track(a,'A'), hb = track(b,'B');
await b.addInitScript(() => {
  window.__signals = [];
  const wrap = () => {
    if (!window.TMALive || window.TMALive.__wrapped) return;
    window.TMALive.__wrapped = true;
    const origReg = window.TMALive.register;
    window.TMALive.register = function(res, refresh, opts){
      return origReg.call(this, res, function(){
        window.__signals.push({ t: Date.now(), res });
        return refresh.apply(this, arguments);
      }, opts);
    };
  };
  const iv = setInterval(()=>{ wrap(); if(window.TMALive && window.TMALive.__wrapped) clearInterval(iv); }, 5);
  window.__traces = [];
  window.__live = [];
  const of = window.fetch;
  window.fetch = function(...args){
    const u = String(args[0]&&args[0].url ? args[0].url : args[0]);
    if (u.includes('/portal/cip/applications')) {
      window.__traces.push({ t: Date.now(), u: u.replace(location.origin,''), stack: new Error().stack.split('\n').slice(1,10).join(' | ') });
      { const st = new Error().stack;
        const viaPrefetch = /Vn|prefetchOtherLanes/.test(st.split('\n').slice(2,6).join(' '));
        (window.__keys=window.__keys||[]).push({ t: Date.now(), q: (u.split('?')[1]||''), via: viaPrefetch?'PREFETCH':'LOADER' }); }
    }
    return of.apply(this, args);
  };
});

for (const p of [a,b]) {
  await p.goto(`${BASE}/citizenship-applications?listTab=pre_approval`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2500);
}
// Confirm both sockets are live
for (const [p,n] of [[a,'A'],[b,'B']]) {
  const st = await p.evaluate(()=>({sock: (window.TMAMessagingRealtime&&window.TMAMessagingRealtime.socketId)||null}));
  console.log(`tab ${n} socketId:`, st.sock);
}
await a.waitForTimeout(2000);
const ma=ha.length, mb=hb.length;
const t0=Date.now();
console.log('--- both settled; firing ONE write from tab A, then 15s watch ---');
// One real write: assign an officer on the first row via the API, from tab A's page.
const wrote = await a.evaluate(async () => {
  const list = await fetch('/portal/cip/applications?perPage=1&page=1',{headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'same-origin'}).then(r=>r.json());
  const app = list.applications && list.applications[0];
  if (!app) return 'no app';
  const sid = (window.TMAMessagingRealtime && window.TMAMessagingRealtime.socketId) || '';
  const xsrf = decodeURIComponent((document.cookie.match(/XSRF-TOKEN=([^;]+)/)||[])[1]||'');
  const r = await fetch('/portal/cip/applications/'+app.id+'/messages', {
    method:'POST', credentials:'same-origin',
    headers:{'Accept':'application/json','Content-Type':'application/json','X-Requested-With':'XMLHttpRequest','X-XSRF-TOKEN':xsrf,'X-Socket-ID':sid},
    body: JSON.stringify({ body:'Loop probe message', lane:'internal' }),
  });
  return r.status;
});
console.log('write status:', wrote);
await a.waitForTimeout(40000);
const ia=ha.slice(ma), ib=hb.slice(mb);
console.log('tab A idle cip requests:', ia.length);
console.log('tab B idle cip requests:', ib.length);
const tally=x=>{const c={};x.forEach(h=>c[h.u]=(c[h.u]||0)+1);return c;};
console.log('A:',tally(ia)); console.log('B:',tally(ib));
console.log('A timeline:', ia.map(h=>`+${h.t-t0}ms ${h.u}`));
console.log('B timeline:', ib.map(h=>`+${h.t-t0}ms ${h.u}`));
const dbg = await b.evaluate(()=>{
  const st = {};
  st.url = location.pathname + location.search;
  return st;
});
console.log('tab B is on:', dbg.url);
const sig = await b.evaluate(()=>window.__signals||[]);
console.log('live refreshes in tab B:', sig.filter(s=>s.t>0).map(s=>s.res));
const keys = await b.evaluate(()=>window.__keys||[]);
console.log('key trace:', JSON.stringify(keys,null,1));
const tr = await b.evaluate(()=>{
  // How many CIP entries are registered on the live bus?
  const reg = [];
  return { traces: window.__traces||[], reg };
}).then(r=>r.traces);
console.log('\n=== TAB B post-write pre_approval CALLERS ===');
tr.filter(t=>t.u.includes('phase=pre_approval') && t.t>t0).forEach((t,i)=>console.log(`\n[${i}] +${t.t-t0}ms\n`, t.stack.replace(/https?:\/\/[^ )]*\//g,'').split(' | ').join('\n ')));
await a.screenshot({path:'tests/Browser/_scratch-cip-two-tabs.png'});
await browser.close();
