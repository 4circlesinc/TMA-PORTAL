<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

/**
 * The identity of this deploy's static assets.
 *
 * The desktop app ships a copy of them so a cold start does not fetch a
 * thousand icons before it can draw. That is only safe while the copy is
 * *exactly* what this server would have sent: assets one deploy out of date
 * mean last week's JavaScript running against this week's API, which fails in
 * ways far worse than a slow load.
 *
 * So the app compares its bundled `build` against this one and serves locally
 * only on an exact match. Anything else, a portal deploy the app has not
 * caught up with, a partial bundle, a missing file, and it falls back to the
 * network, which is simply how it behaved before any of this existed.
 *
 * The hash must be computed the same way on both sides. The other half is
 * desktop/bundle-assets.js; change one and you must change the other, and the
 * only symptom of getting it wrong is that the optimisation silently stops
 * applying.
 */
class DesktopAssetsController extends Controller
{
    /** Mirrors INCLUDE in desktop/bundle-assets.js. */
    private const INCLUDE = [
        'css',
        'js',
        'audio',
        'images/icons',
        'images/brand',
        'images/illustrations',
        'images/avatars',
        'images/charts',
        'images/cursors',
        'images/emoji',
        'images/payment',
        'images/products',
        'images/settings',
    ];

    /** Mirrors SKIP in desktop/bundle-assets.js. */
    private const SKIP = '/(\.bak$|\.corrupt|\.orig$|\.DS_Store$|~$)/';

    /**
     * Hashing 2,000 files is far too expensive to do per request, and the
     * answer only changes when the code does, so it is cached for a day and
     * keyed by the deploy, which clears it.
     */
    private const TTL = 86400;

    public function show(): JsonResponse
    {
        return response()->json($this->cached());
    }

    /**
     * Just this deploy's identity, for an app that is only asking whether the
     * portal has moved under it.
     *
     * The app asks that question far more often than it needs the answer in
     * detail: it re-checks on every navigation and on a timer, because a shell
     * it kept from this morning names bundles this afternoon's deploy has
     * already deleted, and that is a page with no stylesheet on it. Two
     * thousand hashes is the wrong price for a yes/no. This is the same value
     * as show()'s `build`, out of the same cached computation, so the two can
     * never disagree about what is deployed.
     */
    public function build(): JsonResponse
    {
        return response()->json(['build' => $this->cached()['build']]);
    }

    /** @return array{build: string, count: int, bytes: int, files: array<string, string>} */
    private function cached(): array
    {
        return Cache::remember(
            'desktop.assets.'.self::deployKey(),
            self::TTL,
            fn () => $this->manifest()
        );
    }

    /**
     * Changes whenever the app is redeployed, so a new release never serves a
     * hash computed from the previous one's files.
     *
     * The built bundles' filenames are content hashes of every stylesheet and
     * script the portal ships, so any deploy that touches one moves this. The
     * directory mtimes cover what the build does not see — images, audio — and
     * they are deliberately not the whole key: a directory's mtime does not
     * change when a file inside it is edited in place, so on its own it would
     * hold a day-old manifest across exactly the deploys this must catch.
     */
    private static function deployKey(): string
    {
        $manifest = public_path('build/manifest.json');

        return substr(md5(implode('|', [
            is_file($manifest) ? (string) file_get_contents($manifest) : '',
            (string) (@filemtime(public_path('js')) ?: 0),
            (string) (@filemtime(public_path('css')) ?: 0),
            (string) (@filemtime(public_path('images')) ?: 0),
        ])), 0, 16);
    }

    /**
     * @return array{build: string, count: int, bytes: int, files: array<string, string>}
     */
    private function manifest(): array
    {
        $entries = [];
        $files = [];
        $bytes = 0;

        foreach (self::INCLUDE as $rel) {
            $from = public_path($rel);
            if (! is_dir($from)) {
                continue;
            }

            $walker = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($from, \FilesystemIterator::SKIP_DOTS)
            );

            foreach ($walker as $file) {
                if (! $file->isFile() || preg_match(self::SKIP, $file->getFilename())) {
                    continue;
                }

                $url = '/'.str_replace('\\', '/', ltrim(
                    substr($file->getPathname(), strlen(public_path())), '/\\'
                ));

                $hash = hash_file('sha256', $file->getPathname());
                $entries[] = $url.':'.$hash;
                $files[$url] = $hash;
                $bytes += $file->getSize();
            }
        }

        // Sorted, so the hash depends on the content rather than on the order
        // the filesystem happened to hand the files over.
        sort($entries, SORT_STRING);

        ksort($files, SORT_STRING);

        return [
            'build' => hash('sha256', implode("\n", $entries)),
            'count' => count($entries),
            'bytes' => $bytes,
            // Per file, so the app can match asset by asset rather than all or
            // nothing. A deploy that changes three files then costs three
            // network fetches, not a fallback to all two thousand.
            'files' => $files,
        ];
    }
}
