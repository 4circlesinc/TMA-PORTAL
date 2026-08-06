<?php

namespace App\Console\Commands;

use App\Http\Controllers\DesktopReleasesController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Uploads a built desktop release to object storage, where
 * DesktopUpdateController serves it from. Run after a build in desktop/:
 *
 *   npm run release      # macOS  → latest-mac.yml
 *   npm run release:win  # Windows → latest.yml
 *   php artisan desktop:publish
 *
 * Manifests go last, on purpose: they are what tell every installed app that a
 * new version exists, so they must not point at a build that is still
 * uploading.
 *
 * Both platforms share one bucket prefix and one command. Whichever manifests
 * are present get published, so building only one platform leaves the other's
 * release alone rather than retracting it.
 */
class PublishDesktopRelease extends Command
{
    protected $signature = 'desktop:publish
        {--path=desktop/release : Directory holding the built artifacts}
        {--dry-run : List what would be uploaded and stop}';

    protected $description = 'Publish the built macOS desktop app to the update feed';

    public function handle(): int
    {
        $dir = base_path($this->option('path'));

        if (! is_dir($dir)) {
            $this->error("No such directory: {$dir}");
            $this->line('Build it first: cd desktop && npm run dist');

            return self::FAILURE;
        }

        $manifests = collect(['latest-mac.yml', 'latest.yml'])
            ->map(fn (string $name) => $dir.'/'.$name)
            ->filter(fn (string $f) => is_file($f))
            ->values();

        if ($manifests->isEmpty()) {
            $this->error('No latest-mac.yml or latest.yml — that build was made without a publish config.');

            return self::FAILURE;
        }

        // Everything the updater may ask for, manifests last.
        $files = collect(glob($dir.'/*.{zip,dmg,pkg,exe,blockmap}', GLOB_BRACE))
            ->filter(fn (string $f) => is_file($f))
            ->merge($manifests)
            ->values();

        if ($this->option('dry-run')) {
            $files->each(fn (string $f) => $this->line('  '.basename($f).'  '.$this->size($f)));

            return self::SUCCESS;
        }

        $disk = Storage::disk(config('filesystems.files_disk'));

        foreach ($files as $file) {
            $name = basename($file);
            $this->line("Uploading {$name} ({$this->size($file)})…");

            $stream = fopen($file, 'rb');
            $ok = $disk->put('desktop/'.$name, $stream);
            if (is_resource($stream)) {
                fclose($stream);
            }

            if (! $ok) {
                $this->error("Failed to upload {$name}.");

                return self::FAILURE;
            }
        }

        // The download button resolves the current build from these manifests
        // and caches what it reads. Left alone, it hands people the previous
        // version for the next five minutes — right when the release is being
        // checked. Dropped here, after the manifests are up and never before.
        DesktopReleasesController::forgetCache();

        $this->info('Published '.$files->count().' files. Installed apps will pick this up within the hour.');
        $this->line('The download button is already on this version.');

        return self::SUCCESS;
    }

    private function size(string $file): string
    {
        return round(filesize($file) / 1048576, 1).' MB';
    }
}
