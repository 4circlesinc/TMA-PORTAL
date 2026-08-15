import { chromium } from 'playwright';
import { deflateSync } from 'node:zlib';

// The CIP intake wizard (§2, §3). PHPUnit pins the endpoint; this pins that
// the form is wired to it — the steps advance, a missing answer stops the
// step, the region appears from the country, and filing lands a numbered
// draft. Needs an account that may create applications and FEATURE_CIP on.
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

/*
 * A solid PNG of a given size, built here rather than shipped as a fixture.
 * The passport-photo rules are about pixel dimensions, so the test needs to
 * name the dimensions it is testing — a checked-in image would hide them, and
 * two of them (600×900, 600×600) exist only to be measured.
 */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 8 bits per channel
  ihdr[9] = 2;   // truecolour RGB

  // One filter byte then RGB per pixel, per scanline.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = 200;
      raw[row + 2 + x * 3] = 210;
      raw[row + 3 + x * 3] = 220;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* The smallest thing a mime sniffer will call a PDF. */
function pdf() {
  return Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
}

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })).newPage();

try {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('button[type="submit"]:visible')]);
  await page.waitForTimeout(700);
  if (page.url().includes('/auth/stay-signed-in')) {
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), page.click('text=Yes, stay signed in')]);
    await page.waitForTimeout(700);
  }

  step(1, 'The wizard opens from Create New Application');
  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  // The hub loads its directory first; the create control lives in the head.
  for (let i = 0; i < 30 && !(await page.locator('[data-head-dropdown-toggle]').count()); i++) await page.waitForTimeout(500);
  const toggles = page.locator('[data-head-dropdown-toggle]');
  for (let i = 0; i < await toggles.count(); i++) {
    if ((await toggles.nth(i).innerText()).includes('Create New Application')) { await toggles.nth(i).click(); break; }
  }
  await page.waitForTimeout(500);
  await page.click('[data-head-dropdown-item="create-new"]');
  await page.waitForSelector('[data-cip-form]', { timeout: 25000 });
  check(await page.locator('[data-cip-field="firstName"]').count() > 0, 'the form rendered');
  check(await page.locator('[data-cip-save]').count() > 0, 'the toolbar carries Add');

  step(2, 'Add with nothing filled in refuses, and says how much is missing');
  await page.click('[data-cip-save]');
  await page.waitForTimeout(600);
  check(await page.locator('.tma-portal-field__error').count() > 0, 'missing answers are named');
  check((await page.locator('[data-cip-form]').innerText()).includes('Check '), 'a summary says how many');

  step(3, 'The whole form is on one page');
  const formText = await page.locator('[data-cip-form]').innerText();
  check(formText.includes('Main applicant') && formText.includes('Investment'), 'both sections visible at once');
  check(await page.locator('[data-cip-next], [data-cip-back]').count() === 0, 'no step buttons');

  step(4, 'The region follows the country of residence');
  await page.fill('[data-cip-field="firstName"]', 'John');
  await page.fill('[data-cip-field="lastName"]', 'Smith');
  await page.selectOption('[data-cip-field="gender"]', 'Male');
  await page.fill('[data-cip-field="dateOfBirth"]', '1985-04-12');
  await page.selectOption('[data-cip-field="countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="countryOfResidence"]', 'United Arab Emirates');
  await page.waitForTimeout(500);
  check((await page.locator('[data-cip-region]').innerText()).includes('Middle East'), 'region derived as Middle East');
  await page.fill('[data-cip-field="occupation"]', 'Engineer');
  await page.fill('[data-cip-field="passportNumber"]', 'X1234567');

  step('4b', 'The passport photo is measured before it is accepted');
  // A portrait snapshot is what people actually pick, so it is what the
  // check has to refuse — and it must say so without a round trip.
  await page.setInputFiles('[data-cip-photo="passportPhoto"]', {
    name: 'portrait.png', mimeType: 'image/png', buffer: png(600, 900),
  });
  await page.waitForTimeout(600);
  check((await page.locator('[data-cip-form]').innerText()).includes('has to be square'),
    'a portrait photo is refused, with the measurement');
  check(!(await page.locator('[data-cip-photo-btn="passportPhoto"]').getAttribute('data-has-image')),
    'and is not kept');

  await page.setInputFiles('[data-cip-photo="passportPhoto"]', {
    name: 'passport.png', mimeType: 'image/png', buffer: png(600, 600),
  });
  await page.waitForTimeout(600);
  check(!!(await page.locator('[data-cip-photo-btn="passportPhoto"]').getAttribute('data-has-image')),
    'a 2×2 photo is accepted and previewed');

  step('4c', 'The other two §2 uploads');
  await page.setInputFiles('[data-cip-file="passportBioPage"]', {
    name: 'bio.pdf', mimeType: 'application/pdf', buffer: pdf(),
  });
  await page.setInputFiles('[data-cip-file="birthCertificate"]', {
    name: 'birth.pdf', mimeType: 'application/pdf', buffer: pdf(),
  });
  await page.waitForTimeout(600);
  check((await page.locator('[data-cip-form]').innerText()).includes('bio.pdf'),
    'a chosen document is named back');

  step(5, 'Investment: Other asks what it is');
  await page.selectOption('[data-cip-field="investmentType"]', 'other');
  await page.waitForTimeout(400);
  check(await page.locator('[data-cip-field="investmentTypeOther"]').count() > 0, 'the specify field appears for Other');
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
  await page.waitForTimeout(400);
  check(await page.locator('[data-cip-field="investmentTypeOther"]').count() === 0, 'and goes away again');

  if (await page.locator('[data-cip-field="providerId"]').count()) {
    const value = await page.$eval('[data-cip-field="providerId"] option:nth-child(2)', o => o.value);
    await page.selectOption('[data-cip-field="providerId"]', value);
  }

  step('5b', 'Sponsored = Yes asks for the sponsor there and then (§4)');
  await page.selectOption('[data-cip-field="sponsored"]', '1');
  await page.waitForTimeout(500);
  check(await page.locator('[data-cip-field="sponsor.firstName"]').count() > 0,
    'the sponsor card appears');
  await page.selectOption('[data-cip-field="sponsored"]', '0');
  await page.waitForTimeout(400);
  check(await page.locator('[data-cip-field="sponsor.firstName"]').count() === 0,
    'and goes away when the answer changes back');
  await page.selectOption('[data-cip-field="sponsored"]', '1');
  await page.waitForTimeout(500);
  await page.fill('[data-cip-field="sponsor.firstName"]', 'Maryam');
  await page.fill('[data-cip-field="sponsor.lastName"]', 'Haddad');
  await page.selectOption('[data-cip-field="sponsor.gender"]', 'Female');
  await page.fill('[data-cip-field="sponsor.dateOfBirth"]', '1960-02-02');
  await page.selectOption('[data-cip-field="sponsor.countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="sponsor.countryOfResidence"]', 'Lebanon');
  await page.fill('[data-cip-field="sponsor.occupation"]', 'Retired');
  await page.fill('[data-cip-field="sponsor.passportNumber"]', 'S7654321');
  await page.setInputFiles('[data-cip-photo="sponsor.passportPhoto"]', {
    name: 'sponsor.png', mimeType: 'image/png', buffer: png(600, 600),
  });
  await page.waitForTimeout(600);

  step('5c', 'Dependents number themselves as they are added (§5)');
  // Added oldest first on purpose: if the form echoed the order they were
  // typed in rather than computing it, this would read 1, 2, 3.
  const family = [
    ['Omar', '2010-05-05', 'qualified_dependent'],
    ['Lina', '2016-09-09', 'qualified_dependent'],
    ['Sami', '2013-03-03', 'qualified_dependent'],
    ['Nadia', '1990-01-01', 'spouse'],
  ];
  for (let i = 0; i < family.length; i++) {
    await page.click('[data-cip-dependent-add]');
    await page.waitForTimeout(300);
    await page.fill(`[data-cip-field="dependents.${i}.firstName"]`, family[i][0]);
    await page.fill(`[data-cip-field="dependents.${i}.lastName"]`, 'Smith');
    await page.fill(`[data-cip-field="dependents.${i}.dateOfBirth"]`, family[i][1]);
    await page.selectOption(`[data-cip-field="dependents.${i}.relationship"]`, family[i][2]);
    await page.waitForTimeout(300);
  }
  const titles = await page.locator('.tma-portal-repeat__title').allInnerTexts();
  check(titles[0] === 'Qualified Dependent 3' && titles[1] === 'Qualified Dependent 1'
    && titles[2] === 'Qualified Dependent 2' && titles[3] === 'Spouse',
    `numbered from the youngest, not the order typed (${titles.join(', ')})`);

  // Removing one closes the gap rather than leaving a hole in the list.
  await page.click('[data-cip-dependent-remove="0"]');
  await page.waitForTimeout(400);
  check(await page.locator('.tma-portal-repeat').count() === 3, 'a dependent can be removed');
  check((await page.locator('[data-cip-field="dependents.0.firstName"]').inputValue()) === 'Lina',
    'and the rows below shuffle up');

  step(6, 'Filing creates a numbered draft');
  const created = page.waitForResponse(r => r.url().includes('/portal/cip/applications') && r.request().method() === 'POST', { timeout: 20000 });
  await page.click('[data-cip-save]');
  const res = await created;
  check(res.status() === 201, `filed (HTTP ${res.status()})`);
  const body = await res.json().catch(() => ({}));
  check(/^[A-Z]{2,8}\d{2}-\d{5}$/.test(body?.application?.number || ''), `numbered ${body?.application?.number}`);
  check(body?.application?.status === 'draft', 'starts as a draft');
  check(body?.application?.applicant?.region === 'Middle East', 'region stored server-side');
  check(/^\/media\/avatars\//.test(body?.application?.applicant?.photo || ''),
    'the passport photo became the applicant’s profile picture');
  check((body?.application?.applicant?.outstanding || ['x']).length === 0,
    '§2’s three uploads answered their slots');
  check(body?.application?.sponsor?.name === 'Maryam Haddad', 'the sponsor was filed with it');
  const filed = (body?.application?.dependents || [])
    .filter(d => d.relationship === 'qualified_dependent')
    .sort((a, b) => a.dependentOrdinal - b.dependentOrdinal)
    .map(d => d.name);
  check(filed.join(', ') === 'Lina Smith, Sami Smith',
    `the server numbered them the same way (${filed.join(', ')})`);

  await page.screenshot({ path: 'tests/Browser/cip-intake.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 300));
  await page.screenshot({ path: 'tests/Browser/cip-intake.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
