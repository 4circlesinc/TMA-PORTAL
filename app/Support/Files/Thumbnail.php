<?php

namespace App\Support\Files;

use App\Models\FileItem;

/**
 * Generates and caches small image thumbnails with GD (the only image tool
 * available on this stack — no imagick/ffmpeg/ghostscript, so PDFs/videos fall
 * back to their type icon on the client). Cached under the private disk so a
 * thumbnail is only rendered once per file.
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

        $cacheDir = Vault::tempRoot().'/thumbs';
        $cachePath = $cacheDir.'/'.$file->uuid.'.jpg';
        if (is_file($cachePath)) {
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

            if (! is_dir($cacheDir)) {
                @mkdir($cacheDir, 0775, true);
            }
            @imagejpeg($thumb, $cachePath, 82);
            imagedestroy($img);
            imagedestroy($thumb);

            return is_file($cachePath) ? $cachePath : null;
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

        $cacheDir = Vault::tempRoot().'/thumbs';
        $cachePath = $cacheDir.'/'.$file->uuid.'.svg';
        if (is_file($cachePath)) {
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

            if (! is_dir($cacheDir)) {
                @mkdir($cacheDir, 0775, true);
            }
            @file_put_contents($cachePath, $svg);

            return is_file($cachePath) ? $cachePath : null;
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
            $path = Vault::tempRoot().'/thumbs/'.$file->uuid.'.'.$ext;
            if (is_file($path)) {
                @unlink($path);
            }
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
