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

    /**
     * Built-ins Chromium 130 does not have, as pdf.js would call them, mapped
     * to the name the shim defines. A pdf.js upgrade that starts calling one
     * of these fails here instead of as a white page in the desktop app.
     * Float16Array is absent on purpose: pdf.js feature-detects it.
     */
    private const POST_130_BUILTINS = [
        '.toHex(' => "'toHex'",
        '.fromHex(' => "'fromHex'",
        'Uint8Array.fromBase64(' => "'fromBase64'",
        '.toBase64(' => "'toBase64'",
        '.setFromBase64(' => "'setFromBase64'",
        '.setFromHex(' => "'setFromHex'",
        '.getOrInsert(' => "'getOrInsert'",
        '.getOrInsertComputed(' => "'getOrInsertComputed'",
        'Math.sumPrecise(' => "'sumPrecise'",
        'Math.f16round(' => "'f16round'",
        'Error.isError(' => "'isError'",
        'RegExp.escape(' => "'escape'",
        'Iterator.concat(' => "'concat'",
        'Atomics.pause(' => "'pause'",
    ];

    public function test_the_shim_supplies_what_pdfjs_calls(): void
    {
        $compat = $this->js('js/vendor/pdf-compat.mjs');
        $vendor = $this->js('js/vendor/pdf.min.mjs').$this->js('js/vendor/pdf.worker.min.mjs');

        // The ones that broke the desktop app so far; each must stay.
        foreach (["'toHex'", "'fromBase64'", "'toBase64'", "'getOrInsertComputed'", "'sumPrecise'"] as $name) {
            $this->assertStringContainsString($name, $compat);
        }

        $missing = [];
        foreach (self::POST_130_BUILTINS as $call => $shim) {
            if (str_contains($vendor, $call) && ! str_contains($compat, $shim)) {
                $missing[] = $call;
            }
        }

        $this->assertSame([], $missing, 'pdf.js calls these built-ins that Chromium 130 (the desktop app) '
            .'does not have, and pdf-compat.mjs does not supply them — every PDF page will render white in '
            .'the app: '.implode(', ', $missing));
    }

    public function test_the_loader_and_worker_both_install_it(): void
    {
        // The worker matters most: it has its own global scope, so the page's
        // shim never reaches it, and toHex() is called in there. The query on
        // the import is the cache key — the desktop serves /js/vendor/ as
        // immutable, so a changed shim at the same URL never reaches an app.
        $this->assertStringContainsString("import './pdf-compat.mjs?v=2'", $this->js('js/vendor/pdf-worker.mjs'));
        $this->assertStringContainsString("'./pdf.worker.min.mjs'", $this->js('js/vendor/pdf-worker.mjs'));

        $this->assertStringContainsString("import './pdf-compat.mjs?v=2'", $this->js('js/vendor/pdf-loader.mjs'));
        $this->assertStringContainsString("'./pdf.min.mjs'", $this->js('js/vendor/pdf-loader.mjs'));
    }

    public function test_every_caller_loads_the_current_loader_and_worker(): void
    {
        // A stale ?v= keeps an older shim alive in a cache somewhere, and the
        // bug comes back only for the people who had the app open last week.
        $stale = [];

        foreach (glob(public_path('js/*.js')) as $path) {
            $source = (string) file_get_contents($path);
            if (! str_contains($source, 'pdf-loader.mjs')) {
                continue;
            }
            if (! str_contains($source, 'pdf-loader.mjs?v=5')
                || preg_match('/pdf-loader\.mjs\?v=(?!5\b)/', $source)
                || preg_match("/pdf-worker\.mjs(?!\?v=2)['\"]/", $source)) {
                $stale[] = basename($path);
            }
        }

        $this->assertSame([], $stale, 'These import an older pdf-loader.mjs / pdf-worker.mjs version: '.implode(', ', $stale));
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

    public function test_the_loader_points_pdfjs_at_its_binary_tables(): void
    {
        $loader = $this->js('js/vendor/pdf-loader.mjs');

        $this->assertStringContainsString("factoryUrl('./cmaps/')", $loader);
        $this->assertStringContainsString("factoryUrl('./standard_fonts/')", $loader);
        $this->assertStringContainsString("factoryUrl('./wasm/')", $loader);
        $this->assertStringContainsString("factoryUrl('./iccs/')", $loader);
        $this->assertStringContainsString('export function getDocument', $loader);
        $this->assertStringContainsString('useWorkerFetch: false', $loader);
        $this->assertStringContainsString('enableHWA: false', $loader);
        // A star re-export of pdf.min.mjs would shadow this wrap in Electron 33.
        $this->assertStringNotContainsString("export * from './pdf.min.mjs'", $loader);
    }

    public function test_the_file_viewer_loads_the_whole_pdf(): void
    {
        // Range+disableAutoFetch is how the desktop app shows "1 / 1" on a
        // white sheet: the trailer arrives, the page bytes do not.
        $files = $this->js('js/portal-files.js');
        $lightbox = $this->js('js/portal-lightbox.js');

        $this->assertStringContainsString('pdfDocument(url, { complete: true })', $files);
        $this->assertStringContainsString('loadPdfDocument(url, { complete: true })', $lightbox);
        $this->assertStringContainsString('if (complete) return wholeFilePdf', $lightbox);
    }

    public function test_cid_and_standard_font_tables_are_shipped(): void
    {
        // A Chinese medical certificate is typically CID-keyed GB1 plus
        // unembedded Helvetica. Missing either table is a white page that
        // still reports a page count — the exact bug the Applications lightbox
        // was showing.
        $this->assertFileExists(public_path('js/vendor/cmaps/Adobe-GB1-UCS2.bcmap'));
        $this->assertFileExists(public_path('js/vendor/cmaps/Adobe-CNS1-UCS2.bcmap'));
        $this->assertFileExists(public_path('js/vendor/cmaps/Adobe-Japan1-UCS2.bcmap'));
        $this->assertFileExists(public_path('js/vendor/cmaps/LICENSE'));
        $this->assertFileExists(public_path('js/vendor/standard_fonts/LiberationSans-Regular.ttf'));
        $this->assertFileExists(public_path('js/vendor/standard_fonts/FoxitSerif.pfb'));
        $this->assertFileExists(public_path('js/vendor/wasm/openjpeg.wasm'));
        $this->assertFileExists(public_path('js/vendor/iccs/CGATS001Compat-v2-micro.icc'));
    }

    public function test_page_renders_pass_the_canvas_not_a_prior_context(): void
    {
        // pdf.js 6's render() ignores a canvasContext when canvas is set
        // (including the default canvas = context.canvas) and then calls
        // getContext('2d', { alpha: false }). A context already taken with
        // the default alpha makes that return null; CanvasGraphics never
        // paints; the CSS white page background is all the reader sees.
        $offenders = [];

        foreach (glob(public_path('js/*.js')) as $path) {
            $source = (string) file_get_contents($path);
            if (preg_match('/\.render\(\s*\{[^}]*canvasContext\s*:/', $source)) {
                $offenders[] = basename($path);
            }
        }

        $this->assertSame([], $offenders, 'These still pass canvasContext into page.render(), which leaves PDF '
            .'pages blank on pdf.js 6: '.implode(', ', $offenders));
    }
}
