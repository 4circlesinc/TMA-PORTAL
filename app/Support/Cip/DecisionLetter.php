<?php

namespace App\Support\Cip;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Files\FileType;
use App\Support\Files\FolderProvisioner;
use App\Support\Files\Vault;
use App\Support\Files\Versions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The Unit's decision letter: a PDF filed with the application and attached
 * to the decision notice.
 */
class DecisionLetter
{
    public const MAX_KB = 10240;

    /**
     * Accept only PDF. Word processors and other formats are refused on both
     * the MIME type and the extension, because browsers and operating systems
     * disagree on both for the same file.
     */
    public static function rules(bool $required): array
    {
        return array_merge(
            [$required ? 'required' : 'nullable', 'file'],
            self::fileRules(),
        );
    }

    /** @return list<string> */
    public static function fileRules(): array
    {
        return [
            'mimes:pdf',
            'mimetypes:application/pdf',
            'max:'.self::MAX_KB,
        ];
    }

    /**
     * Store the letter in the file library and link it to the application.
     *
     * Approved files land in the post-approval person folder; denied files stay
     * with the main applicant's pre-approval repository.
     */
    public static function store(
        CipApplication $application,
        UploadedFile $upload,
        User $actor,
        string $decision,
    ): FileItem {
        self::guardPdf($upload);

        return DB::transaction(function () use ($application, $upload, $actor, $decision) {
            $application->loadMissing(['people', 'client']);
            $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

            Tree::provision($application, $actor);

            $folderId = self::folderId($application, $main, $decision, $actor);
            $name = self::fileName($main);

            $meta = FileType::inspect($upload->getRealPath(), $upload->getClientOriginalName());
            $stored = Vault::store($upload->getRealPath(), 'pdf');

            $file = FileItem::create([
                'uuid' => $stored['uuid'],
                'folder_id' => $folderId,
                'name' => $name,
                'extension' => 'pdf',
                'mime_type' => 'application/pdf',
                'size' => $stored['size'],
                'disk' => $stored['disk'],
                'storage_path' => $stored['path'],
                'checksum' => $stored['checksum'],
                'owner_id' => FolderProvisioner::systemOwnerId($actor),
                'uploaded_by' => $actor->id,
            ]);

            Versions::recordInitial($file, $actor->id);

            $application->forceFill(['decision_letter_file_id' => $file->id])->save();

            return $file;
        });
    }

    private static function folderId(
        CipApplication $application,
        ?CipPerson $main,
        string $decision,
        User $actor,
    ): ?int {
        if ($decision === Status::GRANTED) {
            Tree::provisionPostApproval($application, $actor);

            return $main
                ? Tree::postApprovalPersonFolder($main, null, $actor)->id
                : $application->post_approval_folder_id;
        }

        return $main?->folder_id ?? $application->folder_id;
    }

    private static function fileName(?CipPerson $main): string
    {
        $who = $main?->fullName() ?: 'Applicant';

        return $who.' - Decision letter.pdf';
    }

    /** @throws ValidationException */
    public static function guardPdf(UploadedFile $upload): void
    {
        $extension = strtolower($upload->getClientOriginalExtension());
        $blocked = ['doc', 'docx', 'rtf', 'pages', 'odt', 'word'];

        if (in_array($extension, $blocked, true)) {
            throw ValidationException::withMessages([
                'decisionLetter' => 'Upload the decision letter as a PDF.',
            ]);
        }
    }
}
