/*
 * The smallest PDF that is actually a PDF.
 *
 * The suites used to upload a header-plus-catalog stub ("the smallest thing a
 * mime sniffer will call a PDF"), which passed intake — and then sat in the
 * File Library as a document no viewer could open: pdf.js rightly refused it,
 * and a staff member clicking a seeded "Passport bio page.pdf" saw an error
 * card and assumed the portal was broken. This builds a valid one-page PDF
 * (catalog → pages → one blank US-Letter page) with a computed xref, so
 * anything a test uploads previews like a real document. All ASCII, so string
 * length is byte offset.
 */
export function tinyPdfBuffer() {
  const objects = [
    '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n',
    '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n',
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>\nendobj\n',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }

  const xrefAt = body.length;
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const at of offsets) xref += String(at).padStart(10, '0') + ' 00000 n \n';

  const trailer =
    'trailer\n<</Size ' + (objects.length + 1) + '/Root 1 0 R>>\n' +
    'startxref\n' + xrefAt + '\n%%EOF\n';

  return Buffer.from(body + xref + trailer);
}
