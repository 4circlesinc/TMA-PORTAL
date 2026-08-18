<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Support\SharePoint\RemoteContent;
use App\Models\FileVersion;
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

    /**
     * Copy an older version's bytes to a fresh vault path.
     *
     * Restoring gets its own blob rather than pointing a second version row at
     * the same path: one version owns exactly one blob, so purging any version
     * can never blank another.
     *
     * @return array{uuid:string, disk:string, path:string}
     */
    public static function duplicateVersion(FileVersion $version): array
    {
        $srcDisk = Storage::disk($version->disk ?: self::diskName());
        if (! $version->storage_path || ! $srcDisk->exists($version->storage_path)) {
            throw new FileValidationException('That version’s file is no longer in storage.');
        }

        $uuid = (string) Str::uuid();
        $relPath = self::relPath($uuid, $version->extension ?: '');

        if (($version->disk ?: self::diskName()) === self::diskName()
            && $srcDisk->copy($version->storage_path, $relPath)) {
            return ['uuid' => $uuid, 'disk' => self::diskName(), 'path' => $relPath];
        }

        $in = $srcDisk->readStream($version->storage_path);
        if ($in === false || $in === null) {
            throw new FileValidationException('Storage unavailable — that version could not be copied.');
        }
        try {
            $ok = self::disk()->writeStream($relPath, $in);
        } finally {
            if (is_resource($in)) {
                fclose($in);
            }
        }
        if (! $ok) {
            throw new FileValidationException('Storage unavailable — that version could not be copied.');
        }

        return ['uuid' => $uuid, 'disk' => self::diskName(), 'path' => $relPath];
    }

    /** Stream one specific version, by download or inline preview. */
    public static function downloadVersion(FileVersion $version, string $name): StreamedResponse
    {
        return self::streamVersion($version, $name, 'attachment');
    }

    public static function previewVersion(FileVersion $version, string $name): StreamedResponse
    {
        return self::streamVersion($version, $name, 'inline');
    }

    private static function streamVersion(FileVersion $version, string $name, string $disposition): StreamedResponse
    {
        // Version 1 of an imported file is a placeholder until the file
        // itself is materialised, so pull the bytes through the file.
        if ($version->content_state === RemoteContent::PENDING && $version->file) {
            RemoteContent::ensure($version->file);
            $version->refresh();
        }

        $disk = Storage::disk($version->disk ?: self::diskName());

        abort_unless($version->storage_path && $disk->exists($version->storage_path), 404, 'That version is no longer in storage.');

        return response()->stream(function () use ($disk, $version) {
            $stream = $disk->readStream($version->storage_path);
            if ($stream === false || $stream === null) {
                return;
            }
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, array_filter([
            'Content-Type' => $version->mime_type ?: 'application/octet-stream',
            'Content-Length' => self::byteLength($disk, $version->storage_path, $version->size),
            'Content-Disposition' => $disposition.'; filename="'.addslashes($name).'"',
            // A version is immutable once written, so it can be cached hard.
            'Cache-Control' => 'private, max-age=3600',
        ]));
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
        /*
         * A file imported from SharePoint has a record before it has bytes, so
         * the first read is what pulls them across. Hooking it here rather than
         * in the download controller means preview, signing, zipping and copy
         * all inherit it — none of them should have to know a file arrived by
         * reference.
         */
        if (RemoteContent::isPending($file) && ! RemoteContent::ensure($file)) {
            throw new FileValidationException('That file could not be fetched from SharePoint.');
        }

        $file->refresh();
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
            // fpassthru, not a flushed loop: flush() plus Content-Length
            // makes PHP chunk the body, and pdf.js waits for bytes that
            // never arrive under that mix.
            fpassthru($stream);
            if (is_resource($stream)) {
                fclose($stream);
            }
        }, 200, array_filter([
            'Content-Type' => $mime,
            'Content-Length' => self::byteLength($disk, $file->storage_path, $file->size),
            'Content-Disposition' => $disposition.'; filename="'.addslashes($name).'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=0, no-cache',
        ]));
    }

    /**
     * Bytes on disk, not the column.
     *
     * pdf.js (and fetch) wait until Content-Length bytes arrive. A recorded
     * size that is larger than the file — a SharePoint placeholder, a failed
     * write — leaves the viewer on "Loading PDF…" forever. Prefer the real
     * length; omit the header if we cannot know it.
     */
    private static function byteLength(Filesystem $disk, string $path, mixed $recorded): ?string
    {
        try {
            $n = (int) $disk->size($path);
            if ($n > 0) {
                return (string) $n;
            }
        } catch (\Throwable) {
            // fall through to the recorded size
        }

        $n = (int) $recorded;

        return $n > 0 ? (string) $n : null;
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
