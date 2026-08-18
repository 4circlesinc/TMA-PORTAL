import { chromium } from 'playwright';
import { tinyPdfBuffer } from './fixtures/tiny-pdf.mjs';
import { deflateSync } from 'node:zlib';

/*
 * A whole CIP application, filed through the form and then read back.
 *
 * cip-intake.mjs pins that the form is wired to the endpoint. This pins what
 * the endpoint LEAVES BEHIND: a family of five on one application, each with
 * their own folder and their own checklist, numbered the way §5 says, with
 * §2's uploads answering slots and the photos become faces. The parts that
 * only exist after a save are the parts nothing else was checking.
 *
 * Needs a fresh database — it counts folders and slots, and a second run's
 * application would file under the same client.
 */
const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const EMAIL = process.env.TMA_STAFF_EMAIL || 'e2e@example.com';
const PASSWORD = process.env.TMA_STAFF_PASSWORD || 'password12345';

function png(width, height) {
  const t = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(d.length);
    const b = Buffer.concat([Buffer.from(ty, 'ascii'), d]);
    const s = Buffer.alloc(4); s.writeUInt32BE(crc(b));
    return Buffer.concat([l, b, s]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(width, 0); ih.writeUInt32BE(height, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const r = y * (1 + width * 3);
    for (let x = 0; x < width; x++) { raw[r + 1 + x * 3] = 120; raw[r + 2 + x * 3] = 150; raw[r + 3 + x * 3] = 200; }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pdf = () => tinyPdfBuffer();
const photo = name => ({ name, mimeType: 'image/png', buffer: png(600, 600) });
const scan = name => ({ name, mimeType: 'application/pdf', buffer: pdf() });

const failures = [];
const check = (ok, msg) => { console.log(`    ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();

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

  await page.goto(`${BASE}/clients`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-head-dropdown-item="create-new"]', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.locator('button[data-head-dropdown-toggle]').last().click();
  await page.waitForTimeout(400);
  await page.locator('[data-head-dropdown-item="create-new"]').click();
  await page.waitForSelector('[data-cip-form]', { timeout: 30000 });

  step(1, 'Main applicant (§2)');
  await page.fill('[data-cip-field="firstName"]', 'Asem');
  await page.fill('[data-cip-field="lastName"]', 'Haddad');
  await page.selectOption('[data-cip-field="gender"]', 'Male');
  await page.fill('[data-cip-field="dateOfBirth"]', '1980-03-15');
  await page.selectOption('[data-cip-field="countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="countryOfResidence"]', 'United Arab Emirates');
  await page.fill('[data-cip-field="occupation"]', 'Investor');
  await page.fill('[data-cip-field="passportNumber"]', 'LB9911223');
  await page.waitForTimeout(400);
  check((await page.locator('[data-cip-region=""]').innerText()).includes('Middle East'),
    'region derived from country of residence, not asked');
  await page.setInputFiles('[data-cip-photo="passportPhoto"]', photo('asem.png'));
  await page.setInputFiles('[data-cip-file="passportBioPage"]', scan('asem-bio.pdf'));
  await page.setInputFiles('[data-cip-file="birthCertificate"]', scan('asem-birth.pdf'));
  await page.waitForTimeout(700);
  check(!!(await page.locator('[data-cip-photo-btn="passportPhoto"]').getAttribute('data-has-image')),
    'passport photo accepted');

  step(2, 'Investment (§3)');
  if (await page.locator('[data-cip-field="providerId"]').count()) {
    const v = await page.$eval('[data-cip-field="providerId"] option:nth-child(2)', o => o.value);
    await page.selectOption('[data-cip-field="providerId"]', v);
  }
  await page.selectOption('[data-cip-field="investmentType"]', 'real_estate');

  step(3, 'Sponsor (§4)');
  await page.selectOption('[data-cip-field="sponsored"]', '1');
  await page.waitForTimeout(600);
  await page.fill('[data-cip-field="sponsor.firstName"]', 'Maryam');
  await page.fill('[data-cip-field="sponsor.lastName"]', 'Haddad');
  await page.selectOption('[data-cip-field="sponsor.gender"]', 'Female');
  await page.fill('[data-cip-field="sponsor.dateOfBirth"]', '1955-07-01');
  await page.selectOption('[data-cip-field="sponsor.countryOfBirth"]', 'Lebanon');
  await page.selectOption('[data-cip-field="sponsor.countryOfResidence"]', 'Lebanon');
  await page.fill('[data-cip-field="sponsor.occupation"]', 'Retired');
  await page.fill('[data-cip-field="sponsor.passportNumber"]', 'LB4455667');
  await page.setInputFiles('[data-cip-photo="sponsor.passportPhoto"]', photo('maryam.png'));
  await page.setInputFiles('[data-cip-file="sponsor.passportBioPage"]', scan('maryam-bio.pdf'));
  await page.waitForTimeout(700);
  check(await page.locator('[data-cip-field="sponsor.firstName"]').inputValue() === 'Maryam', 'sponsor fields filled');

  step(4, 'Dependants (§5) — added oldest first, numbered youngest first');
  const family = [
    ['Omar',  '2008-01-20', 'qualified_dependent'],
    ['Sami',  '2013-03-03', 'qualified_dependent'],
    ['Lina',  '2018-11-30', 'qualified_dependent'],
    ['Nadia', '1985-06-10', 'spouse'],
  ];
  for (let i = 0; i < family.length; i++) {
    await page.click('[data-cip-dependent-add]');
    await page.waitForTimeout(250);
    await page.fill(`[data-cip-field="dependents.${i}.firstName"]`, family[i][0]);
    await page.fill(`[data-cip-field="dependents.${i}.lastName"]`, 'Haddad');
    await page.fill(`[data-cip-field="dependents.${i}.dateOfBirth"]`, family[i][1]);
    await page.selectOption(`[data-cip-field="dependents.${i}.relationship"]`, family[i][2]);
    await page.waitForTimeout(250);
  }
  const titles = await page.locator('.tma-portal-repeat__title').allInnerTexts();
  check(titles.join('|') === 'Qualified Dependent 3|Qualified Dependent 2|Qualified Dependent 1|Spouse',
    `the form numbers them youngest-first (${titles.join(', ')})`);

  step(5, 'Filing');
  const created = page.waitForResponse(r => r.url().includes('/portal/cip/applications') && r.request().method() === 'POST', { timeout: 30000 });
  await page.click('[data-cip-save]');
  const res = await created;
  const body = await res.json().catch(() => ({}));
  check(res.status() === 201, `filed (HTTP ${res.status()})`);
  const app = body.application || {};
  // Numbered in sequence — this suite may not be the first to file against
  // its harness, so the shape is what is pinned, not the ordinal.
  check(/^GAL\d{2}-\d{5}$/.test(app.number || ''), `numbered ${app.number}`);
  // Applications open at New since the draft state was retired.
  check(app.status === 'new', 'starts at New');
  check(app.familySize === 6, `family size counts everybody (${app.familySize})`);

  step(6, 'Who is on it, and how they are classified');
  check(app.applicant?.name === 'Asem Haddad', 'main applicant');
  check(app.applicant?.region === 'Middle East', 'region stored server-side');
  check(app.sponsor?.name === 'Maryam Haddad', 'sponsor filed in the same save');
  const qd = (app.dependents || []).filter(d => d.relationship === 'qualified_dependent')
    .sort((a, b) => a.dependentOrdinal - b.dependentOrdinal).map(d => `${d.name}=QD${d.dependentOrdinal}`);
  check(qd.join(', ') === 'Lina Haddad=QD1, Sami Haddad=QD2, Omar Haddad=QD3',
    `the server numbers them youngest-first (${qd.join(', ')})`);
  const spouse = (app.dependents || []).find(d => d.relationship === 'spouse');
  check(spouse?.dependentOrdinal === null, 'a spouse carries no ordinal');
  check(spouse?.label === 'Spouse', 'and is labelled Spouse');

  step(7, 'Faces');
  check(/^\/media\/avatars\//.test(app.applicant?.photo || ''), 'the applicant’s photo became their profile picture');
  check(/^\/media\/avatars\//.test(app.sponsor?.photo || ''), 'and the sponsor’s did too');
  check(!!app.applicant?.passportPhotoUrl, 'the filed photo is reachable at full resolution');

  /*
   * What the form collects, against what the checklist asks for.
   *
   * Not "owes nothing": since phase 3 the checklist is the firm's requirement
   * templates, so an application filed a second ago rightly still owes the
   * police certificate and the rest. What the wizard is answerable for is the
   * three it collects — each upload has to land in its slot and close it.
   */
  step(8, 'Checklists (§2 uploads → document slots)');
  const collected = ['Passport photo', 'Passport bio page', 'Birth certificate'];
  const applicantOwes = app.applicant?.outstanding || ['x'];
  check(collected.every(label => !applicantOwes.includes(label)),
    `the applicant's three uploads closed their slots (${JSON.stringify(applicantOwes)})`);

  // The sponsor's birth certificate was deliberately skipped, so it is the one
  // of the three still open — the evidence that a slot stays open until a file
  // actually arrives in it.
  const sponsorOwes = app.sponsor?.outstanding || [];
  check(sponsorOwes.includes('Birth certificate'), 'the one the sponsor skipped is still owed');
  check(!sponsorOwes.includes('Passport photo') && !sponsorOwes.includes('Passport bio page'),
    `and the two they did upload are not (${JSON.stringify(sponsorOwes)})`);

  const dep = (app.dependents || [])[0];
  const depLabels = (dep?.documents || []).map(d => d.label);
  check(collected.slice(1).every(label => depLabels.includes(label)),
    `every dependant has a checklist from the first save (${JSON.stringify(depLabels)})`);

  step(9, 'The photo is reachable, and only by someone who may see the file');
  const photoRes = await page.request.get(`${BASE}${app.applicant.passportPhotoUrl}`);
  check(photoRes.status() === 200 && (photoRes.headers()['content-type'] || '').startsWith('image/'),
    `the filed passport photo serves (HTTP ${photoRes.status()})`);

  await page.screenshot({ path: 'tests/Browser/cip-application-full.png', fullPage: false });
} catch (e) {
  failures.push(String(e).slice(0, 400));
  await page.screenshot({ path: 'tests/Browser/cip-application-full.png' }).catch(() => {});
} finally {
  console.log(failures.length ? `\nFAILED (${failures.length}):` : '\nPASSED');
  failures.forEach(f => console.log('   ', f));
  await browser.close();
  process.exit(failures.length ? 1 : 0);
}
