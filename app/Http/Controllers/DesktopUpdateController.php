<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Update feed for the macOS desktop app.
 *
 * electron-updater polls latest-mac.yml here and then fetches the build it
 * names. Artifacts live in object storage under `desktop/`, put there by
 * `php artisan desktop:publish`; this endpoint is the stable public URL in
 * front of them, so the bucket never has to be world-readable.
 *
 * The manifest is small and changes every release, so it is streamed. Builds
 * are ~90 MB, so those redirect to a signed URL and never touch PHP memory.
 */
class DesktopUpdateController extends Controller
{
    private const PREFIX = 'desktop';

    /** Only the shapes electron-builder actually produces. */
    private const ALLOWED = '/^[A-Za-z0-9 ._-]+\.(yml|zip|dmg|pkg|blockmap)$/';

    public function __invoke(string $file): Response|RedirectResponse|StreamedResponse
    {
        if (! preg_match(self::ALLOWED, $file) || str_contains($file, '..')) {
            abort(404);
        }

        $disk = Storage::disk(config('filesystems.files_disk'));
        $path = self::PREFIX.'/'.$file;

        if (! $disk->exists($path)) {
            abort(404);
        }

        // The manifest is the only thing electron-updater parses; everything
        // else it just downloads, so hand those straight to the bucket.
        if (str_ends_with($file, '.yml')) {
            return response($disk->get($path), 200, [
                'Content-Type' => 'text/yaml',
                'Cache-Control' => 'no-cache, must-revalidate',
            ]);
        }

        try {
            return redirect()->away($disk->temporaryUrl($path, now()->addMinutes(30)));
        } catch (\RuntimeException) {
            // Local disk in development has no signed URLs.
            return $disk->download($path);
        }
    }
}
