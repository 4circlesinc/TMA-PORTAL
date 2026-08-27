/*
 * TMA - pdf.worker, with the compatibility shim already installed.
 *
 * A Worker has its own global scope, so the shim the page installs does not
 * reach it — and the call that fails on older engines (bytes.toHex(), while
 * fingerprinting the document) happens in here. This is what workerSrc must
 * point at. See pdf-compat.mjs.
 */
import './pdf-compat.mjs?v=2';
import './pdf.worker.min.mjs';
