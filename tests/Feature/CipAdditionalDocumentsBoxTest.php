<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\FileItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\AdditionalDocuments;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The open Additional documents box every person on every application carries.
 *
 * It differs from every other slot in three ways, and each one is a rule that
 * somebody will otherwise "fix" back to the normal behaviour: it takes an
 * unlimited number of files, it never renames them, and it is never required.
 */
class CipAdditionalDocumentsBoxTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
    }

    private function staff(): User
    {
        $user = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        return $user;
    }

    /** An application with a main applicant and a dependent, slots opened. */
    private function application(User $creator): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $creator);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Mei', 'last_name' => 'Wei',
            'date_of_birth' => now()->subYears(9)->toDateString(),
        ]);

        Tree::provision($application->fresh(), $creator);

        foreach ($application->fresh()->people as $person) {
            DocumentSlots::open($person);
        }

        return $application->fresh();
    }

    private function box(CipPerson $person): CipDocument
    {
        return CipDocument::where('person_id', $person->id)
            ->where('type', AdditionalDocuments::KEY)
            ->firstOrFail();
    }

    public function test_every_applicant_type_has_the_box_and_none_of_them_require_it(): void
    {
        foreach (ApplicantType::ALL as $type) {
            $row = CipDocumentRequirement::where('applicant_type', $type)
                ->where('key', AdditionalDocuments::KEY)
                ->first();

            $this->assertNotNull($row, "No Additional documents box for {$type}.");
            $this->assertTrue((bool) $row->active);
            $this->assertFalse((bool) $row->required, "The box must never be required ({$type}).");
            $this->assertSame(Tree::ADDITIONAL, $row->folder);
        }
    }

    public function test_the_box_opens_for_the_dependent_as_well_as_the_applicant(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);

        foreach ($application->people as $person) {
            $this->assertNotNull(
                CipDocument::where('person_id', $person->id)
                    ->where('type', AdditionalDocuments::KEY)
                    ->first(),
                'Every person on the application carries the box.',
            );
        }
    }

    public function test_it_takes_many_files_and_keeps_every_name(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        $names = ['Guardianship Order.pdf', "Translator's Note.pdf", 'Letter from the Unit.pdf'];

        foreach ($names as $index => $name) {
            $upload = UploadedFile::fake()->create($name, 40 + $index, 'application/pdf');

            if ($index === 0) {
                DocumentSlots::fill($person, AdditionalDocuments::KEY, $upload, $staff);

                continue;
            }

            DocumentSlots::attach($person, AdditionalDocuments::KEY, $upload, $staff, 0);
        }

        $folder = $this->boxFolder($person);
        $filed = FileItem::where('folder_id', $folder)->pluck('name')->sort()->values()->all();

        $this->assertSame(collect($names)->sort()->values()->all(), $filed);
    }

    public function test_two_files_of_one_name_are_both_kept(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        DocumentSlots::fill(
            $person,
            AdditionalDocuments::KEY,
            UploadedFile::fake()->create('scan.pdf', 40, 'application/pdf'),
            $staff,
        );

        DocumentSlots::attach(
            $person,
            AdditionalDocuments::KEY,
            UploadedFile::fake()->create('scan.pdf', 41, 'application/pdf'),
            $staff,
            0,
        );

        $filed = FileItem::where('folder_id', $this->boxFolder($person))
            ->pluck('name')->sort()->values()->all();

        $this->assertSame(['scan (1).pdf', 'scan.pdf'], $filed);
    }

    public function test_the_files_land_in_that_persons_own_additional_documents_drawer(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $dependent = $application->people->firstWhere('role', CipPerson::ROLE_DEPENDENT);

        DocumentSlots::fill(
            $dependent,
            AdditionalDocuments::KEY,
            UploadedFile::fake()->create('School Record.pdf', 40, 'application/pdf'),
            $staff,
        );

        $file = FileItem::where('name', 'School Record.pdf')->firstOrFail();
        $drawer = \App\Models\Folder::find($file->folder_id);

        $this->assertSame(Tree::ADDITIONAL, $drawer->name);
        $this->assertSame(
            $dependent->folder_id,
            $drawer->parent_id,
            "The dependent's extra paper belongs under the dependent, not the client.",
        );
    }

    public function test_a_normal_slot_still_renames_to_the_person_and_requirement(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);

        $slot = DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('scan0001.pdf', 40, 'application/pdf'),
            $staff,
        );

        $this->assertSame(
            $person->fullName().' - '.DocumentTypes::label(DocumentTypes::PASSPORT_BIO_PAGE).'.pdf',
            FileItem::find($slot->file_id)->name,
            'Only the open box keeps the sender\'s filename.',
        );
    }

    private function boxFolder(CipPerson $person): int
    {
        return $this->box($person)->fresh()->file->folder_id;
    }
}
