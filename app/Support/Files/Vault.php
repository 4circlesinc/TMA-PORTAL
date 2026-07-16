<?php

namespace App\Support\Files;

use App\Models\FileItem;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The physical file store. Durable bytes live on the configured "files" disk —
 * the local private disk in dev, or object storage (Cloudflare R2) in production
 * so uploads survive deploys. Files are stored under vault/{yyyy}/{mm}/{uuid}.{ext}
 * with random names; nothing here (path or disk) is exposed to clients — bytes
 * are only reachable through the authorized download/preview controllers.
 *
 * Transient work (chunk assembly, thumbnail cache, temp downloads) always uses
 * local scratch, independent of where durable bytes live. Each file records the
 * disk it was written to, so files uploaded before a disk switch keep working.
 */
class Vault
{
    /** The disk new uploads are written to (from config). */
    public static function disk(): Filesystem
    {
        return Storage::disk(self::diskName());
    }

    public static function diskName(): string
    {
        return config('filesystems.files_disk', 'local');
    }

    /** The disk a specific stored file lives on (respects its saved `disk`). */
    private static function diskFor(FileItem $file): Filesystem
    {
        return Storage::disk($file->disk ?: self::diskName());
    }

    /**
     * Local scratch root for transient work — always the local private disk,
     * regardless of where durable bytes live.
     */
    public static function tempRoot(): string
    {
        return rtrim(config('filesystems.disks.local.root', storage_path('app/private')), '/');
    }

    /** Temp directory for an in-progress chunked upload. */
    public static function uploadDir(string $sessionUuid): string
    {
        return self::tempRoot().'/uploads/'.$sessionUuid;
    }

    /**
     * Move an assembled/temp local file into the vault on the configured disk.
     * Returns the stored metadata (uuid, disk, relative path, size, checksum).
     * Streams the upload so 2 GB files aren't loaded into memory.
     */
    public static function store(string $sourceAbsPath, string $ext): array
    {
        $uuid = (string) Str::uuid();
        $relPath = self::relPath($uuid, $ext);

        $size = filesize($sourceAbsPath) ?: 0;
        $checksum = hash_file('sha256', $sourceAbsPath) ?: null;

        $in = fopen($sourceAbsPath, 'rb');
        if ($in === false) {
            throw new FileValidationException('Storage unavailable — the file could not be read.');
        }

        try {
            $ok = self::disk()->writeStream($relPath, $in);
        } finally {
            if (is_resource($in)) {
                fclose($in);
            }
        }

        if (! $ok) {
            throw new FileValidationException('Storage unavailable — the file could not be saved.');
        }

        @unlink($sourceAbsPath);

        return [
            'uuid' => $uuid,
            'disk' => self::diskName(),
            'path' => $relPath,
            'size' => $size,
            'checksum' => $checksum,
        ];
    }

    /** Duplicate an existing file's bytes to a new vault path (copy/paste). */
    public static function duplicate(FileItem $file): array
    {
        $srcDisk = self::diskFor($file);
        if (! $file->storage_path || ! $srcDisk->exists($file->storage_path)) {
            throw new FileValidationException('The original file no longer exists.');
        }

        $uuid = (string) Str::uuid();
        $relPath = self::relPath($uuid, $file->extension ?: '');

        // Same disk → let the driver copy server-side (S3 CopyObject, local FS).
        if (($file->disk ?: self::diskName()) === self::diskName() && $srcDisk->copy($file->storage_path, $relPath)) {
            return ['uuid' => $uuid, 'disk' => self::diskName(), 'path' => $relPath];
        }

        // Different disk (or copy unsupported) → stream the bytes across.
        $in = $srcDisk->readStream($file->storage_path);
        if ($in === false || $in === null) {
            throw new FileValidationException('Storage unavailable — the file could not be copied.');
        }
        try {
            $ok = self::disk()->writeStream($relPath, $in);
        } finally {
            if (is_resource($in)) {
                fclose($in);
            }
        }
        if (! $ok) {
            throw new FileValidationException('Storage unavailable — the file could not be copied.');
        }

        return ['uuid' => $uuid, 'disk' => self::diskName(), 'path' => $relPath];
    }

    /** Permanently remove the physical bytes for a file. */
    public static function delete(FileItem $file): void
    {
        if ($file->storage_path) {
            self::diskFor($file)->delete($file->storage_path);
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
        $disk = self::diskFor($file);

        if (! $file->storage_path || ! $disk->exists($file->storage_path)) {
            throw new FileValidationException('File no longer exists.');
        }

        $name = $file->name;
        $mime = $file->mime_type ?: 'application/octet-stream';

        return response()->stream(function () use ($disk, $file) {
            $stream = $disk->readStream($file->storage_path);
            if ($stream === false || $stream === null) {
                return;
            }
            while (! feof($stream)) {
                echo fread($stream, 8192);
                flush();
            }
            fclose($stream);
        }, 200, array_filter([
            'Content-Type' => $mime,
            'Content-Length' => $file->size ? (string) $file->size : null,
            'Content-Disposition' => $disposition.'; filename="'.addslashes($name).'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=0, no-cache',
        ]));
    }

    /**
     * A path to the file's bytes on the LOCAL filesystem — the real vault path
     * when it lives on a local disk, or a temp download when it lives remotely.
     * Callers MUST pass the result to cleanupLocalCopy() when done.
     */
    public static function localCopy(FileItem $file): ?string
    {
        $disk = self::diskFor($file);
        if (! $file->storage_path || ! $disk->exists($file->storage_path)) {
            return null;
        }

        // Local-driver disk: use the real file in place (no copy, no cleanup).
        $abs = self::localAbsPath($file);
        if ($abs !== null) {
            return is_file($abs) ? $abs : null;
        }

        // Remote disk: stream a copy down to local scratch.
        $tmpDir = self::tempRoot().'/tmp';
        if (! is_dir($tmpDir)) {
            @mkdir($tmpDir, 0775, true);
        }
        $tmp = $tmpDir.'/'.Str::uuid()->toString().($file->extension ? '.'.$file->extension : '');

        $in = $disk->readStream($file->storage_path);
        if ($in === false || $in === null) {
            return null;
        }
        $out = fopen($tmp, 'wb');
        if ($out === false) {
            fclose($in);

            return null;
        }
        stream_copy_to_stream($in, $out);
        fclose($in);
        fclose($out);

        return is_file($tmp) ? $tmp : null;
    }

    /** Delete a temp local copy (no-op for real local-disk paths). */
    public static function cleanupLocalCopy(?string $path): void
    {
        if ($path && str_starts_with($path, self::tempRoot().'/tmp/') && is_file($path)) {
            @unlink($path);
        }
    }

    private static function relPath(string $uuid, string $ext): string
    {
        return 'vault/'.date('Y').'/'.date('m').'/'.$uuid.($ext !== '' ? '.'.$ext : '');
    }

    /** Absolute local path for a file stored on a local-driver disk, else null. */
    private static function localAbsPath(FileItem $file): ?string
    {
        $diskName = $file->disk ?: self::diskName();
        if (config('filesystems.disks.'.$diskName.'.driver') !== 'local') {
            return null;
        }

        $root = rtrim(config('filesystems.disks.'.$diskName.'.root', storage_path('app/private')), '/');

        return $root.'/'.$file->storage_path;
    }
}
