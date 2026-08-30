<?php

namespace Tests\Feature;

use App\Models\CipApplicationAssignment;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use App\Support\Cip\Status;
use App\Support\Files\ReviewStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A CIP document's status is the same chip on the checklist, the Documents
 * tab and the File Library. The slot is the source of truth; the file listing
 * must not keep drawing the library's old review vocabulary beside it.
 */
class CipDocumentFileStatusTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /**
     * A filled slot sitting in a client folder, so both the checklist and
     * the File Library have a row to draw.
     *
     * @return array{0: CipDocument, 1: FileItem, 2: Folder, 3: User}
     */
    private function filed(string $status = DocumentStatus::APPLICATION_REVIEW): array
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'G'.substr(uniqid(), -4)]);
        $client = Client::create([
            'uid' => 'chen-'.uniqid(), 'name' => 'Chen Wei',
            'created_by' => $staff->id, 'data' => [],
        ]);
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $client->name,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
            'folder_id' => $folder->id,
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'name' => 'Chen Wei — Birth certificate.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/birth.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);
        $slot = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => 'Birth certificate',
            'file_id' => $file->id,
        ]);
        $slot->forceFill(['status' => $status])->save();

        return [$slot, $file, $folder, $staff];
    }

    public function test_the_file_listing_draws_the_slot_status_not_the_library_review(): void
    {
        [$slot, $file, $folder, $staff] = $this->filed(DocumentStatus::UPDATE_REQUIRED);

        // Stale on purpose: the observer stamped Application review when the
        // file landed, and nobody has walked the engine since. The listing
        // must still read the slot.
        $file->forceFill(['review_status' => ReviewStatus::APPLICATION_REVIEW])->save();

        $this->actingAs($staff)
            ->getJson('/portal/files/?section=all&folder='.$folder->uuid)
            ->assertOk()
            ->assertJsonPath('files.0.status.label', 'Update required')
            ->assertJsonPath('files.0.status.tone', 'danger')
            ->assertJsonPath('files.0.review.status', DocumentStatus::UPDATE_REQUIRED);

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $slot->fresh()->status);
    }

    public function test_every_slot_status_reaches_the_library_chip(): void
    {
        $cases = [
            DocumentStatus::APPLICATION_REVIEW => ['Application review', 'pending'],
            DocumentStatus::UPDATE_REQUIRED => ['Update required', 'danger'],
            DocumentStatus::READY_FOR_SUBMISSION => ['Ready for submission', 'success'],
        ];

        foreach ($cases as $status => [$label, $tone]) {
            [, , $folder, $staff] = $this->filed($status);

            $this->actingAs($staff)
                ->getJson('/portal/files/?section=all&folder='.$folder->uuid)
                ->assertOk()
                ->assertJsonPath('files.0.status.label', $label)
                ->assertJsonPath('files.0.status.tone', $tone);
        }
    }

    public function test_approving_from_the_library_moves_the_slot(): void
    {
        [$slot, $file, $folder, $staff] = $this->filed(DocumentStatus::APPLICATION_REVIEW);

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::READY_FOR_SUBMISSION,
            ])
            ->assertOk()
            ->assertJsonPath('status.label', 'Ready for submission')
            ->assertJsonPath('file.review.status', DocumentStatus::READY_FOR_SUBMISSION);

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $slot->fresh()->status);
        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $file->fresh()->review_status);

        $this->actingAs($staff)
            ->getJson('/portal/files/?section=all&folder='.$folder->uuid)
            ->assertOk()
            ->assertJsonPath('files.0.status.label', 'Ready for submission');
    }

    public function test_requesting_an_update_from_the_library_needs_a_reason(): void
    {
        [$slot, $file, , $staff] = $this->filed(DocumentStatus::APPLICATION_REVIEW);

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::UPDATE_REQUIRED,
            ])
            ->assertStatus(422);

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::UPDATE_REQUIRED,
                'note' => 'The bio page is cropped. Please rescan.',
            ])
            ->assertOk()
            ->assertJsonPath('status.label', 'Update required')
            ->assertJsonPath('updateReason', 'The bio page is cropped. Please rescan.')
            ->assertJsonPath('application.status', Status::UPDATE_REQUIRED);

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $slot->fresh()->status);
        $this->assertTrue($slot->comments()->exists(), 'The reason lands on the slot, where the checklist reads it.');
        $this->assertDatabaseHas('file_comments', [
            'file_id' => $file->id,
            'body' => 'The bio page is cropped. Please rescan.',
        ]);
        $this->actingAs($staff)
            ->getJson('/portal/files/workflows/comments?scope=all')
            ->assertOk()
            ->assertJsonFragment(['body' => 'The bio page is cropped. Please rescan.']);
        $this->assertSame(Status::UPDATE_REQUIRED, $slot->application->fresh()->status);

        $clientUid = $slot->application->fresh()->loadMissing('client')->client->uid;
        $docs = $this->actingAs($staff)
            ->getJson('/portal/cip/clients/'.$clientUid.'/application')
            ->assertOk()
            ->json('application.applicant.documents');
        $this->assertSame(
            'The bio page is cropped. Please rescan.',
            collect($docs)->firstWhere('id', $slot->uuid)['updateReason'] ?? null,
        );
    }

    public function test_marking_update_required_on_the_library_chip_moves_the_application(): void
    {
        [$slot, $file, , $staff] = $this->filed(DocumentStatus::APPLICATION_REVIEW);
        $slot->loadMissing('application');
        $slot->application->forceFill(['status' => Status::REVIEW_APPLICATION])->save();

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::UPDATE_REQUIRED,
                'note' => 'The bio page is cropped. Please rescan.',
            ])
            ->assertOk();

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $slot->fresh()->status);
        $this->assertSame(Status::UPDATE_REQUIRED, $slot->application->fresh()->status);
    }

    public function test_moving_a_file_back_to_application_review_leaves_ready_to_submit(): void
    {
        [$slot, $file, , $staff] = $this->filed(DocumentStatus::READY_FOR_SUBMISSION);
        $slot->loadMissing('application');
        $slot->application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::APPLICATION_REVIEW,
            ])
            ->assertOk()
            ->assertJsonPath('application.status', Status::REVIEW_APPLICATION);

        $this->assertSame(Status::REVIEW_APPLICATION, $slot->application->fresh()->status);
    }

    public function test_staff_can_move_a_file_status_back_and_forth(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        [$slot, $file, $folder] = $this->filedFor($staff, DocumentStatus::READY_FOR_SUBMISSION);

        $this->actingAs($staff)
            ->getJson('/portal/files/?section=all&folder='.$folder->uuid)
            ->assertOk()
            ->assertJsonPath('files.0.review.canReview', true)
            ->assertJsonPath('files.0.review.next', [
                ReviewStatus::APPLICATION_REVIEW,
                ReviewStatus::UPDATE_REQUIRED,
            ]);

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::APPLICATION_REVIEW,
            ])
            ->assertOk()
            ->assertJsonPath('file.review.status', DocumentStatus::APPLICATION_REVIEW);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->fresh()->status);

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::UPDATE_REQUIRED,
                'note' => 'Dates on page 2 do not match.',
            ])
            ->assertOk()
            ->assertJsonPath('file.review.status', DocumentStatus::UPDATE_REQUIRED);

        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $slot->fresh()->status);
    }

    public function test_clearing_one_update_required_file_keeps_the_chip_when_another_still_needs_an_update(): void
    {
        [$slot, $file, , $staff] = $this->filed(DocumentStatus::UPDATE_REQUIRED);
        $slot->loadMissing(['application', 'person']);
        $slot->application->forceFill(['status' => Status::UPDATE_REQUIRED])->save();

        $otherFile = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $file->folder_id,
            'name' => 'Chen Wei — Passport bio page.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/bio.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);
        $other = CipDocument::create([
            'application_id' => $slot->application_id,
            'person_id' => $slot->person_id,
            'type' => DocumentTypes::PASSPORT_BIO_PAGE,
            'label' => 'Passport bio page',
            'file_id' => $otherFile->id,
        ]);
        $other->forceFill(['status' => DocumentStatus::UPDATE_REQUIRED])->save();

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::READY_FOR_SUBMISSION,
            ])
            ->assertOk()
            ->assertJsonPath('file.review.status', DocumentStatus::READY_FOR_SUBMISSION);

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $slot->fresh()->status);
        $this->assertSame(DocumentStatus::UPDATE_REQUIRED, $other->fresh()->status);
        $this->assertSame(Status::UPDATE_REQUIRED, $slot->application->fresh()->status);
    }

    public function test_an_assigned_officer_can_review_without_folder_upload(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        [$slot, $file] = $this->filedFor($admin, DocumentStatus::APPLICATION_REVIEW);
        $slot->loadMissing('application');
        $slot->application->forceFill(['status' => Status::REVIEW_APPLICATION])->save();

        $officer = $this->user(Role::REVIEWING_OFFICER);
        ClientAssignment::create([
            'client_id' => $slot->application->client_id,
            'user_id' => $officer->id,
            'role' => 'reviewing_officer',
            'permission_level' => 'view_files',
            'status' => ClientAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);
        CipApplicationAssignment::create([
            'application_id' => $slot->application_id,
            'user_id' => $officer->id,
            'role' => 'reviewing_officer',
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        $this->actingAs($officer)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::READY_FOR_SUBMISSION,
            ])
            ->assertOk()
            ->assertJsonPath('file.review.status', DocumentStatus::READY_FOR_SUBMISSION);

        $this->assertSame(DocumentStatus::READY_FOR_SUBMISSION, $slot->fresh()->status);
    }

    /**
     * @return array{0: CipDocument, 1: FileItem, 2: Folder, 3: User}
     */
    private function filedFor(User $staff, string $status = DocumentStatus::APPLICATION_REVIEW): array
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'G'.substr(uniqid(), -4)]);
        $client = Client::create([
            'uid' => 'chen-'.uniqid(), 'name' => 'Chen Wei',
            'created_by' => $staff->id, 'data' => [],
        ]);
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $client->name,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
            'folder_id' => $folder->id,
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'name' => 'Chen Wei — Birth certificate.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/birth.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);
        $slot = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => 'Birth certificate',
            'file_id' => $file->id,
        ]);
        $slot->forceFill(['status' => $status])->save();

        return [$slot, $file, $folder, $staff];
    }
}
