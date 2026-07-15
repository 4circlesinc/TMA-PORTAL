<?php

namespace App\Support\Files;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\UploadSession;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Resumable chunked uploads (up to 2 GB). A file is only ever persisted once
 * every chunk has arrived, the parts are assembled, the assembled bytes pass
 * validation, and the row is saved — never before. Failed or abandoned sessions
 * leave no "completed" file record behind.
 */
class ChunkedUpload
{
    /** Default chunk size when the client doesn't specify (8 MB). */
    public const DEFAULT_CHUNK = 8 * 1024 * 1024;

    /** Sessions expire after 24h of inactivity and get cleaned up. */
    public const TTL_HOURS = 24;

    public static function init(User $user, string $filename, int $size, ?Folder $folder, int $chunkSize = 0, ?string $mime = null): UploadSession
    {
        $filename = Naming::assertValid($filename);

        if ($size < 0) {
            throw new FileValidationException('Invalid file size.');
        }
        if ($size > FileType::MAX_BYTES) {
            throw new FileValidationException('File exceeds the 2 GB limit.');
        }

        // Cheap early rejection by extension; the assembled bytes are
        // re-checked (extension + real MIME) at complete().
        if (FileType::isExtensionBlocked(FileType::extensionOf($filename))) {
            throw new FileValidationException('That file type is not allowed for security reasons.');
        }

        $chunkSize = $chunkSize > 0 ? $chunkSize : self::DEFAULT_CHUNK;
        $totalChunks = max(1, (int) ceil($size / $chunkSize));

        $uuid = (string) Str::uuid();
        $tempDir = Vault::uploadDir($uuid);
        if (! is_dir($tempDir)) {
            @mkdir($tempDir, 0775, true);
        }

        return UploadSession::create([
            'uuid' => $uuid,
            'user_id' => $user->id,
            'folder_id' => $folder?->id,
            'filename' => $filename,
            'size' => $size,
            'mime_declared' => $mime,
            'chunk_size' => $chunkSize,
            'total_chunks' => $totalChunks,
            'received_count' => 0,
            'status' => UploadSession::STATUS_PENDING,
            'temp_path' => 'uploads/'.$uuid,
            'expires_at' => now()->addHours(self::TTL_HOURS),
        ]);
    }

    public static function receiveChunk(UploadSession $session, int $index, string $sourceTmpPath): UploadSession
    {
        if (in_array($session->status, [UploadSession::STATUS_COMPLETED, UploadSession::STATUS_CANCELLED], true)) {
            throw new FileValidationException('This upload session is no longer active.');
        }

        if ($index < 0 || $index >= $session->total_chunks) {
            throw new FileValidationException('Invalid chunk index.');
        }

        $dir = Vault::uploadDir($session->uuid);
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $target = $dir.'/'.$index.'.part';
        if (! @rename($sourceTmpPath, $target)) {
            if (! @copy($sourceTmpPath, $target)) {
                throw new FileValidationException('Upload interrupted — a chunk could not be stored.');
            }
            @unlink($sourceTmpPath);
        }

        $received = self::partsPresent($dir, $session->total_chunks);

        // Guard against an oversized assembly from misbehaving clients.
        if (self::partsBytes($dir) > FileType::MAX_BYTES) {
            self::removeDir($dir);
            $session->update(['status' => UploadSession::STATUS_FAILED]);
            throw new FileValidationException('File exceeds the 2 GB limit.');
        }

        $session->update([
            'status' => UploadSession::STATUS_UPLOADING,
            'received_count' => count($received),
            'expires_at' => now()->addHours(self::TTL_HOURS),
        ]);

        return $session->refresh();
    }

    /** Which chunk indexes have already been received (for resume). */
    public static function receivedIndexes(UploadSession $session): array
    {
        return array_values(self::partsPresent(Vault::uploadDir($session->uuid), $session->total_chunks));
    }

