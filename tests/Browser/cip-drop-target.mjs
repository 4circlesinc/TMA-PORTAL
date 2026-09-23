import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A drop on the documents column has to land in the box it was dropped on.
 *
 * The requirement list changes after the zones are first wired: a document
 * asked only of women appears when Gender is set, an Add-On type swaps the
 * whole column, a dependent's date of birth switches their checklist. Morph
 * reuses the box, so a listener that remembered the path from wiring files
 * the scan under the requirement that used to sit there.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requirements = {
  principal: [
    { field: 'affidavitOfSupport', key: 'affidavit_of_support', label: 'Affidavit of Support', required: true, femaleOnly: true },
    { field: 'sl1Form', key: 'sl1_form', label: 'SL1 Form', required: true },
    { field: 'sl2aForm', key: 'sl2a_form', label: 'SL2A Form', required: true },
    { field: 'birthCertificate', key: 'birth_certificate', label: 'Birth certificate', required: true },
  ],
};

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log((ok ? 'ok  ' : 'FAIL') + '  ' + message);
};

await page.route('http://intake.test/**', (route) => {
  const url = route.request().url();
  if (url.includes('/portal/cip/applications/form')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requirements,
        providers: [{ id: '1', name: 'Galaxy', code: 'GAL' }],
        investmentTypes: [{ value: 'real_estate', label: 'Real estate' }],
        countries: [{ value: 'Saint Lucia', label: 'Saint Lucia' }],
        genders: ['Female', 'Male'],
        addonTypes: [],
        addonRelationships: [],
        enterpriseCategories: [],
      }),
    });
  }
  return route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<div id="mount"></div>',
  });
});
await page.goto('http://intake.test/');
await page.addScriptTag({ path: path.join(root, 'public/js/dom-morph.js') });
await page.evaluate(() => {
  window.TMAPortalUI = {
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c])),
    loading: () => '<p data-cip-loading>Loading…</p>',
  };
});
await page.addScriptTag({ path: path.join(root, 'public/js/cip-intake.js') });

await page.evaluate(() => {
  window.TMACipIntake.open(document.getElementById('mount'), { phase: 'pre_approval' });
});
await page.waitForSelector('[data-cip-drop="sl1Form"]');

async function dropOn(selector, name) {
  await page.locator(selector).evaluate((zone, fileName) => {
    const file = new File(['scan'], fileName, { type: 'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, name);
  await page.waitForTimeout(50);
}

await dropOn('[data-cip-drop="sl1Form"]', 'sl1.pdf');
check(
  (await page.locator('[data-cip-drop="sl1Form"]').innerText()).includes('sl1.pdf'),
  'a drop on SL1 Form is listed under SL1 Form',
);
check(
  !(await page.locator('[data-cip-drop="sl2aForm"]').innerText()).includes('sl1.pdf'),
  'and is not listed under SL2A Form',
);

await page.selectOption('[data-cip-field="gender"]', 'Female');
await page.waitForSelector('[data-cip-drop="affidavitOfSupport"]');

await dropOn('[data-cip-drop="affidavitOfSupport"]', 'affidavit.pdf');
check(
  (await page.locator('[data-cip-drop="affidavitOfSupport"]').innerText()).includes('affidavit.pdf'),
  'after Gender adds a requirement above it, a drop on that box stays there',
);
check(
  (await page.locator('[data-cip-drop="sl1Form"]').innerText()).includes('sl1.pdf')
    && !(await page.locator('[data-cip-drop="sl1Form"]').innerText()).includes('affidavit.pdf'),
  'and the earlier SL1 file is still on SL1, not replaced by the new drop',
);

await page.locator('[data-cip-file="sl2aForm"]').setInputFiles({
  name: 'sl2.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.1'),
});
await page.waitForTimeout(50);
check(
  (await page.locator('[data-cip-drop="sl2aForm"]').innerText()).includes('sl2.pdf'),
  'choosing a file from the SL2A box files it there',
);

await browser.close();
if (failures.length) {
  console.error('\n' + failures.length + ' failed');
  process.exit(1);
}
