<?php

namespace App\Support\Files;

use App\Models\FileItem;

/**
 * Generates and caches small image thumbnails with GD (the only image tool
 * available on this stack, no imagick/ffmpeg/ghostscript, so PDFs/videos fall
 * back to their type icon on the client).
 *
 * CACHED IN TWO PLACES, AND THE SECOND IS THE IMPORTANT ONE
 *
 * Local scratch is the fast path, an already-generated thumbnail is a file
 * read. But on Laravel Cloud that disk is ephemeral: it is empty after every
 * deploy and different on every container. Generating one is not cheap either,
 * because the source lives in R2 and GD needs it whole, so a miss means
 * downloading the entire original, the 12 MP photo, the 40 MB scan, just to
 * make a 400px JPEG. A folder of thirty photos did that thirty times, on every
 * container, for ever. That is why the result is also written beside the file
 * in the vault: generated once, then only ever fetched.
 */
class Thumbnail
{
    /** Longest edge of a generated thumbnail. */
    public const MAX = 400;

    /** Raster formats GD can decode. */
    private const RASTER = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

    /** Any format we can show a real preview for (raster via GD, or SVG raw). */
    public static function supportsExt(?string $ext): bool
    {
        $ext = strtolower((string) $ext);

        return in_array($ext, self::RASTER, true) || $ext === 'svg';
    }

    public static function isSvg(FileItem $file): bool
    {
        return strtolower((string) $file->extension) === 'svg';
    }

    private static function isRaster(FileItem $file): bool
    {
        return in_array(strtolower((string) $file->extension), self::RASTER, true);
    }

    /** Absolute path to a raster JPEG thumbnail (generated on demand), or null. */
    public static function ensure(FileItem $file): ?string
    {
        if (! self::isRaster($file) || ! extension_loaded('gd')) {
            return null;
        }

        $cachePath = self::cachePath($file, 'jpg');
        if (is_file($cachePath)) {
            return $cachePath;
        }

        if (self::restore($file, 'jpg', $cachePath)) {
            return $cachePath;
        }

        $source = Vault::localCopy($file);
        if ($source === null) {
            return null;
        }

        try {
            $data = @file_get_contents($source);
            if ($data === false) {
                return null;
            }

            $img = @imagecreatefromstring($data);
            if (! $img) {
                return null;
            }

            if (in_array(strtolower((string) $file->extension), ['jpg', 'jpeg'], true)) {
                $img = self::applyExifOrientation($img, $source);
            }

            $w = imagesx($img);
            $h = imagesy($img);
            $scale = min(1, self::MAX / max($w, $h));
            $nw = max(1, (int) round($w * $scale));
            $nh = max(1, (int) round($h * $scale));

            $thumb = imagecreatetruecolor($nw, $nh);
            $white = imagecolorallocate($thumb, 255, 255, 255); // flatten transparency for JPEG
            imagefilledrectangle($thumb, 0, 0, $nw, $nh, $white);
            imagecopyresampled($thumb, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);

            self::ensureCacheDir();
            @imagejpeg($thumb, $cachePath, 82);
            imagedestroy($img);
            imagedestroy($thumb);

            if (! is_file($cachePath)) {
                return null;
            }

            self::keep($file, 'jpg', $cachePath);

            return $cachePath;
        } finally {
            Vault::cleanupLocalCopy($source);
        }
    }

    /**
     * A safe, cached SVG for previewing. SVGs can carry scripts, so we strip
     * <script>/<foreignObject>, on* handlers and javascript: URLs before
     * serving. Rendered in an <img> (where scripts never run) on top of this.
     */
    public static function ensureSvg(FileItem $file): ?string
    {
        if (! self::isSvg($file)) {
            return null;
        }

        $cachePath = self::cachePath($file, 'svg');
        if (is_file($cachePath)) {
            return $cachePath;
        }

        if (self::restore($file, 'svg', $cachePath)) {
            return $cachePath;
        }

        $source = Vault::localCopy($file);
        if ($source === null) {
            return null;
        }

        try {
            $svg = @file_get_contents($source);
            if ($svg === false) {
                return null;
            }

            $svg = self::sanitizeSvg($svg);

            self::ensureCacheDir();
            @file_put_contents($cachePath, $svg);

            if (! is_file($cachePath)) {
                return null;
            }

            self::keep($file, 'svg', $cachePath);

            return $cachePath;
        } finally {
            Vault::cleanupLocalCopy($source);
        }
    }

