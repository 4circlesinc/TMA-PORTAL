import { chromium } from 'playwright';

// Compose can leave the reading pane for a real window of its own.
//
// In the desktop app that is an Electron BrowserWindow (see
// desktop/compose-window.js). On the web it is a same-origin popup of
// /email/compose, never a new tab of the whole mailbox. This drives the
// pop-out control, the URL it asks for, and the chrome-less composer that
// URL paints.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const log = (...a) => console.log(...a);
const failures = [];
const pageErrors = [];

function step(n, msg) { log(`\n[${n}] ${msg}`); }
function check(ok, msg) {
  log(`    ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));

async function signIn() {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible', timeout: 8000 });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);
  await page.waitForTimeout(500);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"]:visible'),
    ]);
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/auth/login')) throw new Error('login failed');
}

try {
  step(1, 'Open New Mail and pop the composer out');
  await signIn();
  await page.goto(`${BASE}/email`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-folder="compose"]', { timeout: 20000 });
  await page.click('[data-email-folder="compose"]');
  await page.waitForSelector('[data-email-compose-overlay].is-open', { timeout: 8000 });
  await page.waitForSelector('[data-email-compose-popout]', { timeout: 8000 });

  check(
    !!(await page.$('[data-email-compose-popout]')),
    'the pane composer offers Open in new window',
  );

  await page.fill('[data-email-compose-field="subject"]', 'Popped out');
  await page.evaluate(() => {
    window.__tmaOpened = null;
    window.open = function (url, name, features) {
      window.__tmaOpened = {
        url: String(url),
        name: String(name || ''),
        features: String(features || ''),
      };
      return { closed: false, close() {}, focus() {} };
    };
  });
  await page.click('[data-email-compose-popout]');
  await page.waitForTimeout(400);

  const opened = await page.evaluate(() => window.__tmaOpened);
  check(!!opened, 'pop-out called window.open (an app window in Electron)');
  check(
    !!(opened && /\/email\/compose/.test(opened.url)),
    'it asked for /email/compose, not a browser mailto or an external site'
      + (opened ? ` (got ${opened.url})` : ''),
  );
  check(
    !!(opened && String(opened.features || '').indexOf('popup=yes') !== -1),
    'features ask for a popup window rather than a tab',
  );
  check(
    !(await page.$('[data-email-compose-overlay].is-open')),
    'the reading-pane composer closes once the window is asked for',
  );

  step(2, 'The compose URL is a chrome-less composer');
  await page.evaluate(() => {
    window.sessionStorage.setItem('tma.mail.compose-popout.compose-test', JSON.stringify({
      id: 'compose-test',
      to: 'client@example.com',
      cc: '',
      bcc: '',
      subject: 'Popped out',
      bodyHtml: '<p>Hello from the other window</p>',
      showCc: false,
      serverId: null,
      mode: 'new',
      inReplyTo: null,
      attachments: [],
      signatureId: '',
      _typing: {},
    }));
  });
  await page.goto(`${BASE}/email/compose?draft=compose-test`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-email-compose-field="subject"]', { timeout: 15000 });
  await page.waitForTimeout(400);

  const chrome = await page.evaluate(() => {
    const dash = document.querySelector('.tma-dash');
    const sidebar = document.querySelector('.tma-dash__sidebar');
    const list = document.querySelector('.tma-dash__email-list');
    const popout = document.querySelector('[data-email-compose-popout]');
    const subject = document.querySelector('[data-email-compose-field="subject"]');
    const visible = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    };
    return {
      popoutClass: !!(dash && dash.classList.contains('tma-dash--compose-popout'))
        || document.documentElement.classList.contains('tma-dash--compose-popout'),
      sidebar: visible(sidebar),
      list: visible(list),
      popoutBtn: visible(popout),
      subject: subject ? subject.value : '',
    };
  });

  check(chrome.popoutClass, 'the shell marks itself as a compose pop-out');
  check(!chrome.sidebar, 'the app sidebar is gone');
  check(!chrome.list, 'the inbox list is gone');
  check(!chrome.popoutBtn, 'Open in new window is hidden once already popped out');
  check(chrome.subject === 'Popped out', `the draft survived the hop (subject="${chrome.subject}")`);
  check(
    !!(await page.$('[data-email-compose-send]')),
    'Send is still there',
  );

  if (pageErrors.length) {
    log('\npage errors:\n' + pageErrors.slice(0, 8).join('\n'));
  }
} catch (err) {
  failures.push(String(err && err.stack ? err.stack : err));
  log('\nERROR', err);
} finally {
  await browser.close();
  if (failures.length) {
    log(`\nFAILED — ${failures.length} check(s)`);
    failures.forEach((f) => log('  - ' + f));
    process.exit(1);
  }
  log('\nOK');
}
