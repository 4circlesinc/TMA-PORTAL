/*
 * TMA - the built-ins pdf.js calls and older engines lack.
 *
 * WHAT THIS IS FOR
 *
 * pdf.js 6 is written for whatever Chromium shipped this quarter. The desktop
 * shell is Electron 33, which is Chromium 130, and the gap between the two is
 * a handful of TC39 proposals that pdf.js calls without feature-detecting:
 *
 *   Uint8Array.prototype.toHex      Chromium 140   document fingerprint, in the worker
 *   Uint8Array.fromBase64           Chromium 140   worker and page
 *   Uint8Array.prototype.toBase64   Chromium 140   @font-face fallback, signature editor
 *   Map.prototype.getOrInsertComputed  (upsert)    EVERY page.render(), via
 *                                                  getOptionalContentConfig — and
 *                                                  a dozen places in the worker
 *   Math.sumPrecise                 (proposal)     TrueType glyph writer, XFA layout
 *
 * Each one is a different symptom. toHex missing meant no PDF opened at all
 * ("a.toHex is not a function"). getOrInsertComputed missing is worse, because
 * it is quiet: getDocument succeeds, the page count is right, and then every
 * render() rejects and the viewers — which treat a page paint as best-effort —
 * show a white sheet for every page. That is the one that looked like a
 * loading bug for a week.
 *
 * So this is not really about the desktop app. Any engine a reader might turn
 * up with that predates these (Chromium 140 / Safari 18.2 / Firefox 133 for the
 * Uint8Array family, later still for the rest) has the same holes, and a viewer
 * that cannot paint a page is not a viewer.
 *
 * WHY IT IS IMPORTED IN TWO PLACES
 *
 * Half of these calls happen inside pdf.worker, which is a Worker with its own
 * global scope — a shim installed on the page never reaches it. pdf-worker.mjs
 * imports this before the worker; pdf-loader.mjs imports it before the main
 * library (which needs it too, both for its own calls and for the "fake
 * worker" fallback, where the worker code runs on the page instead).
 *
 * Only what pdf.js actually calls is here: a shim nothing calls is a shim
 * nobody notices has gone wrong. tests/Feature/PdfViewerCompatTest.php scans
 * the vendor files for the known post-130 built-ins and fails when one is
 * called that this file does not supply; desktop/test-pdf-engine.js renders
 * real pages in the pinned Electron, which is the only test that catches the
 * next one nobody has heard of yet.
 */

function define(target, name, value) {
  Object.defineProperty(target, name, {
    value: value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

if (typeof Uint8Array.prototype.toHex !== 'function') {
  define(Uint8Array.prototype, 'toHex', function toHex() {
    let out = '';
    for (let i = 0; i < this.length; i++) {
      out += (this[i] < 16 ? '0' : '') + this[i].toString(16);
    }

    return out;
  });
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  define(Uint8Array, 'fromBase64', function fromBase64(string, options) {
    // atob exists in worker scope as well as on the page, and it already
    // ignores the ASCII whitespace the spec says to skip.
    const alphabet = (options && options.alphabet) || 'base64';
    const text = alphabet === 'base64url'
      ? String(string).replace(/-/g, '+').replace(/_/g, '/')
      : String(string);

    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  });
}

if (typeof Uint8Array.prototype.toBase64 !== 'function') {
  define(Uint8Array.prototype, 'toBase64', function toBase64(options) {
    const alphabet = (options && options.alphabet) || 'base64';
    const omitPadding = !!(options && options.omitPadding);

    // Chunked: a font program can be hundreds of KB, and
    // String.fromCharCode.apply over the whole array overflows the stack.
    let binary = '';
    for (let i = 0; i < this.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
    }

    let out = btoa(binary);
    if (alphabet === 'base64url') {
      out = out.replace(/\+/g, '-').replace(/\//g, '_');
    }
    if (omitPadding) {
      out = out.replace(/=+$/, '');
    }

    return out;
  });
}

/* The "upsert" proposal, on Map and WeakMap alike. */
[Map.prototype, WeakMap.prototype].forEach(function (proto) {
  if (typeof proto.getOrInsert !== 'function') {
    define(proto, 'getOrInsert', function getOrInsert(key, value) {
      if (this.has(key)) return this.get(key);
      this.set(key, value);

      return value;
    });
  }

  if (typeof proto.getOrInsertComputed !== 'function') {
    define(proto, 'getOrInsertComputed', function getOrInsertComputed(key, callback) {
      if (typeof callback !== 'function') {
        throw new TypeError('getOrInsertComputed: callback is not a function');
      }
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);

      return value;
    });
  }
});

if (typeof Math.sumPrecise !== 'function') {
  /* Neumaier summation. The proposal specifies a correctly rounded result;
   * this is within one ulp of it, and pdf.js sums glyph byte counts and XFA
   * column widths with it, so one ulp is nothing. The edge cases (empty is
   * -0, a NaN or opposing infinities are NaN, non-numbers throw) follow the
   * spec exactly. */
  define(Math, 'sumPrecise', function sumPrecise(items) {
    if (items == null || typeof items[Symbol.iterator] !== 'function') {
      throw new TypeError('Math.sumPrecise: argument is not iterable');
    }

    let sum = -0;
    let compensation = 0;
    let count = 0;
    let sawNaN = false;
    let posInf = false;
    let negInf = false;

    for (const item of items) {
      if (typeof item !== 'number') {
        throw new TypeError('Math.sumPrecise: element is not a number');
      }
      count++;
      if (item !== item) { sawNaN = true; continue; }
      if (item === Infinity) { posInf = true; continue; }
      if (item === -Infinity) { negInf = true; continue; }

      const t = sum + item;
      if (Math.abs(sum) >= Math.abs(item)) {
        compensation += (sum - t) + item;
      } else {
        compensation += (item - t) + sum;
      }
      sum = t;
    }

    if (sawNaN || (posInf && negInf)) return NaN;
    if (posInf) return Infinity;
    if (negInf) return -Infinity;
    if (count === 0) return -0;

    return sum + compensation;
  });
}
