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
        return response()->json(Cache::remember(
            'desktop.assets.'.self::deployKey(),
            self::TTL,
            fn () => $this->manifest()
        ));
    }

    /**
     * Changes whenever the app is redeployed, so a new release never serves a
     * hash computed from the previous one's files.
     */
    private static function deployKey(): string
    {
        return (string) (filemtime(public_path('js')) ?: 0);
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
