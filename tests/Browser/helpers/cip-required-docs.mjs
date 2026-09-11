/**
 * Attach every Document Requirements upload the current form still owes.
 *
 * Add follows those settings. Browser tests that used to send only the
 * section-2 three have to fill the rest before clicking it.
 */
export async function attachRequiredDocuments(page, prefix, section, files) {
  const phase = await page.evaluate(() => {
    const form = document.querySelector('[data-cip-form]');
    return form && form.getAttribute('data-cip-phase');
  });
  const url = phase === 'post_approval'
    ? '/portal/cip/applications/form?phase=post_approval'
    : '/portal/cip/applications/form';
  const json = await page.request.get(url, { headers: { Accept: 'application/json' } }).then((r) => r.json());
  const reqs = (json.requirements && json.requirements[section]) || [];

  for (const doc of reqs) {
    if (!doc.required) continue;
    const sel = `[data-cip-file="${prefix}${doc.field}"]`;
    if (!(await page.locator(sel).count())) continue;
    const listed = await page.locator(`[data-cip-drop="${prefix}${doc.field}"] .tma-portal-drop__file`).count();
    if (listed > 0) continue;
    await page.setInputFiles(sel, {
      name: `${doc.field}.pdf`,
      mimeType: 'application/pdf',
      buffer: files.pdf,
    });
  }

  const photoKey = section === 'principal' ? 'principal' : section;
  const photoWanted = !!(json.photoRequired && json.photoRequired[photoKey]);
  const photoSel = `[data-cip-photo="${prefix}passportPhoto"]`;
  if (photoWanted && await page.locator(photoSel).count()) {
    const has = await page.locator(`[data-cip-photo-btn="${prefix}passportPhoto"]`).getAttribute('data-has-image');
    if (!has) {
      await page.setInputFiles(photoSel, {
        name: `${prefix || 'principal'}photo.png`,
        mimeType: 'image/png',
        buffer: files.png,
      });
    }
  }
}

export async function attachFamilyDocuments(page, dependentCount, files) {
  await attachRequiredDocuments(page, '', 'principal', files);
  if (await page.locator('[data-cip-field="sponsor.firstName"]').count()) {
    await attachRequiredDocuments(page, 'sponsor.', 'sponsor', files);
  }
  for (let i = 0; i < dependentCount; i++) {
    const relationship = await page.locator(`[data-cip-field="dependents.${i}.relationship"]`).inputValue().catch(() => '');
    const dob = await page.locator(`[data-cip-field="dependents.${i}.dateOfBirth"]`).inputValue().catch(() => '');
    let section = 'dependent_16_over';
    if (relationship === 'spouse') section = 'spouse';
    else if (dob) {
      const birth = new Date(`${dob}T00:00:00`);
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
      section = age < 16 ? 'dependent_under_16' : 'dependent_16_over';
    }
    await attachRequiredDocuments(page, `dependents.${i}.`, section, files);
  }
}