    private static function sanitizeSvg(string $svg): string
    {
        $svg = preg_replace('#<script\b[^>]*>.*?</script>#is', '', $svg) ?? $svg;
        $svg = preg_replace('#<foreignObject\b[^>]*>.*?</foreignObject>#is', '', $svg) ?? $svg;
        $svg = preg_replace('#\son[a-z]+\s*=\s*"[^"]*"#i', '', $svg) ?? $svg;
        $svg = preg_replace("#\son[a-z]+\s*=\s*'[^']*'#i", '', $svg) ?? $svg;
        $svg = preg_replace('#(href|xlink:href)\s*=\s*(["\'])\s*javascript:[^"\']*\2#i', '$1="#"', $svg) ?? $svg;

        return $svg;
    }

    public static function delete(FileItem $file): void
    {
        foreach (['jpg', 'svg'] as $ext) {
            $path = self::cachePath($file, $ext);
            if (is_file($path)) {
                @unlink($path);
            }

            try {
                Vault::disk()->delete(self::vaultPath($file, $ext));
            } catch (\Throwable) {
                // A thumbnail that outlives its file costs a few KB and is
                // unreachable, never worth failing a delete over.
            }
        }
    }

    /** A tag for these bytes, so a reopened folder can be answered with a 304. */
    public static function entityTag(FileItem $file, string $ext): string
    {
        return '"'.substr(hash('sha256', $file->uuid.'|'.$file->storage_path.'|'.$ext.'|'.self::MAX), 0, 32).'"';
    }

    private static function cacheDir(): string
    {
        return Vault::tempRoot().'/thumbs';
    }

    private static function cachePath(FileItem $file, string $ext): string
    {
        return self::cacheDir().'/'.$file->uuid.'.'.$ext;
    }

    private static function ensureCacheDir(): void
    {
        if (! is_dir(self::cacheDir())) {
            @mkdir(self::cacheDir(), 0775, true);
        }
    }

    /** Where the durable copy lives, beside the vault the file came from. */
    private static function vaultPath(FileItem $file, string $ext): string
    {
        return 'thumbs/'.$file->uuid.'.'.$ext;
    }

    /**
     * Pull a previously generated thumbnail back into local scratch.
     *
     * One small object read, against re-downloading the whole original and
     * running GD over it. Silent on failure: the caller simply generates.
     */
    private static function restore(FileItem $file, string $ext, string $cachePath): bool
    {
        $disk = Vault::disk();
        if (config('filesystems.disks.'.Vault::diskName().'.driver') === 'local') {
            return false;
        }

        try {
            $bytes = $disk->get(self::vaultPath($file, $ext));
        } catch (\Throwable) {
            return false;
        }

        if ($bytes === null || $bytes === '') {
            return false;
        }

        self::ensureCacheDir();

        return @file_put_contents($cachePath, $bytes) !== false;
    }

    /** Keep the generated thumbnail where the next container can find it. */
    private static function keep(FileItem $file, string $ext, string $cachePath): void
    {
        if (config('filesystems.disks.'.Vault::diskName().'.driver') === 'local') {
            return;
        }

        try {
            $handle = fopen($cachePath, 'rb');
            if ($handle === false) {
                return;
            }
            Vault::disk()->writeStream(self::vaultPath($file, $ext), $handle);
            if (is_resource($handle)) {
                fclose($handle);
            }
        } catch (\Throwable) {
            // The thumbnail is already on screen; not persisting it only means
            // the next container generates it again.
        }
    }

    /** Rotate a JPEG resource to match its EXIF orientation (phone photos). */
    private static function applyExifOrientation($img, string $path)
    {
        if (! function_exists('exif_read_data')) {
            return $img;
        }
        $exif = @exif_read_data($path);
        $orientation = $exif['Orientation'] ?? null;
        if ($orientation === 3) {
            $img = imagerotate($img, 180, 0);
        } elseif ($orientation === 6) {
            $img = imagerotate($img, -90, 0);
        } elseif ($orientation === 8) {
            $img = imagerotate($img, 90, 0);
        }

        return $img;
    }
}
