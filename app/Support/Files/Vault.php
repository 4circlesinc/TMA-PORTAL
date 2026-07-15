<?php

namespace App\Support\Files;

use App\Models\FileItem;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The physical file store. Files live on a private disk under
 * storage/app/private/vault/{yyyy}/{mm}/{uuid}.{ext} — outside the web root,
 * with random names. Nothing here (path or disk) is ever exposed to clients;
 * bytes are only reachable through the authorized download/preview controllers.
 */
class Vault
{
    public const DISK = 'local';

    /** Absolute path to the private storage root (the 'local' disk root). */
    public static function root(): string
    {
        return rtrim(config('filesystems.disks.'.self::DISK.'.root', storage_path('app/private')), '/');
    }

    /** Temp directory for an in-progress chunked upload. */
    public static function uploadDir(string $sessionUuid): string
    {
        return self::root().'/uploads/'.$sessionUuid;
    }

    public static function absolutePath(FileItem $file): string
    {
        return self::root().'/'.$file->storage_path;
    }

    /**
     * Move an assembled/temp file into the vault. Returns the stored metadata
     * (uuid, disk, relative path, size, checksum). Uses rename when possible so
     * 2 GB files aren't copied through memory.
     */
    public static function store(string $sourceAbsPath, string $ext): array
    {
        $uuid = (string) Str::uuid();
        $relDir = 'vault/'.date('Y').'/'.date('m');
        $absDir = self::root().'/'.$relDir;

        if (! is_dir($absDir)) {
            @mkdir($absDir, 0775, true);
        }

        $filename = $uuid.($ext !== '' ? '.'.$ext : '');
        $relPath = $relDir.'/'.$filename;
        $absPath = $absDir.'/'.$filename;

        if (! @rename($sourceAbsPath, $absPath)) {
            if (! @copy($sourceAbsPath, $absPath)) {
                throw new FileValidationException('Storage unavailable — the file could not be saved.');
            }
            @unlink($sourceAbsPath);
        }

        return [
            'uuid' => $uuid,
            'disk' => self::DISK,
            'path' => $relPath,
            'size' => filesize($absPath) ?: 0,
            'checksum' => hash_file('sha256', $absPath) ?: null,
        ];
    }

    /** Duplicate an existing file's bytes to a new vault path (copy/paste). */
    public static function duplicate(FileItem $file): array
    {
        $source = self::absolutePath($file);
        if (! is_file($source)) {
            throw new FileValidationException('The original file no longer exists.');
        }

        $uuid = (string) Str::uuid();
        $relDir = 'vault/'.date('Y').'/'.date('m');
        $absDir = self::root().'/'.$relDir;

        if (! is_dir($absDir)) {
            @mkdir($absDir, 0775, true);
        }

        $ext = $file->extension ?: '';
        $filename = $uuid.($ext !== '' ? '.'.$ext : '');
        $relPath = $relDir.'/'.$filename;

        if (! @copy($source, $absDir.'/'.$filename)) {
            throw new FileValidationException('Storage unavailable — the file could not be copied.');
        }

        return ['uuid' => $uuid, 'disk' => self::DISK, 'path' => $relPath];
    }

    /** Permanently remove the physical bytes for a file. */
    public static function delete(FileItem $file): void
    {
        $path = self::absolutePath($file);
        if (is_file($path)) {
            @unlink($path);
        }
    }

    public static function download(FileItem $file): StreamedResponse
    {
        return self::stream($file, 'attachment');
    }

    public static function preview(FileItem $file): StreamedResponse
    {
        return self::stream($file, 'inline');
    }

    private static function stream(FileItem $file, string $disposition): StreamedResponse
    {
        $path = self::absolutePath($file);

        if (! is_file($path)) {
            throw new FileValidationException('File no longer exists.');
        }

        $name = $file->name;
        $mime = $file->mime_type ?: 'application/octet-stream';

        return response()->stream(function () use ($path) {
            $stream = fopen($path, 'rb');
            if ($stream === false) {
                return;
            }
            while (! feof($stream)) {
                echo fread($stream, 8192);
                flush();
            }
            fclose($stream);
        }, 200, [
            'Content-Type' => $mime,
            'Content-Length' => (string) (filesize($path) ?: 0),
            'Content-Disposition' => $disposition.'; filename="'.addslashes($name).'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=0, no-cache',
        ]);
    }
}
