<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Stores uploaded profile photos: centre-crops to a square, resizes to a
 * consistent size, and writes a JPEG to public storage. Uses GD (bundled with
 * PHP) so there's no extra image dependency.
 */
class AvatarService
{
    private const SIZE = 320;

    /**
     * Process an uploaded image and return its public URL (/storage/avatars/…).
     * Deletes the previous uploaded photo when replacing one.
     */
    public static function storeUploaded(UploadedFile $file, ?string $previousUrl = null): string
    {
        $data = @file_get_contents($file->getRealPath());
        if ($data === false) {
            abort(422, 'That image could not be read. Try a JPG, PNG, or WebP.');
        }

        return self::store($data, $previousUrl);
    }

    /**
     * Store raw image bytes (e.g. a provider photo fetched from Graph). Returns
     * null when the bytes aren't a readable image, so callers can skip quietly.
     */
    public static function storeBinary(string $binary, ?string $previousUrl = null): ?string
    {
        if ($binary === '' || ! @imagecreatefromstring($binary)) {
            return null;
        }

        return self::store($binary, $previousUrl);
    }

    private static function store(string $binary, ?string $previousUrl): string
    {
        $src = @imagecreatefromstring($binary);
        if (! $src) {
            abort(422, 'That image could not be read. Try a JPG, PNG, or WebP.');
        }

        $w = imagesx($src);
        $h = imagesy($src);
        $side = min($w, $h);
        $srcX = (int) (($w - $side) / 2);
        $srcY = (int) (($h - $side) / 2);

        $dst = imagecreatetruecolor(self::SIZE, self::SIZE);
        imagecopyresampled($dst, $src, 0, 0, $srcX, $srcY, self::SIZE, self::SIZE, $side, $side);

        $name = 'avatars/'.Str::uuid()->toString().'.jpg';
        ob_start();
        imagejpeg($dst, null, 88);
        Storage::disk('public')->put($name, (string) ob_get_clean());

        self::deletePrevious($previousUrl);

        return '/storage/'.$name;
    }

    /** Remove a previously uploaded photo (leaves provider/system URLs alone). */
    public static function deletePrevious(?string $url): void
    {
        if ($url && str_starts_with($url, '/storage/')) {
            Storage::disk('public')->delete(substr($url, strlen('/storage/')));
        }
    }
}
