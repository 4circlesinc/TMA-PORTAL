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

  /*
   * Two headings sit above their card; every other card keeps its own.
   *
   * The ones held outside name a PERSON on the application. Applying that to
   * every card was the wrong reading of it, so this pins which is which
   * rather than leaving the next change to guess.
   */
  const outside = await page.locator('.tma-portal-section > .tma-portal-section__title')
    .evaluateAll(hs => hs.map(h => h.textContent.trim()));
  check(outside.join('|') === 'Main applicant|Dependents',
    `only the person sections carry their name outside (${outside.join(', ')})`);
  const inside = await page.locator('.tma-dash__clients-card .tma-dash__clients-card-title')
    .evaluateAll(hs => hs.map(h => h.textContent.trim()));
  check(inside.includes('Documents') && inside.includes('Investment'),
    `the rest keep their title in the card (${inside.join(', ')})`);

  /*
   * The asterisks mark exactly what the save would stop for.
   *
   * A mark that is decoration is worse than none — it teaches a reader to
   * ignore it. So this checks the two that move: "Specify investment type"
   * gains its mark only when Other is picked, and a sponsor's optional scans
   * never carry one even though the applicant's identical controls do.
   */
  step('3b', 'Required fields are marked, and only those');
  const starred = () => page.evaluate(() => {
    const out = {};
    document.querySelectorAll('.tma-portal-field__label').forEach(l => {
      out[l.textContent.replace('*', '').trim()] = !!l.querySelector('.tma-portal-field__required');
    });

    return out;
  });
  let marks = await starred();
  check(marks['First name'] && marks['Passport photo'] && marks['Birth certificate'],
    'the applicant’s fields and uploads are marked');
  check(marks['Specify investment type'] === undefined, 'a hidden conditional field has no mark yet');
  check(await page.locator('[data-cip-field="firstName"]').getAttribute('aria-required') === 'true',
    'and the control says so to a screen reader');

  await page.selectOption('[data-cip-field="investmentType"]', 'other');
  await page.waitForTimeout(400);
  marks = await starred();
  check(marks['Specify investment type'] === true, 'Other reveals a field that is marked');
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');
  await page.waitForTimeout(400);

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

  /*
   * One requirement, several files.
   *
   * A bio page is often a passport's two pages, so the control has to add
   * rather than replace — and the way to add the second must still be there
   * after the first, which is why the prompt stays and the files are listed
   * under it. The icon is checked because a generic sheet of paper for every
   * file is what this was reported as: it must be the File Library's own PDF
   * mark, and an image must not get the same one.
   */
  await page.setInputFiles('[data-cip-file="passportBioPage"]', [
    { name: 'bio-page-2.pdf', mimeType: 'application/pdf', buffer: pdf() },
    { name: 'bio-scan.png', mimeType: 'image/png', buffer: png(40, 40) },
  ]);
  await page.waitForTimeout(600);

  const listed = page.locator('[data-cip-drop="passportBioPage"] .tma-portal-drop__file');
  check(await listed.count() === 3, `all three files are listed (${await listed.count()})`);
  check((await page.locator('[data-cip-drop="passportBioPage"]').innerText()).includes('Drop another file here'),
    'the zone still offers to take another');

  const icons = await page.locator('[data-cip-drop="passportBioPage"] .tma-portal-drop__file-icon')
    .evaluateAll(imgs => imgs.map(i => i.getAttribute('src')));
  check(icons[0].includes('FilePdf'), `a PDF gets the PDF mark (${icons[0]})`);
  check(icons[2].includes('FileImage'), `an image gets the image mark (${icons[2]})`);

  /*
   * The two boxes on this row are one box tall.
   *
   * Checked with files in, which is the harder half: the documents card grows
   * as they are listed, and the applicant's card has to grow with it. The
   * card is measured, not the section around it — the section includes the
   * heading held above it, and comparing those would pass while the boxes a
   * reader sees were an eyebrow apart.
   */
  const edges = async sel => page.locator(sel).evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  const applicantBox = await edges('.tma-portal-section--wide > .tma-portal-section__card');
  const documentsBox = await edges('.tma-dash__clients-card--narrow');
  check(Math.abs(applicantBox.top - documentsBox.top) <= 1
    && Math.abs(applicantBox.bottom - documentsBox.bottom) <= 1,
    `the applicant and documents cards are the same box (${applicantBox.top}–${applicantBox.bottom} vs ${documentsBox.top}–${documentsBox.bottom})`);

  // Removing one takes that one, not the list.
  await page.locator('[data-cip-drop="passportBioPage"] .tma-portal-drop__file-remove').nth(1).click();
  await page.waitForTimeout(400);
  check(await listed.count() === 2, 'a file can be removed on its own');

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

  // A person is a person: the sponsor gets the applicant's row — their name
  // above the box, fields two to a row, their own documents beside them.
  check((await page.locator('.tma-portal-section > .tma-portal-section__title')
    .evaluateAll(hs => hs.map(h => h.textContent.trim()))).includes('Sponsor'),
    'and carries its name outside the card, like the other person sections');
  check(await page.locator('[data-cip-drop="sponsor.passportBioPage"]').count() > 0
    && await page.locator('[data-cip-drop="sponsor.birthCertificate"]').count() > 0,
    'with its own documents card');
  // Box against box, not box against heading: the documents card is dropped
  // by exactly the heading it does not have, so it is the section's CARD its
  // top edge has to meet.
  check(await page.evaluate(() => {
    const box = [...document.querySelectorAll('.tma-portal-section')]
      .find(el => el.querySelector('[data-cip-field="sponsor.firstName"]'))
      .querySelector('.tma-portal-section__card').getBoundingClientRect();
    const docs = [...document.querySelectorAll('.tma-dash__clients-card--narrow')]
      .find(el => el.querySelector('[data-cip-drop="sponsor.passportBioPage"]'))
      .getBoundingClientRect();

    return Math.abs(box.top - docs.top) < 4
      && Math.abs(box.bottom - docs.bottom) < 4
      && docs.left > box.right - 2;
  }), 'on the same row and the same height, the way the applicant’s is');

  // ...but not marked required, because they are not. The applicant's two
  // identical controls are, which is the whole point of marking anything.
  check(await page.evaluate(() => {
    const docs = [...document.querySelectorAll('.tma-dash__clients-card--narrow')]
      .find(el => el.querySelector('[data-cip-drop="sponsor.passportBioPage"]'));

    return [...docs.querySelectorAll('.tma-portal-field__label')]
      .every(l => !l.querySelector('.tma-portal-field__required'));
  }), 'whose scans are offered, not demanded, and carry no asterisk');
  check(await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.tma-portal-section')]
      .find(el => el.querySelector('[data-cip-field="sponsor.firstName"]'));

    return [...sec.querySelectorAll('.tma-portal-field__label')]
      .every(l => !!l.querySelector('.tma-portal-field__required'));
  }), 'while every field the sponsor must answer is marked');

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
  /*
   * The three the form collects are answered. Not "nothing is outstanding":
   * since phase 3 the checklist is the firm's requirement templates, so an
   * application filed a second ago rightly still owes the rest of them.
   */
  const stillOwed = body?.application?.applicant?.outstanding || ['x'];
  const collected = ['Passport photo', 'Passport bio page', 'Birth certificate'];
  check(collected.every(label => !stillOwed.includes(label)),
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
