/*
 * TMA - the two Uint8Array methods pdf.js needs and older engines lack.
 *
 * WHAT THIS IS FOR
 *
 * pdf.js computes a document fingerprint on every getDocument() call, and it
 * does it with `bytes.toHex()`. That method — the TC39 "Uint8Array to/from
 * base64 and hex" proposal — only reached Chromium in 140. The desktop shell
 * is Electron 33, which is Chromium 130, so every PDF in the app failed with
 * "a.toHex is not a function": the File Library viewer, the shared lightbox,
 * mail attachments, the signature editor and the public signing page, all of
 * them, on macOS and Windows alike. In a browser it worked, because browsers
 * update themselves.
 *
 * So this is not really about the desktop app. Any engine a reader might turn
 * up with that predates Chromium 140 / Safari 18.2 / Firefox 133 has the same
 * hole, and a viewer that cannot open a PDF is not a viewer.
 *
 * WHY IT IS IMPORTED IN TWO PLACES
 *
 * The failing call happens inside pdf.worker, which is a Worker with its own
 * global scope — a shim installed on the page never reaches it. pdf-worker.mjs
 * imports this before the worker; pdf-loader.mjs imports it before the main
 * library (which needs it too, both for its own use of fromBase64 and for the
 * "fake worker" fallback, where the worker code runs on the page instead).
 *
 * Only the two methods pdf.js actually calls are here. The rest of the family
 * (toBase64, fromHex, setFromBase64, setFromHex) is deliberately absent: a
 * shim nothing calls is a shim nobody notices has gone wrong.
 */

if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function toHex() {
      let out = '';
      for (let i = 0; i < this.length; i++) {
        out += (this[i] < 16 ? '0' : '') + this[i].toString(16);
      }

      return out;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function fromBase64(string, options) {
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
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
