<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Support\SharePoint\RemoteContent;
use App\Models\FileVersion;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

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
    /*
     * How long a signed link to the object store lives, and how long the
     * redirect that carries it may be reused. The second is well under the
     * first so a reader flipping back and forth never lands on a signature
     * that expired while the redirect was still cached.
     */
    private const SIGNED_URL_SECONDS = 900;

    private const SIGNED_URL_REUSE_SECONDS = 300;

    /*
     * Long enough that reopening a file costs nothing, and revalidated rather
     * than assumed: the ETag moves the moment a new version is written, so a
     * colleague's upload is never hidden behind a cached copy.
     */
    private const CACHE_CONTROL = 'private, max-age=600, must-revalidate';

    private const CHUNK_BYTES = 262144;

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
    public static function downloadVersion(FileVersion $version, string $name): SymfonyResponse
    {
        return self::streamVersion($version, $name, 'attachment');
    }

    public static function previewVersion(FileVersion $version, string $name): SymfonyResponse
    {
        return self::streamVersion($version, $name, 'inline');
    }

    private static function streamVersion(FileVersion $version, string $name, string $disposition): SymfonyResponse
    {
        // Version 1 of an imported file is a placeholder until the file
        // itself is materialised, so pull the bytes through the file.
        if ($version->content_state === RemoteContent::PENDING && $version->file) {
            RemoteContent::ensure($version->file);
            $version->refresh();
        }

        $diskName = $version->disk ?: self::diskName();

        abort_unless((bool) $version->storage_path, 404, 'That version is no longer in storage.');

        $mime = $version->mime_type ?: 'application/octet-stream';

        return self::deliver(
            Storage::disk($diskName),
            $diskName,
            $version->storage_path,
            $name,
            $mime,
            $disposition,
            // A version's bytes never change once written — its own vault path
            // is a fresh uuid — so the tag is simply the path.
            '"'.substr(hash('sha256', (string) $version->storage_path), 0, 32).'"',
            self::mayRedirect($mime, $disposition),
        );
    }

    /** Permanently remove the physical bytes for a file. */
    public static function delete(FileItem $file): void
    {
        if ($file->storage_path) {
            self::diskFor($file)->delete($file->storage_path);
        }
    }

    /**
     * Bytes to a reader, by download or inline preview.
     *
     * @see self::deliver() for why this is not simply a readStream + fpassthru.
     */
    public static function download(FileItem $file): SymfonyResponse
    {
        return self::stream($file, 'attachment');
    }

    public static function preview(FileItem $file): SymfonyResponse
    {
        return self::stream($file, 'inline');
    }

    private static function stream(FileItem $file, string $disposition): SymfonyResponse
    {
        /*
         * A file imported from SharePoint has a record before it has bytes, so
         * the first read is what pulls them across. Hooking it here rather than
         * in the download controller means preview, signing, zipping and copy
         * all inherit it — none of them should have to know a file arrived by
         * reference.
         */
        if (RemoteContent::isPending($file)) {
            if (! RemoteContent::ensure($file)) {
                throw new FileValidationException('That file could not be fetched from SharePoint.');
            }

            // Only then: ensure() is what rewrites storage_path, and an
            // unconditional refresh put a database round trip in front of
            // every thumbnail in every folder.
            $file->refresh();
        }

        if (! $file->storage_path) {
            throw new FileValidationException('File no longer exists.');
        }

        return self::deliver(
            Storage::disk($file->disk ?: self::diskName()),
            $file->disk ?: self::diskName(),
            $file->storage_path,
            $file->name,
            $file->mime_type ?: 'application/octet-stream',
            $disposition,
            self::entityTag($file),
            self::mayRedirect($file->mime_type, $disposition),
        );
    }

    /*
     * Hand the bytes over in whichever way is fastest for where they live.
     *
     * THE THREE PATHS, AND WHY THERE ARE THREE
     *
     * Everything here used to be one: `readStream` into `fpassthru`. Measured
     * against the R2 bucket that is production, that path spent 9.8 seconds on
     * a 40 MB PDF before the reader saw a single byte — because Flysystem's S3
     * stream is not a stream at all, it downloads the whole object and only
     * then answers the first `fread`. Two `HEAD`s (`exists` then `size`) went
     * ahead of it, half a second each, and the response forbade caching, so
     * every reopen paid all of it again. That is the "why is a photo taking
     * ten seconds" this exists to end.
     *
     *  1. Local disk → `response()->file()`. Range, ETag and Last-Modified for
     *     free, which is what lets a video seek and a reopen answer 304.
     *  2. Remote, and the browser will load it through an element `src`
     *     (image/video/audio) → a short-lived signed URL to the object store,
     *     so the bytes travel Cloudflare→reader instead of Cloudflare→us→
     *     reader. ~280ms to first byte against ~10s.
     *  3. Remote, anything else → a real streaming GetObject, forwarding
     *     Range. First byte in ~0.5s, and pdf.js can ask for page 1 alone.
     *
     * Path 2 is deliberately not used for documents: a signed URL is another
     * origin, and pdf.js and the text preview read them with `fetch`, which a
     * cross-origin redirect turns into a CORS request the bucket does not
     * answer. Widening it is a bucket CORS rule away, not a code change.
     */
    private static function deliver(
        Filesystem $disk,
        string $diskName,
        string $path,
        string $name,
        string $mime,
        string $disposition,
        ?string $etag,
        bool $mayRedirect,
    ): SymfonyResponse {
        $request = request();

        /*
         * The reopen. Answered before storage is touched at all: the whole
         * point is that looking at the same contract twice costs one small
         * round trip rather than another copy of the file.
         */
        if ($etag !== null && ! $mayRedirect && $request && self::etagMatches($request->headers->get('If-None-Match'), $etag)) {
            return response('', 304, [
                'ETag' => $etag,
                'Cache-Control' => self::CACHE_CONTROL,
            ]);
        }

        $abs = self::localAbsPath($diskName, $path);
        if ($abs !== null) {
            if (! is_file($abs)) {
                throw new FileValidationException('File no longer exists.');
            }

            $response = response()->file($abs, array_filter([
                'Content-Type' => $mime,
                'X-Content-Type-Options' => 'nosniff',
                'Cache-Control' => self::CACHE_CONTROL,
                'ETag' => $etag,
            ]));
            $response->setContentDisposition($disposition, $name, self::asciiName($name));
            // setAutoEtag() would hash the whole file on every request; the tag
            // above says the same thing from columns we already hold.
            $response->setAutoLastModified();
            if ($request) {
                $response->isNotModified($request);
            }

            return $response;
        }

        if ($mayRedirect) {
            $signed = self::signedUrl($disk, $path, $name, $mime, $disposition);
            if ($signed !== null) {
                /*
                 * The redirect is cacheable but the URL inside it expires, so
                 * the two figures are set together: hold the redirect for well
                 * under the signature's life and a reader flipping back and
                 * forth never lands on a stale signature.
                 */
                return redirect()->away($signed, 302, [
                    'Cache-Control' => 'private, max-age='.self::SIGNED_URL_REUSE_SECONDS,
                ]);
            }
        }

        return self::proxy($disk, $diskName, $path, $name, $mime, $disposition, $etag, $request);
    }

    /** A short-lived direct link to the object store, or null if unsupported. */
    private static function signedUrl(Filesystem $disk, string $path, string $name, string $mime, string $disposition): ?string
    {
        try {
            return $disk->temporaryUrl($path, now()->addSeconds(self::SIGNED_URL_SECONDS), [
                'ResponseContentType' => $mime,
                'ResponseContentDisposition' => $disposition.'; filename="'.self::asciiName($name).'"',
            ]);
        } catch (\Throwable) {
            // A disk that cannot sign (or a misconfigured one) is not a reason
            // to fail the read — the proxy below still serves it.
            return null;
        }
    }

    /**
     * Stream a remote object through us, honouring Range.
     *
     * `getObject` with `@http.stream` is the difference between this and what
     * Flysystem does: headers come back in ~0.5s and the body arrives as it is
     * read, rather than the whole object landing in this process's memory
     * first. Range is forwarded, so a video seeks and pdf.js can pull one page
     * out of a 200-page scan.
     */
    private static function proxy(
        Filesystem $disk,
        string $diskName,
        string $path,
        string $name,
        string $mime,
        string $disposition,
        ?string $etag,
        ?\Illuminate\Http\Request $request,
    ): SymfonyResponse {
        $client = self::objectClient($disk);
        $bucket = config('filesystems.disks.'.$diskName.'.bucket');

        $headers = array_filter([
            'Content-Type' => $mime,
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => self::CACHE_CONTROL,
            'ETag' => $etag,
        ]);

        if ($client === null || ! $bucket) {
            // Any other remote driver: the old whole-object read, which at
            // least still works.
            $stream = $disk->readStream($path);
            if ($stream === false || $stream === null) {
                throw new FileValidationException('File no longer exists.');
            }

            $response = response()->stream(function () use ($stream) {
                fpassthru($stream);
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }, 200, $headers);
            $response->headers->set('Content-Disposition', $response->headers->makeDisposition($disposition, $name, self::asciiName($name)));

            return $response;
        }

        $range = $request?->headers->get('Range');
        $params = array_filter([
            'Bucket' => $bucket,
            'Key' => $path,
            'Range' => $range ?: null,
        ]);
        $params['@http'] = ['stream' => true];

        try {
            $result = $client->getObject($params);
        } catch (\Throwable $e) {
            // A Range the object cannot satisfy is the reader's problem, not
            // a missing file — say so rather than claiming the file is gone.
            if ($range && str_contains($e->getMessage(), 'InvalidRange')) {
                abort(416, 'That range is not satisfiable.');
            }

            throw new FileValidationException('File no longer exists.');
        }

        $body = $result['Body'];
        $status = isset($result['ContentRange']) ? 206 : 200;
        $headers['Accept-Ranges'] = 'bytes';

        if (isset($result['ContentRange'])) {
            $headers['Content-Range'] = $result['ContentRange'];
        }
        if (isset($result['ContentLength'])) {
            $headers['Content-Length'] = (string) $result['ContentLength'];
        }

        $response = response()->stream(function () use ($body) {
            $handle = is_object($body) && method_exists($body, 'detach') ? $body->detach() : null;
            if (is_resource($handle)) {
                // No flush(): flushing alongside a Content-Length makes PHP
                // chunk the body, and pdf.js waits for bytes that never come
                // under that mix.
                stream_copy_to_stream($handle, fopen('php://output', 'wb'));
                fclose($handle);

                return;
            }

            while (is_object($body) && ! $body->eof()) {
                echo $body->read(self::CHUNK_BYTES);
            }
        }, $status, $headers);

        $response->headers->set('Content-Disposition', $response->headers->makeDisposition($disposition, $name, self::asciiName($name)));

        return $response;
    }

    /** The S3 client behind a disk, or null when it is not that kind of disk. */
    private static function objectClient(Filesystem $disk): ?object
    {
        if (! method_exists($disk, 'getClient')) {
            return null;
        }

        try {
            $client = $disk->getClient();

            /*
             * getObject is NOT a real method on the AWS client — every S3 call
             * is generated through __call, so method_exists('getObject') is
             * false and this used to fall back to the slow whole-object read
             * every single time. getCommand is declared, so it is the honest
             * test for "this is an AWS client".
             */
            return is_object($client) && method_exists($client, 'getCommand') ? $client : null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Which reads may go straight to the object store.
     *
     * Only the ones the browser loads through an element `src` — those follow
     * a cross-origin redirect without asking anybody's permission. SVG is out
     * because the portal never serves one raw; it goes through the sanitising
     * thumbnail route.
     */
    private static function mayRedirect(?string $mimeType, string $disposition): bool
    {
        if ($disposition !== 'inline' || ! config('filesystems.files_signed_urls', true)) {
            return false;
        }

        $mime = strtolower(trim(explode(';', (string) $mimeType)[0]));

        if ($mime === 'image/svg+xml') {
            return false;
        }

        return str_starts_with($mime, 'image/')
            || str_starts_with($mime, 'video/')
            || str_starts_with($mime, 'audio/');
    }

    /**
     * A tag for these exact bytes.
     *
     * The checksum when we have one; otherwise the vault path, which is a
     * fresh uuid for every version written, plus the size. Either way it moves
     * when the content does and stands still when it does not — which is the
     * whole contract a reopen relies on.
     */
    private static function entityTag(FileItem $file): ?string
    {
        $seed = $file->checksum ?: ($file->storage_path.'|'.$file->size.'|'.$file->version_number);

        return $seed ? '"'.substr(hash('sha256', $seed), 0, 32).'"' : null;
    }

    /** Does an If-None-Match header cover this tag? */
    private static function etagMatches(?string $header, string $etag): bool
    {
        if ($header === null || $header === '') {
            return false;
        }

        if (trim($header) === '*') {
            return true;
        }

        foreach (explode(',', $header) as $candidate) {
            if (ltrim(trim($candidate), 'W/') === $etag) {
                return true;
            }
        }

        return false;
    }

    /**
     * A filename safe to put in a header.
     *
     * Content-Disposition is a ByteString; a client's name in Arabic or with a
     * curly quote used to go out raw and be dropped (or worse, split the
     * header) on the way. Symfony sends this as the fallback and the real name
     * as filename*.
     */
    private static function asciiName(string $name): string
    {
        $ascii = Str::ascii($name);
        $ascii = preg_replace('/[^\x20-\x7e]/', '', $ascii) ?? '';
        $ascii = str_replace(['"', '\\', '%', '/'], '-', $ascii);

        return trim($ascii) !== '' ? $ascii : 'file';
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
        $abs = self::localAbsPath($file->disk ?: self::diskName(), (string) $file->storage_path);
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

    /** Absolute local path for bytes on a local-driver disk, else null. */
    private static function localAbsPath(string $diskName, string $path): ?string
    {
        if (config('filesystems.disks.'.$diskName.'.driver') !== 'local') {
            return null;
        }

        $root = rtrim(config('filesystems.disks.'.$diskName.'.root', storage_path('app/private')), '/');

        return $root.'/'.$path;
    }
}