    /**
     * Assemble, validate, and persist the file. $conflict is one of
     * replace|keep-both|rename; $newName is required for rename.
     */
    public static function complete(UploadSession $session, ?string $conflict = null, ?string $newName = null): FileItem
    {
        $dir = Vault::uploadDir($session->uuid);
        $indexes = self::partsPresent($dir, $session->total_chunks);

        if (count($indexes) !== $session->total_chunks) {
            throw new FileValidationException('Upload could not be completed — some parts are missing. Please retry.');
        }

        // Detect a name conflict BEFORE assembling/storing, so the client can
        // choose Replace / Keep both / Rename with the chunks still intact.
        if ($conflict === null) {
            $clean = Naming::clean($session->filename);
            if (self::existingQuery($session, $clean)->exists()) {
                throw new UploadConflictException(
                    $clean,
                    Naming::nextAvailable($clean, fn ($c) => self::existingQuery($session, $c)->exists())
                );
            }
        }

        $session->update(['status' => UploadSession::STATUS_PROCESSING]);

        // Assemble the parts in order into one temp file.
        $assembled = $dir.'/assembled.tmp';
        $out = fopen($assembled, 'wb');
        if ($out === false) {
            $session->update(['status' => UploadSession::STATUS_FAILED]);
            throw new FileValidationException('Storage unavailable — the upload could not be assembled.');
        }

        for ($i = 0; $i < $session->total_chunks; $i++) {
            $part = $dir.'/'.$i.'.part';
            $in = fopen($part, 'rb');
            if ($in === false) {
                fclose($out);
                $session->update(['status' => UploadSession::STATUS_FAILED]);
                throw new FileValidationException('Upload could not be completed — a part could not be read.');
            }
            stream_copy_to_stream($in, $out);
            fclose($in);
        }
        fclose($out);

        // Size check against what init() was told (when a size was provided).
        if ($session->size > 0 && (filesize($assembled) ?: 0) !== $session->size) {
            self::removeDir($dir);
            $session->update(['status' => UploadSession::STATUS_FAILED]);
            throw new FileValidationException('Upload could not be completed — the assembled file size did not match.');
        }

        // Re-validate the real, assembled bytes (extension + MIME + size).
        $meta = FileType::inspect($assembled, $session->filename);

        $desiredName = self::resolveName($session, $conflict, $newName);

        $stored = Vault::store($assembled, $meta['extension']);

        $file = DB::transaction(function () use ($session, $desiredName, $meta, $stored, $conflict) {
            if ($conflict === 'replace') {
                self::existingQuery($session, $desiredName)->each(function (FileItem $old) use ($session) {
                    $old->update(['deleted_by' => $session->user_id]);
                    $old->delete(); // soft delete → recycle bin, never a silent hard overwrite
                    Activity::forFile($session->user_id, $old, 'delete', ['reason' => 'replaced']);
                });
            }

            return FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $session->folder_id,
                'name' => $desiredName,
                'extension' => $meta['extension'],
                'mime_type' => $meta['mime'],
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => $session->user_id,
                'uploaded_by' => $session->user_id,
            ]);
        });

        $session->update([
            'status' => UploadSession::STATUS_COMPLETED,
            'received_count' => $session->total_chunks,
        ]);
        self::removeDir($dir);

        Activity::forFile($session->user_id, $file, 'upload', ['size' => $file->size]);

        return $file;
    }

    public static function abort(UploadSession $session): void
    {
        self::removeDir(Vault::uploadDir($session->uuid));
        $session->update(['status' => UploadSession::STATUS_CANCELLED]);
    }

    /** Remove expired, non-completed sessions and their temp parts. */
    public static function cleanupExpired(): int
    {
        $count = 0;

        UploadSession::query()
            ->where('expires_at', '<', now())
            ->whereNotIn('status', [UploadSession::STATUS_COMPLETED])
            ->each(function (UploadSession $session) use (&$count) {
                self::removeDir(Vault::uploadDir($session->uuid));
                $session->delete();
                $count++;
            });

        return $count;
    }

    private static function resolveName(UploadSession $session, ?string $conflict, ?string $newName): string
    {
        if ($conflict === 'rename') {
            $name = Naming::assertValid((string) $newName);
            if (self::existingQuery($session, $name)->exists()) {
                throw new FileValidationException('A file with that name already exists here.');
            }

            return $name;
        }

        $name = Naming::clean($session->filename);

        if ($conflict === 'replace') {
            return $name; // existing rows are recycled inside the transaction
        }

        // Default and 'keep-both': never overwrite silently.
        return Naming::nextAvailable(
            $name,
            fn ($candidate) => self::existingQuery($session, $candidate)->exists()
        );
    }

    private static function existingQuery(UploadSession $session, string $name)
    {
        return FileItem::query()
            ->where('folder_id', $session->folder_id)
            ->when($session->folder_id === null, fn ($q) => $q->where('owner_id', $session->user_id))
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
    }

    /** @return array<int,int> present chunk indexes */
    private static function partsPresent(string $dir, int $total): array
    {
        $present = [];
        for ($i = 0; $i < $total; $i++) {
            if (is_file($dir.'/'.$i.'.part')) {
                $present[] = $i;
            }
        }

        return $present;
    }

    private static function partsBytes(string $dir): int
    {
        $bytes = 0;
        foreach (glob($dir.'/*.part') ?: [] as $part) {
            $bytes += filesize($part) ?: 0;
        }

        return $bytes;
    }

    private static function removeDir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (glob($dir.'/*') ?: [] as $file) {
            @unlink($file);
        }
        @rmdir($dir);
    }
}
