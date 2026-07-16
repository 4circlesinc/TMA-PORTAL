// Verifies the end product: after a real signing, the signed PDF in the
// library must carry the signature at the position the editor showed, on the
// right page, with the original left intact.
import { chromium } from 'playwright';

const BASE = process.env.TMA_BASE_URL || 'http://127.0.0.1:8899';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const step = (n, m) => log(`\n[${n}] ${m}`);

try {
  step(1, 'Owner sends a request with a signature field low on page 2');
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.click('text=Sign in with Email');
  await page.waitForSelector('input[name="email"]', { state: 'visible' });
  await page.fill('input[name="email"]', 'e2e@example.com');
  await page.fill('input[name="password"]', 'password12345');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
    page.click('button[type="submit"]:visible'),
  ]);

  // Drive the API directly: the editor is already covered by its own test,
  // and this one is about what comes out the far end.
  const built = await page.evaluate(async () => {
    const csrf = decodeURIComponent(
      (document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) || [])[1] || ''
    );
    const send = (url, method, body) =>
      fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': csrf },
        body: body ? JSON.stringify(body) : undefined,
      }).then((r) => r.json());

    const docs = await fetch('/portal/signatures/documents', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    const created = await send('/portal/signatures', 'POST', { fileId: docs.files[0].id });
    const id = created.request.id;
    const patched = await send('/portal/signatures/' + id, 'PATCH', {
      recipients: [{ name: 'Dana Reed', email: 'dana@example.com' }],
    });
    const recipient = patched.request.recipients[0].id;
    // Bottom-left of page 2, and a name field mid-page 1.
    await send('/portal/signatures/' + id + '/fields', 'PUT', {
      fields: [
        { type: 'signature', recipient, page: 2, x: 0.12, y: 0.78, width: 0.3, height: 0.07 },
        { type: 'name', recipient, page: 1, x: 0.12, y: 0.45, width: 0.35, height: 0.04 },
      ],
    });
    await send('/portal/signatures/' + id + '/send', 'POST', {});
    const links = await fetch('/portal/signatures/' + id + '/links', { headers: { Accept: 'application/json' } }).then((r) => r.json());
    return { id, url: links.links[0].url };
  });
  log('    request:', built.id);

  step(2, 'Recipient signs with a drawn signature');
  const signer = await (await browser.newContext()).newPage();
  await signer.goto(built.url, { waitUntil: 'networkidle' });
  await signer.waitForTimeout(3000);

  // The signature field is on page 2.
  const fields = await signer.$$('[data-field]');
  log('    fields shown:', fields.length);
  const sigEl = await signer.$('[aria-label^="Signature"]');
  await sigEl.scrollIntoViewIfNeeded();
  await sigEl.click();
  await signer.waitForTimeout(400);

  const pad = await signer.$('[data-pad]');
  const box = await pad.boundingBox();
  await signer.mouse.move(box.x + 25, box.y + 100);
  await signer.mouse.down();
  await signer.mouse.move(box.x + 100, box.y + 35, { steps: 8 });
  await signer.mouse.move(box.x + 175, box.y + 130, { steps: 8 });
  await signer.mouse.move(box.x + 250, box.y + 45, { steps: 8 });
  await signer.mouse.up();
  await signer.waitForTimeout(250);
  await signer.click('[data-apply]');
  await signer.waitForTimeout(700);

  await signer.click('[data-finish]');
  await signer.waitForTimeout(2500);
  log('    signer finished:', /you're done/i.test(await signer.textContent('body')));

  step(3, 'The signed copy exists in the library, separate from the original');
  const after = await page.evaluate(async (id) => {
    const r = await fetch('/portal/signatures/' + id, { headers: { Accept: 'application/json' } }).then((x) => x.json());
    return {
      status: r.request.status,
      original: r.request.document,
      signed: r.request.signedDocument,
      canDownloadSigned: r.request.permissions.downloadSigned,
    };
  }, built.id);
  log('    status:', after.status);
  log('    original:', after.original.name, '| signed:', after.signed && after.signed.name);
  if (!after.signed) throw new Error('no signed copy was produced');
  if (after.signed.id === after.original.id) throw new Error('the signed copy overwrote the original');
  if (!after.canDownloadSigned) throw new Error('signed copy is not downloadable');

  step(4, 'Rendering the signed PDF to check the signature is really on it');
  // Render the stored signed PDF with pdf.js, in the portal session.
  const render = await page.evaluate(async (fileId) => {
    const pdfjs = await import('/js/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/js/vendor/pdf.worker.min.mjs';
    const url = '/portal/files/files/' + fileId + '/download';
    const pdf = await pdfjs.getDocument({ url, withCredentials: true }).promise;

    const out = { pages: pdf.numPages, regions: {} };
    for (const n of [1, 2]) {
      const p = await pdf.getPage(n);
      const vp = p.getViewport({ scale: 1.5 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

      // Count dark pixels in horizontal bands so we can tell WHERE the ink is.
      const bands = { top: 0, middle: 0, bottom: 0 };
      for (let y = 0; y < c.height; y++) {
        const band = y < c.height * 0.35 ? 'top' : y < c.height * 0.7 ? 'middle' : 'bottom';
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) bands[band]++;
        }
      }
      out.regions[n] = bands;
    }
    return out;
  }, after.signed.id);

  log('    signed PDF pages:', render.pages);
  log('    page 1 ink by band:', JSON.stringify(render.regions[1]));
  log('    page 2 ink by band:', JSON.stringify(render.regions[2]));

  if (render.pages !== 2) throw new Error('the signed copy lost a page');
  // The signature went at y=0.78 on page 2 -> the bottom band.
  if (render.regions[2].bottom < 200) {
    throw new Error('no signature ink found in the bottom of page 2 where it was placed');
  }
  // Page 1 got a name field mid-page.
  if (render.regions[1].middle < 20) {
    throw new Error('the name field did not stamp onto page 1');
  }

  step(5, 'The original is still the original');
  const orig = await page.evaluate(async (fileId) => {
    const pdfjs = await import('/js/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/js/vendor/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument({ url: '/portal/files/files/' + fileId + '/download', withCredentials: true }).promise;
    const p = await pdf.getPage(2);
    const vp = p.getViewport({ scale: 1.5 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.7), c.width, Math.floor(c.height * 0.3)).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) ink++;
    return { pages: pdf.numPages, bottomInk: ink };
  }, after.original.id);
  log('    original pages:', orig.pages, '| ink in bottom of page 2:', orig.bottomInk);
  if (orig.bottomInk > 50) throw new Error('the original document was stamped - it must be left alone');

  log('\n=== RESULT: PASS ===');
} catch (err) {
  log('\n=== RESULT: FAIL ===');
  log(String(err.message));
  process.exitCode = 1;
} finally {
  if (errors.length) {
    log('\n--- browser errors ---');
    [...new Set(errors)].slice(0, 8).forEach((e) => log('  ' + e));
  }
  await browser.close();
}
