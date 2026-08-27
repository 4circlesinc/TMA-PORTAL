/*
 * TMA - pdf.js, with the compatibility shim already installed.
 *
 * Every caller in the portal imports this instead of pdf.min.mjs, and points
 * GlobalWorkerOptions.workerSrc at pdf-worker.mjs beside it. The vendor files
 * stay exactly as pdf.js shipped them, so upgrading pdf.js is still a copy.
 *
 * See pdf-compat.mjs for what is missing and where.
 *
 * getDocument is wrapped so every viewer, thumbnail and signing page gets the
 * CMap / standard-font / wasm / ICC tables pdf.js 4+ keeps out of the worker.
 * Without those URLs a 15 KB Chinese medical certificate still reports 3 pages
 * and then paints nothing: CID glyphs never map, Helvetica never substitutes,
 * JPEG2000 scans stay empty. The directories live next to this file.
 */
import './pdf-compat.mjs';
import { getDocument as pdfGetDocument } from './pdf.min.mjs';

export * from './pdf.min.mjs';

function factoryUrl(relative) {
  var href = new URL(relative, import.meta.url).href;
  return href.endsWith('/') ? href : href + '/';
}

function isBinary(src) {
  return typeof ArrayBuffer !== 'undefined'
    && (src instanceof ArrayBuffer || ArrayBuffer.isView(src));
}

function documentParams(src) {
  var assets = {
    cMapUrl: factoryUrl('./cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: factoryUrl('./standard_fonts/'),
    wasmUrl: factoryUrl('./wasm/'),
    iccUrl: factoryUrl('./iccs/'),
  };

  if (src == null) return assets;
  if (typeof src === 'string' || (typeof URL !== 'undefined' && src instanceof URL)) {
    return Object.assign({ url: String(src) }, assets);
  }
  if (isBinary(src)) {
    return Object.assign({ data: src }, assets);
  }

  return Object.assign({}, assets, src);
}

export function getDocument(src) {
  return pdfGetDocument(documentParams(src));
}
