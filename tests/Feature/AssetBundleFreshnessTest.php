<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * The committed bundle must match the shell it is built from.
 *
 * `public/build` is committed (see .gitignore) because the alternative —
 * building on deploy — depends on the host installing a devDependency, and
 * skips in silence when it does not. A committed artefact has the opposite
 * failure: it can go stale. This is the check that stops that being silent.
 *
 * It compares the shell's asset list against the one the build recorded. An
 * asset added, removed or reordered in `resources/views/pages/dashboard.html`
 * without a rebuild fails here, naming the file and the fix.
 *
 * It cannot verify the *contents* of an asset, because the hash the build
 * writes is of the minified output and only esbuild produces that. Editing
 * the body of a file already in the list will not fail this test, so the
 * standing rule stays: run `npm run build` before pushing a change under
 * public/js or public/css.
 */
class AssetBundleFreshnessTest extends TestCase
{
    private const SHELL = 'resources/views/pages/dashboard.html';

    private const MANIFEST = 'public/build/manifest.json';

    /** The tag shapes AssetBundle rewrites, and the build reads. */
    private const CSS_TAG = '~^[ \t]*<link rel="stylesheet" href="css/([^"?]+)(?:\?[^"]*)?">[ \t]*$~m';

    private const JS_TAG = '~^[ \t]*<script src="js/([^"?]+)(?:\?[^"]*)?" defer></script>[ \t]*$~m';

    public function test_the_committed_bundle_is_present(): void
    {
        $this->assertFileExists(
            base_path(self::MANIFEST),
            'public/build is committed on purpose: without it the shell serves 135 separate '
            ."requests and 7.1 MB before the dashboard paints.\nRun: npm run build",
        );

        $manifest = json_decode((string) file_get_contents(base_path(self::MANIFEST)), true);

        $this->assertIsArray($manifest);
        $this->assertFileExists(base_path('public/build/'.$manifest['js']), 'the manifest names a js file that is not there');
        $this->assertFileExists(base_path('public/build/'.$manifest['css']), 'the manifest names a css file that is not there');
    }

    public function test_the_bundle_covers_exactly_the_assets_the_shell_lists(): void
    {
        $shell = (string) file_get_contents(base_path(self::SHELL));
        $manifest = json_decode((string) file_get_contents(base_path(self::MANIFEST)), true);

        preg_match_all(self::JS_TAG, $shell, $js);
        preg_match_all(self::CSS_TAG, $shell, $css);

        $this->assertSame(
            $js[1],
            $manifest['sources']['js'],
            "The shell's scripts and the built bundle have drifted apart.\n"
            ."Run: npm run build, and commit public/build.\n",
        );

        $this->assertSame(
            $css[1],
            $manifest['sources']['css'],
            "The shell's stylesheets and the built bundle have drifted apart.\n"
            ."Run: npm run build, and commit public/build.\n",
        );
    }

    public function test_every_asset_the_bundle_names_still_exists(): void
    {
        $manifest = json_decode((string) file_get_contents(base_path(self::MANIFEST)), true);

        foreach ($manifest['sources']['js'] as $file) {
            $this->assertFileExists(base_path('public/js/'.$file));
        }

        foreach ($manifest['sources']['css'] as $file) {
            $this->assertFileExists(base_path('public/css/'.$file));
        }
    }
}
