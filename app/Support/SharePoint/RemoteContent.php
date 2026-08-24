<?php

namespace App\Support\SharePoint;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\SharePointItem;
use App\Support\Files\Vault;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Fetch the bytes of a file that was imported by reference.
 *
 * The import records a library's structure without moving any content, so a
 * freshly-imported file has a name, a size and a folder but no stored bytes.
 * This turns one of those into a real stored file, on demand.
 *
 * Everything reads through Vault, so hooking materialisation in there means
 * download, preview, signing, zipping and copying all get it for free, none of
 * them need to know a file started life as a reference.
 */
class RemoteContent
{
    public const PENDING = 'pending';

    /** How long to leave a lock in place if the fetching process dies. */
    private const LOCK_SECONDS = 300;

    public static function isPending(FileItem $file): bool
    {
        return $file->content_state === self::PENDING;
    }

    /**
     * Make sure the bytes are here, fetching them if they are not.
     *
     * Returns false when the file cannot be materialised, no mapping, or Graph
     * refused. Callers treat that the same as a missing file, which it is.
     */
    public static function ensure(FileItem $file): bool
    {
        if (! self::isPending($file)) {
            return true;
        }

        $mapping = SharePointItem::where('file_id', $file->id)
            ->whereNotNull('connection_id')
            ->first();

        if (! $mapping || ! $mapping->connection) {
            return false;
        }

        /*
         * One fetch at a time per file.
         *
         * Opening a file twice quickly, or two people opening it at once —
         * would otherwise download it twice and race to write the record. The
         * loser's temp file becomes an orphan in R2 that nothing points at.
         */
        $lock = Cache::lock('sp-content-'.$file->id, self::LOCK_SECONDS);

        if (! $lock->get()) {
            // Someone else is already fetching. Wait for them rather than
            // starting a second download of the same bytes.
            try {
                $lock->block(30);
            } catch (Throwable $e) {
                return false;
            }
        }

        try {
            // It may have been materialised while we waited for the lock.
            $file->refresh();

            if (! self::isPending($file)) {
                return true;
            }

            return self::fetch($file, $mapping);
        } finally {
            optional($lock)->release();
        }
    }

    private static function fetch(FileItem $file, SharePointItem $mapping): bool
    {
        $temp = tempnam(sys_get_temp_dir(), 'sp-pull-');

        try {
            Drive::download($mapping->connection->drive_id, $mapping->graph_item_id, $temp);
            $stored = Vault::store($temp, strtolower((string) $file->extension));
        } catch (Throwable $e) {
            @unlink($temp);

            return false;
        }

        $file->update([
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $stored['checksum'],
            // Graph's reported size is what the placeholder carried; the stored
            // bytes are the truth, and a mismatch would break range requests.
            'size' => $stored['size'],
            'content_state' => null,
        ]);

        // Version 1 was recorded as a placeholder alongside the file, so it
        // needs the same treatment or the version history 404s.
        FileVersion::where('file_id', $file->id)
            ->where('content_state', self::PENDING)
            ->where('version_number', 1)
            ->update([
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'size' => $stored['size'],
                'content_state' => null,
            ]);

        return true;
    }
}
