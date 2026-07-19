import { chromium } from 'playwright';
const BASE='http://127.0.0.1:8000';
const b=await chromium.launch();
async function shortcutGroups(email){
  const p=await b.newPage({viewport:{width:1400,height:1000}});
  await p.goto(`${BASE}/auth/login`,{waitUntil:'domcontentloaded',timeout:45000});
  await p.click('text=Sign in with Email'); await p.waitForSelector('input[name="email"]',{state:'visible'});
  await p.fill('input[name="email"]',email); await p.fill('input[name="password"]','password12345');
  await Promise.all([p.waitForNavigation({waitUntil:'domcontentloaded'}).catch(()=>{}), p.click('button[type="submit"]:visible')]);
  await p.goto(`${BASE}/`,{waitUntil:'domcontentloaded',timeout:45000}); await p.waitForTimeout(800);
  await p.click('.tma-dash__sidebar .tma-dash__tab:has-text("Folder Shortcuts")').catch(()=>{});
  await p.waitForSelector('[data-shortcuts]',{timeout:10000}); await p.waitForTimeout(1000);
  const info=await p.evaluate(()=>({ labels:[...document.querySelectorAll('[data-shortcuts] .tma-dash__group-label')].map(l=>l.textContent.trim()), text:document.querySelector('[data-shortcuts]').innerText.replace(/\s+/g,' ') }));
  await p.close();
  return info;
}
console.log('ADMIN:', JSON.stringify(await shortcutGroups('e2e@example.com')));
console.log('STAFF:', JSON.stringify(await shortcutGroups('e2estaff@example.com')));
await b.close();
