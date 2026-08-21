/*
 * TMA - pdf.js, with the compatibility shim already installed.
 *
 * Every caller in the portal imports this instead of pdf.min.mjs, and points
 * GlobalWorkerOptions.workerSrc at pdf-worker.mjs beside it. The vendor files
 * stay exactly as pdf.js shipped them, so upgrading pdf.js is still a copy.
 *
 * See pdf-compat.mjs for what is missing and where.
 */
import './pdf-compat.mjs';

export * from './pdf.min.mjs';
