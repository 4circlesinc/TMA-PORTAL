<?php

namespace App\Support\Files;

use App\Models\FileComment;
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\User;
use App\Support\Files\Workflow\Engine;
use App\Support\Notifications\Notifier;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Version history for a file.
 *
 * The one rule everything here protects: **a new version never destroys an old
 * one.** Uploading a revision writes new bytes and leaves the previous blob
 * exactly where it was; restoring an old version does not rewind history, it
 * appends a new current version whose content came from the old one. There is
 * deliberately no code path in this class that deletes stored bytes.
 *
 * This class is the ONLY writer of both `files.storage_path` and
 * `file_versions`. `files` stays the pointer to the current bytes so every
 * existing download/preview/thumbnail path keeps working; keeping the two in
 * step is this class's job, and nothing else may set either.
 */
class Versions
{
    /**
     * Record the first version of a newly stored file.
     *
     * Called after a file is created so its current bytes are inside the
     * history rather than sitting outside it. Idempotent: a file that already
     * has versions is left alone.
     */
    public static function recordInitial(FileItem $file, ?int $userId = null, ?string $note = null): ?FileVersion
    {
        if (FileVersion::where('file_id', $file->id)->exists()) {
            return null;
        }

        return FileVersion::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $file->id,
            'version_number' => 1,
            'disk' => $file->disk,
            'storage_path' => $file->storage_path,
            'size' => $file->size,
            'checksum' => $file->checksum,
            'mime_type' => $file->mime_type,
            'extension' => $file->extension,
            'uploaded_by' => $userId ?? $file->uploaded_by,
            'note' => $note,
            'is_current' => true,
        ]);
    }

    /**
     * Add a new current version from bytes already stored in the vault.
     *
     * @param  array{uuid:string, disk:string, path:string, size:int, checksum:?string}  $stored
     */
    public static function addStored(
        FileItem $file,
        User $author,
        array $stored,
        array $meta,
        ?string $note = null,
        ?FileVersion $restoredFrom = null,
    ): FileVersion {
        // A file created before versioning existed has no history yet; give it
        // one before adding on top, or v1 would be silently lost.
        self::recordInitial($file);

        $version = DB::transaction(function () use ($file, $author, $stored, $meta, $note, $restoredFrom) {
            $next = ((int) FileVersion::where('file_id', $file->id)->max('version_number')) + 1;

            FileVersion::where('file_id', $file->id)->update(['is_current' => false]);

            $version = FileVersion::create([
                'uuid' => (string) Str::uuid(),
                'file_id' => $file->id,
                'version_number' => $next,
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'size' => $stored['size'],
                'checksum' => $stored['checksum'] ?? null,
                'mime_type' => $meta['mime'] ?? $file->mime_type,
                'extension' => $meta['extension'] ?? $file->extension,
                'uploaded_by' => $author->id,
                'note' => $note,
                'restored_from_id' => $restoredFrom?->id,
                'is_current' => true,
            ]);

            // Point the file at the new bytes. The OLD blob is deliberately
            // left on disk — that is what makes the previous version real.
            $file->update([
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'size' => $stored['size'],
                'checksum' => $stored['checksum'] ?? null,
                'mime_type' => $meta['mime'] ?? $file->mime_type,
                'extension' => $meta['extension'] ?? $file->extension,
                'version_number' => $next,
                'uploaded_by' => $author->id,
                'source_modified_at' => now(),
            ]);

            return $version;
        });

        // An open workflow reviewed a specific revision. It is never moved onto
        // the new one silently — it is marked superseded and its sender told.
        Engine::noteNewVersion($file, $version);

        Activity::forFile($author->id, $file, $restoredFrom ? 'version-restored' : 'version', [
            'version' => $version->version_number,
            'from' => $restoredFrom?->version_number,
            'note' => $note,
            'size' => $version->size,
        ]);

        self::notify($file, $author, $version, $restoredFrom);

        return $version;
    }

    /**
     * Make an older version current again.
     *
     * This APPENDS: the restored content becomes a brand-new highest version,
     * and everything uploaded after the one being restored stays in the
     * history. Rewinding by deleting later versions would silently destroy
     * work, which §5 forbids.
     */
    public static function restore(FileItem $file, FileVersion $version, User $author, ?string $note = null): FileVersion
    {
        $copy = Vault::duplicateVersion($version);

        return self::addStored(
            $file,
            $author,
            [
                'disk' => $copy['disk'],
                'path' => $copy['path'],
                'size' => $version->size,
                'checksum' => $version->checksum,
            ],
            ['mime' => $version->mime_type, 'extension' => $version->extension],
            $note ?: 'Restored version '.$version->version_number,
            $version,
        );
    }

    /** @return Collection<int, FileVersion> newest first */
    public static function history(FileItem $file)
    {
        self::recordInitial($file);

        return FileVersion::where('file_id', $file->id)
            ->with(['uploader:id,name,email,avatar_url,provider_avatar_url', 'restoredFrom:id,version_number'])
            ->orderByDesc('version_number')
            ->get();
    }

    public static function current(FileItem $file): ?FileVersion
    {
        return FileVersion::where('file_id', $file->id)->where('is_current', true)->first();
    }

    /**
     * Who may add a version. `upload` is the editor-and-above capability, which
     * is the right bar: replacing a document's content is an edit, not a view.
     */
    public static function canAddVersion(User $user, FileItem $file): bool
    {
        // A workflow that locked the file refuses new content outright — that
        // is what "lock during review" means. Reported separately from
        // permission so the UI can explain which one applies.
        if (Engine::isLocked($file)) {
            return false;
        }

        return FileAccess::can($user, 'upload', $file);
    }

    /** Why versions are refused right now, for the message the user sees. */
    public static function lockReason(FileItem $file): ?string
    {
        $lock = Engine::isLocked($file);

        return $lock
            ? 'This file is locked while a '.$lock->type.' request is open.'
            : null;
    }

    /** Restoring changes what everyone else sees, so it needs the same bar. */
    public static function canRestore(User $user, FileItem $file): bool
    {
        return FileAccess::can($user, 'upload', $file);
    }

    private static function notify(FileItem $file, User $author, FileVersion $version, ?FileVersion $restoredFrom): void
    {
        try {
            $title = $restoredFrom
                ? $author->name.' restored version '.$restoredFrom->version_number.' of '.$file->name
                : $author->name.' uploaded version '.$version->version_number.' of '.$file->name;

            // The owner, and anyone already talking about this file — the
            // people for whom the content changing under them actually matters.
            $ids = FileComment::where('file_id', $file->id)
                ->distinct()->pluck('author_id')
                ->push($file->owner_id)
                ->unique()
                ->reject(fn ($id) => (int) $id === $author->id);

            foreach ($ids as $id) {
                $user = User::find($id);
                if (! $user || FileAccess::fileRole($user, $file) === null) {
                    continue;
                }

                Notifier::send([
                    'user' => $id,
                    'actor' => $author,
                    'type' => 'file.version',
                    'title' => $title,
                    'message' => $version->note,
                    'subject' => $file,
                    'action_url' => '/folders/all?file='.$file->uuid,
                ]);
            }
        } catch (\Throwable $e) {
            Log::error('Versions.notify failed', ['file' => $file->uuid, 'error' => $e->getMessage()]);
        }
    }
}
