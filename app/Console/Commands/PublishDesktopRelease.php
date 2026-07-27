<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * Uploads a built macOS release to object storage, where DesktopUpdateController
 * serves it from. Run after `npm run dist` in desktop/:
 *
 *   php artisan desktop:publish
 *
 * latest-mac.yml goes last, on purpose: it is what tells every installed app
 * that a new version exists, so it must not point at a build that is still
 * uploading.
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

        $manifest = $dir.'/latest-mac.yml';

        if (! is_file($manifest)) {
            $this->error('latest-mac.yml is missing — that build was made without a publish config.');

            return self::FAILURE;
        }

        // Everything the updater may ask for, manifest last.
        $files = collect(glob($dir.'/*.{zip,dmg,pkg,blockmap}', GLOB_BRACE))
            ->filter(fn (string $f) => is_file($f))
            ->push($manifest)
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

        $this->info('Published '.$files->count().' files. Installed apps will pick this up within the hour.');

        return self::SUCCESS;
    }

    private function size(string $file): string
    {
        return round(filesize($file) / 1048576, 1).' MB';
    }
}
