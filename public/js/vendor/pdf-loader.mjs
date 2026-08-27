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
 *
 * Do not star-re-export pdf.min.mjs and then also export getDocument: in
 * Electron 33 (Chromium 130) the star export wins, the wrap never runs, and
 * the pages stay white. Named exports only, so the wrap is the only
 * getDocument the page can see. CMaps are fetched on the page, not in the
 * worker — the desktop protocol handler does not reliably reach a Worker.
 */
// The query is the cache key: the desktop serves /js/vendor/ as immutable,
// so a changed shim at the same URL would never reach an installed app.
import './pdf-compat.mjs?v=2';
import * as pdfjs from './pdf.min.mjs';

export const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;

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
    useWorkerFetch: false,
    enableHWA: false,
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
  return pdfjs.getDocument(documentParams(src));
}
