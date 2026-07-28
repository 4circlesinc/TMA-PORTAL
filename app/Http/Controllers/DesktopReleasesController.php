<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * "Download the app" for humans.
 *
 * DesktopUpdateController serves the update feed by exact filename, which is
 * what electron-updater wants but useless in a link: the filename carries the
 * version and the architecture. This resolves the current build per platform
 * from the same manifests, so the portal can link at /desktop/download/mac and
 * keep working after every release.
 *
 * Only macOS is built today. Windows resolves to "not available" rather than a
 * dead link, and turns itself on the day a latest.yml lands in the bucket.
 */
class DesktopReleasesController extends Controller
{
    private const MANIFESTS = [
        'mac' => 'latest-mac.yml',
        'windows' => 'latest.yml',
    ];

    /** Installer first, archive last — whatever a person double-clicks. */
    private const PREFERRED = [
        'mac' => ['dmg', 'pkg', 'zip'],
        'windows' => ['exe', 'msi', 'zip'],
    ];

    private const TTL = 300;

    public function index(): JsonResponse
    {
        $out = [];

        foreach (array_keys(self::MANIFESTS) as $platform) {
            $release = $this->release($platform);
            $out[$platform] = $release
                ? [
                    'available' => true,
                    'version' => $release['version'],
                    'url' => route('desktop.download', $platform),
                ]
                : ['available' => false];
        }

        return response()->json($out);
    }

    public function download(string $platform): RedirectResponse
    {
        $release = $this->release($platform);

        if (! $release) {
            abort(404);
        }

        return redirect()->route('desktop.update', $release['file']);
    }

    /**
     * @return array{version: string, file: string}|null
     */
    private function release(string $platform): ?array
    {
        if (! isset(self::MANIFESTS[$platform])) {
            return null;
        }

        return Cache::remember(
            'desktop.release.'.$platform,
            self::TTL,
            fn () => $this->readManifest($platform)
        );
    }

    /**
     * @return array{version: string, file: string}|null
     */
    private function readManifest(string $platform): ?array
    {
        $disk = Storage::disk(config('filesystems.files_disk'));
        $path = 'desktop/'.self::MANIFESTS[$platform];

        if (! $disk->exists($path)) {
            return null;
        }

        try {
            $raw = (string) $disk->get($path);
        } catch (\Throwable) {
            return null;
        }

        // electron-builder writes a fixed, flat shape, so a full YAML parser
        // would be a dependency bought for two keys: `version` and the file
        // list. Anything unexpected simply yields no release.
        preg_match('/^version:\s*(.+)$/m', $raw, $v);
        preg_match_all('/^\s*-?\s*url:\s*(.+)$/m', $raw, $urls);

        $version = trim($v[1] ?? '', " \t\"'");
        $files = array_map(fn (string $u) => trim($u, " \t\"'"), $urls[1] ?? []);

        if ($version === '' || $files === []) {
            return null;
        }

        foreach (self::PREFERRED[$platform] as $ext) {
            foreach ($files as $file) {
                if (str_ends_with(strtolower($file), '.'.$ext)) {
                    return ['version' => $version, 'file' => $file];
                }
            }
        }

        return null;
    }
}
