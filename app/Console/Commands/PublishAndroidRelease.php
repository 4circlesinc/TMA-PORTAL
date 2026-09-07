<?php

namespace App\Console\Commands;

use App\Http\Controllers\DesktopReleasesController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

/**
 * `php artisan android:publish` — puts the signed release APK on the same
 * feed the desktop builds use (files disk, `desktop/`), with a
 * `latest-android.yml` in the shape DesktopReleasesController reads, so the
 * Overview promo, the QR landing page and /desktop/download/android all
 * point at it at once.
 */
class PublishAndroidRelease extends Command
{
    protected $signature = 'android:publish
        {--path=android/app/build/outputs/apk/release : Directory holding the built APK}
        {--app-version= : Version label; read from android/app/build.gradle.kts when omitted}
        {--dry-run : Say what would be uploaded and stop}';

    protected $description = 'Publish the built Android app to the download feed';

    public function handle(): int
    {
        $dir = base_path($this->option('path'));
        $apk = collect(glob($dir.'/*.apk') ?: [])->filter(fn ($f) => is_file($f))->sortBy(fn ($f) => str_contains($f, 'unsigned') ? 1 : 0)->first();
        if (! $apk) {
            $this->error("No APK in {$dir}.");
            $this->line('Build it first: cd android && ./gradlew :app:assembleRelease');

            return self::FAILURE;
        }
        if (str_contains(basename($apk), 'unsigned')) {
            $this->error('That APK is unsigned; add android/keystore.properties and rebuild.');

            return self::FAILURE;
        }

        $version = (string) ($this->option("app-version") ?: $this->versionFromGradle());
        if ($version === '') {
            $this->error('Could not read versionName; pass --app-version=.');

            return self::FAILURE;
        }

        $name = "TMA-Portal-{$version}.apk";
        $size = filesize($apk);
        $manifest = "version: {$version}\nfiles:\n  - url: {$name}\n    size: {$size}\npath: {$name}\nreleaseDate: '".now()->toIso8601String()."'\n";

        $this->line("{$name}  ".round($size / 1048576, 1).' MB');
        if ($this->option('dry-run')) {
            $this->line($manifest);

            return self::SUCCESS;
        }

        $disk = Storage::disk(config('filesystems.files_disk'));
        $stream = fopen($apk, 'rb');
        $ok = $disk->put('desktop/'.$name, $stream, [
            'ContentType' => 'application/vnd.android.package-archive',
            'ContentDisposition' => 'attachment; filename="'.$name.'"',
        ]);
        if (is_resource($stream)) {
            fclose($stream);
        }
        if (! $ok || ! $disk->put('desktop/latest-android.yml', $manifest)) {
            $this->error('Upload failed.');

            return self::FAILURE;
        }
        DesktopReleasesController::forgetCache();

        $this->info("Published {$name}.");
        $this->line('Phones land on '.route('desktop.android').' from the QR code on the Overview page.');

        return self::SUCCESS;
    }

    private function versionFromGradle(): string
    {
        $gradle = base_path('android/app/build.gradle.kts');
        if (! is_file($gradle)) {
            return '';
        }
        preg_match('/versionName\s*=\s*"([^"]+)"/', (string) file_get_contents($gradle), $m);

        return $m[1] ?? '';
    }
}
