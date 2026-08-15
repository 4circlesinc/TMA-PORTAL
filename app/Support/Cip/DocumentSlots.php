<?php

namespace App\Support\Cip;

use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Opening a person's document slots, and filling one.
 *
 * Bytes go through Vault and Versions like every other file in the portal —
 * never a side path. That is what makes an application's documents the same
 * objects the file library shows, with the same version history, the same
 * previews and the same permissions, rather than a parallel store that would
 * have to grow all of it again.
 *
 * Uploads are owned by the firm's service account, not the person who pressed
 * Add. `files.owner_id` cascades on delete and an owner holds irrevocable
 * rights, so a provider contact owning an application's birth certificate
 * would mean their account being closed took the document with it — and would
 * give them a claim Phase 7's submission lock could not overrule.
 */
class DocumentSlots
{
    /**
     * Every slot this person owes, created empty if it is not there yet.
     *
     * Idempotent: re-running it after Phase 3 widens a checklist adds only
     * what is new, and never disturbs a slot that has been filled.
     *
     * @return \Illuminate\Support\Collection<int, CipDocument>
     */
    public static function open(CipPerson $person): \Illuminate\Support\Collection
    {
        foreach (DocumentTypes::forRole($person->role) as $type) {
            CipDocument::firstOrCreate(
                ['person_id' => $person->id, 'type' => $type],
                [
                    'application_id' => $person->application_id,
                    'label' => DocumentTypes::label($type),
                    'required' => true,
                ],
            );
        }

        return $person->documents()->get();
    }

    /**
     * Put an uploaded file in a slot.
     *
     * A second upload against a filled slot adds a version to the file that
     * is already there rather than orphaning it: the checklist keeps one
     * answer per requirement, and the history of that answer stays with it.
     */
    public static function fill(CipPerson $person, string $type, UploadedFile $upload, User $actor): CipDocument
    {
        $slot = CipDocument::firstOrCreate(
            ['person_id' => $person->id, 'type' => $type],
            [
                'application_id' => $person->application_id,
                'label' => DocumentTypes::label($type),
                'required' => true,
            ],
        );

        $meta = \App\Support\Files\FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);

        // A name that says what it answers and who for. The uploaded filename
        // is usually "scan0001.pdf", which tells a reviewer nothing.
        $name = $person->fullName().' — '.DocumentTypes::label($type).'.'.$meta['extension'];

        return DB::transaction(function () use ($slot, $person, $stored, $meta, $name, $actor) {
            if ($slot->file_id && $file = $slot->file) {
                Versions::addStored($file, $actor, $stored, $meta);
                $slot->forceFill(['uploaded_by' => $actor->id, 'uploaded_at' => now()])->save();

                return $slot;
            }

            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $person->folder_id,
                'name' => $name,
                'extension' => $meta['extension'],
                'mime_type' => $meta['mime'],
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => FolderProvisioner::systemOwnerId($actor),
                'uploaded_by' => $actor->id,
            ]);

            Versions::recordInitial($file, $actor->id);

            $slot->forceFill([
                'file_id' => $file->id,
                'uploaded_by' => $actor->id,
                'uploaded_at' => now(),
            ])->save();

            return $slot;
        });
    }

    /**
     * What a person still owes — the reason a slot is a row and not a file.
     *
     * @return array<int, string>
     */
    public static function outstanding(CipPerson $person): array
    {
        return $person->documents()
            ->whereNull('file_id')->where('required', true)
            ->pluck('label')->all();
    }
}
