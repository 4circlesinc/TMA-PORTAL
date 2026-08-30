/*
 * Deep links for clients.
 *
 * clients.js has pushed these paths and parsed them back for a long time, but
 * nothing served them — so the URL was right until you reloaded, and a link
 * sent to a colleague opened the directory. The reload is the whole test.
 *
 *   TMA_BASE_URL=http://127.0.0.1:8901 TMA_DB=$DB node tests/Browser/client-deep-links.mjs
 */
import { chromium } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8901'
const DB = process.env.TMA_DB
let failures = 0
const check = (ok, label) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`); if (!ok) failures += 1 }

const stamp = String(process.pid)
await run('php', ['artisan', 'tinker', '--execute', `
  $u = App\\Models\\User::where('email','e2e@example.com')->firstOrFail();
  App\\Models\\Client::create(['uid'=>'deep-${stamp}','name'=>'Deep Client ${stamp}','email'=>'d${stamp}@example.com','data'=>[],'created_by'=>$u->id]);
  echo 'ok';
`], { env: { ...process.env, DB_CONNECTION: 'sqlite', DB_DATABASE: DB, DB_URL: '' } })

const b = await chromium.launch()
const page = await b.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))
await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' })
await page.click('text=Sign in with Email')
await page.waitForSelector('input[name="email"]', { state: 'visible' })
await page.fill('input[name="email"]', 'e2e@example.com')
await page.fill('input[name="password"]', 'password12345')
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button[type="submit"]:visible')])
await page.waitForTimeout(400)
if (page.url().includes('/auth/stay-signed-in')) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('button:has-text("Yes, stay signed in")')])
}

console.log('\nClient deep links\n')

// A link straight to a client, as a colleague would receive it.
const r = await page.goto(`${BASE}/citizenship-applications/deep-${stamp}`, { waitUntil: 'networkidle' })
check(r.status() === 200, `an application URL is served (${r.status()})`)
await page.waitForTimeout(3000)

check(page.url().includes(`/citizenship-applications/deep-${stamp}`), 'the URL survives the load')
check(await page.evaluate((n) => document.body.innerText.includes(n), `Deep Client ${stamp}`),
  'it opens on that application, not the directory')

// And a reload from there stays put.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
check(page.url().includes(`/citizenship-applications/deep-${stamp}`), 'a reload keeps the application in the URL')
check(await page.evaluate((n) => document.body.innerText.includes(n), `Deep Client ${stamp}`),
  'and still shows that client')

await b.close()
console.log(failures === 0 ? '\nPASS\n' : `\n${failures} failure(s)\n`)
process.exit(failures === 0 ? 0 : 1)
