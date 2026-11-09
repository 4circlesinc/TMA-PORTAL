<?php

namespace App\Support\Files;

use App\Jobs\GenerateFileThumbnail;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * File a copy of something that arrived elsewhere — a chat attachment, an
 * email attachment — straight into a folder of the document library.
 *
 * Without this, putting a passport scan that came in over Messages into the
 * applicant's folder meant downloading it to the computer and uploading it
 * again. The bytes go through the same checks an upload does: the reader
 * must be able to add files to the folder, the type is inspected from the
 * real bytes, and the name follows the folder's own collision rule. The
 * original is left where it was.
 */
final class SaveToFolder
{
    /**
     * @param  string  $plainPath  a scratch file holding the plaintext bytes; the caller cleans it up
     * @param  string  $source  where it came from, for the activity trail ("messaging", "mail")
     */
    public static function fromPath(User $user, Folder $folder, string $plainPath, string $filename, string $source): FileItem
    {
        abort_unless(FileAccess::canUploadTo($user, $folder), 403, 'You can’t add files to that folder.');

        // The same inspection an upload gets, on the bytes rather than the
        // name the sender gave them. Refused types stay refused.
        $meta = FileType::inspect($plainPath, $filename);

        $clean = Naming::clean($filename);
        if ($clean === '' || $clean === '.'.$meta['extension']) {
            $clean = 'Attachment.'.$meta['extension'];
        }

        $taken = fn (string $candidate) => FileItem::query()
            ->where('folder_id', $folder->id)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower($candidate)])
            ->exists();
        $name = $taken($clean) ? Naming::nextAvailable($clean, $taken) : $clean;

        $stored = Vault::store($plainPath, $meta['extension']);

        $file = DB::transaction(fn () => FileItem::create([
            'uuid' => $stored['uuid'],
            'folder_id' => $folder->id,
            'name' => $name,
            'extension' => $meta['extension'],
            'mime_type' => $meta['mime'],
            'size' => $stored['size'],
            'disk' => $stored['disk'],
            'storage_path' => $stored['path'],
            'checksum' => $stored['checksum'],
            'owner_id' => $user->id,
            'uploaded_by' => $user->id,
        ]));

        Versions::recordInitial($file, $user->id);
        Activity::forFile($user->id, $file, 'upload', ['size' => $file->size, 'source' => $source]);

        if (Thumbnail::supportsExt($file->extension)) {
            GenerateFileThumbnail::dispatch($file->id)->afterResponse();
        }

        return $file;
    }
}
