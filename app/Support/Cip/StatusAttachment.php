<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipEvent;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\Activity;
use App\Support\Files\FileType;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Naming;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * An optional file filed with a status change.
 *
 * It lands in that person's own folder — the Main Applicant folder when the
 * move is about the application, the dependent's folder when the move is
 * about them — and not in a checklist drawer inside it.
 */
class StatusAttachment
{
    /** @return list<string> */
    public static function rules(): array
    {
        return [
            'nullable',
            'file',
            'mimes:pdf,jpg,jpeg,png,webp,heic',
            'max:'.Intake::MAX_DOCUMENT_KB,
        ];
    }

    /** @return array<string, string> */
    public static function messages(): array
    {
        return [
            'attachment.mimes' => 'Upload a PDF or an image.',
            'attachment.max' => 'That file is too large. Keep it under 10MB.',
        ];
    }

    /**
     * Refuse a file the library will not keep, before the status moves.
     */
    public static function accept(Request $request): void
    {
        $request->validate([
            'attachment' => self::rules(),
        ], self::messages());
    }

    public static function storeIfPresent(
        Request $request,
        CipApplication $application,
        User $actor,
        ?CipPerson $person = null,
    ): ?FileItem {
        $upload = $request->file('attachment');
        if (! $upload instanceof UploadedFile) {
            return null;
        }

        $person = self::subject($application, $person);
        $file = self::store($application, $person, $upload, $actor);

        Engine::record($application, CipEvent::ACTION_STATUS_ATTACHMENT, $actor, [
            'file_id' => $file->uuid,
            'file_name' => $file->name,
            'person_id' => $person->uuid,
            'person_name' => $person->fullName(),
            'person_role' => $person->role,
        ]);

        return $file;
    }

    public static function store(
        CipApplication $application,
        CipPerson $person,
        UploadedFile $upload,
        User $actor,
    ): FileItem {
        $folder = self::folder($application, $person, $actor);
        $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
        $stored = Vault::store($upload->getRealPath(), $meta['extension']);
        $name = Naming::nextAvailable(
            Naming::assertValid($upload->getClientOriginalName()),
            fn (string $candidate) => FileItem::query()
                ->where('folder_id', $folder->id)
                ->where('name', $candidate)
                ->exists(),
        );

        return DB::transaction(function () use ($folder, $stored, $meta, $name, $actor) {
            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $folder->id,
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
            Activity::forFile($actor->id, $file, 'upload', ['size' => $file->size]);

            return $file;
        });
    }

    private static function subject(CipApplication $application, ?CipPerson $person): CipPerson
    {
        if ($person !== null) {
            $person->setRelation('application', $application);

            return $person;
        }

        $application->loadMissing('people');
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        if ($main === null) {
            throw new \InvalidArgumentException('This application has no main applicant to file the document under.');
        }

        $main->setRelation('application', $application);

        return $main;
    }

    /**
     * The person's own folder for the lane the file is in now.
     *
     * Post-approval uses the folder under Post-Approval Documents. Everywhere
     * else uses Main Applicant, Dependent N, Sponsor, or Add-On Applicant.
     * Pack drawers (COR, NIC, Passport) are left alone.
     */
    private static function folder(CipApplication $application, CipPerson $person, User $actor): Folder
    {
        $person->setRelation('application', $application);

        if (($application->phase ?? Phase::PRE_APPROVAL) === Phase::POST_APPROVAL) {
            return Tree::postApprovalPersonFolder($person, null, $actor);
        }

        return Tree::personFolder($person, Tree::provision($application, $actor), $actor);
    }
}
