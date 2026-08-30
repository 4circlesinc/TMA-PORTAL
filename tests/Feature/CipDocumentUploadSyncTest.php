<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentEngine;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Intake;
use App\Support\Cip\Tree;
use App\Support\Files\Versions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Checklist uploads must stay one fact across the Documents tab, the file
 * library, and the overview — including when bytes arrive through the library
 * rather than the intake form.
 */
class CipDocumentUploadSyncTest extends TestCase
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

    private function application(User $creator): CipApplication
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $creator);

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);

        Tree::provision($application->fresh(), $creator);
        DocumentSlots::open($application->fresh()->people->first());

        return $application->fresh();
    }

    public function test_a_library_upload_in_a_person_folder_fills_the_matching_slot(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();

        $this->assertNotNull($slot);
        $this->assertNull($slot->file_id);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $person->folder_id,
            'name' => 'Chen Wei — Passport bio page.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1000,
            'disk' => config('filesystems.files_disk', 'local'),
            'storage_path' => 'cip/test-bio.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        Versions::recordInitial($file, $staff->id);

        $this->assertTrue(DocumentSlots::adoptOrphan($file->fresh(), $staff));

        $slot->refresh();
        $this->assertSame($file->id, $slot->file_id);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->status);
        $this->assertTrue($slot->isFilled());
    }

    public function test_a_new_version_on_a_linked_file_returns_update_required_slots_to_review(): void
    {
        Storage::fake(config('filesystems.files_disk', 'local'));

        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();

        $slot->forceFill(['status' => DocumentStatus::UPDATE_REQUIRED])->save();
        $file = $slot->file;

        $stored = [
            'uuid' => (string) Str::uuid(),
            'disk' => config('filesystems.files_disk', 'local'),
            'path' => 'cip/rescan.pdf',
            'size' => 50,
            'checksum' => null,
        ];

        Versions::addStored($file, $staff, $stored, ['extension' => 'pdf', 'mime' => 'application/pdf']);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->fresh()->status);
    }

    public function test_a_loosely_named_library_upload_can_still_fill_the_slot(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $person->folder_id,
            'name' => 'Passport bio page scan.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1000,
            'disk' => config('filesystems.files_disk', 'local'),
            'storage_path' => 'cip/loose-bio.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        Versions::recordInitial($file, $staff->id);

        $this->assertTrue(DocumentSlots::adoptOrphan($file->fresh(), $staff));

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();

        $this->assertSame($file->id, $slot->file_id);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->status);
    }

    public function test_reconcile_clears_a_slot_when_its_file_was_soft_deleted(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();

        $file = $slot->file;
        $file->update(['deleted_by' => $staff->id]);
        $file->delete();

        $slot->refresh();
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->status);
        $this->assertFalse($slot->isFilled());

        $this->assertTrue(DocumentSlots::reconcile($slot, $staff, false));

        $slot->refresh();
        $this->assertNull($slot->file_id);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $slot->status);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $slot->displayStatus());
        $this->assertFalse($slot->isFilled());
    }

    public function test_deleting_a_filed_file_resets_the_slot_to_pending_upload(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();

        $this->assertNotNull($slot->file_id);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->status);
        $this->assertTrue($slot->isFilled());

        $file = $slot->file;
        DocumentEngine::resetAfterFileDeletion($slot->fresh(), $staff);

        $slot->refresh();
        $this->assertNull($slot->file_id);
        $this->assertSame(DocumentStatus::PENDING_UPLOAD, $slot->status);
        $this->assertFalse($slot->isFilled());
    }

    public function test_intake_edit_does_not_replace_a_filed_document_unless_sent_back(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );

        $originalFileId = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->value('file_id');

        Intake::update($application, $staff, [
            'investmentType' => $application->investment_type ?? 'real_estate',
            'investmentTypeOther' => null,
            'sponsored' => false,
            'firstName' => 'Chen',
            'lastName' => 'Wei',
            'gender' => 'Male',
            'dateOfBirth' => '1990-01-01',
            'countryOfBirth' => 'China',
            'countryOfResidence' => 'China',
            'occupation' => 'Engineer',
            'passportNumber' => 'E12345678',
            'passportBioPage' => [UploadedFile::fake()->create('replacement.pdf', 40, 'application/pdf')],
        ]);

        $this->assertSame(
            $originalFileId,
            CipDocument::where('person_id', $person->id)
                ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
                ->value('file_id'),
        );
    }

    public function test_replacing_a_filed_document_in_the_library_keeps_the_same_file(): void
    {
        $staff = $this->staff();
        $application = $this->application($staff);
        $person = $application->people->first();

        DocumentSlots::fill(
            $person,
            DocumentTypes::PASSPORT_BIO_PAGE,
            UploadedFile::fake()->create('bio.pdf', 40, 'application/pdf'),
            $staff,
        );

        $slot = CipDocument::where('person_id', $person->id)
            ->where('type', DocumentTypes::PASSPORT_BIO_PAGE)
            ->first();
        $file = $slot->file;
        $folder = Folder::findOrFail($file->folder_id);

        $this->actingAs($staff)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->create($file->name, 48, 'application/pdf'),
            'folder' => $folder->uuid,
            'conflict' => 'replace',
        ])->assertCreated()
            ->assertJsonPath('id', $file->uuid)
            ->assertJsonPath('versionNumber', 2);

        $this->assertSame($file->id, $slot->fresh()->file_id);
        $this->assertSame(1, FileItem::query()->where('folder_id', $file->folder_id)->whereNull('deleted_at')->count());
        $this->assertSame(2, $file->fresh()->version_number);

        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk()
            ->json('application.applicant.documents');
        $shown = collect($docs)->firstWhere('type', DocumentTypes::PASSPORT_BIO_PAGE);
        $this->assertSame($file->uuid, $shown['fileId']);
        $this->assertStringContainsString('?v=2', (string) $shown['previewUrl']);
    }
}
