<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * pdf.js must never be reached except through the shimmed loader.
 *
 * pdf.js fingerprints every document with `bytes.toHex()`, a method that only
 * arrived in Chromium 140. The desktop shell is Electron 33 — Chromium 130 —
 * so every PDF in the app died with "a.toHex is not a function": the File
 * Library viewer, the shared lightbox, mail attachments, the signature editor
 * and the public signing page, on macOS and Windows alike. Browsers were fine,
 * which is exactly why nobody caught it: it is invisible unless you are inside
 * the app, or on an engine a version or two behind.
 *
 * The shim lives in pdf-compat.mjs and is pulled in by pdf-loader.mjs (the
 * page) and pdf-worker.mjs (the worker, where the failing call actually
 * happens). A seventh caller reaching straight for the vendor file would put
 * the bug back with no error anywhere a test would see it — hence this.
 */
class PdfViewerCompatTest extends TestCase
{
    private function js(string $relative): string
    {
        return (string) file_get_contents(public_path($relative));
    }

    public function test_the_shim_supplies_what_pdfjs_calls(): void
    {
        $compat = $this->js('js/vendor/pdf-compat.mjs');

        $this->assertStringContainsString("'toHex'", $compat);
        $this->assertStringContainsString("'fromBase64'", $compat);
    }

    public function test_the_loader_and_worker_both_install_it(): void
    {
        // The worker matters most: it has its own global scope, so the page's
        // shim never reaches it, and toHex() is called in there.
        $this->assertStringContainsString("import './pdf-compat.mjs'", $this->js('js/vendor/pdf-worker.mjs'));
        $this->assertStringContainsString("'./pdf.worker.min.mjs'", $this->js('js/vendor/pdf-worker.mjs'));

        $this->assertStringContainsString("import './pdf-compat.mjs'", $this->js('js/vendor/pdf-loader.mjs'));
        $this->assertStringContainsString("'./pdf.min.mjs'", $this->js('js/vendor/pdf-loader.mjs'));
    }

    public function test_no_shipped_script_loads_the_vendor_files_directly(): void
    {
        $offenders = [];

        foreach (glob(public_path('js/*.js')) as $path) {
            $source = (string) file_get_contents($path);
            if (str_contains($source, 'pdf.min.mjs') || str_contains($source, 'pdf.worker.min.mjs')) {
                $offenders[] = basename($path);
            }
        }

        $this->assertSame([], $offenders, 'These load pdf.js without the compatibility shim, so PDFs will '
            .'fail in the desktop app and on older browsers — import pdf-loader.mjs and point workerSrc at '
            .'pdf-worker.mjs instead: '.implode(', ', $offenders));
    }
}
