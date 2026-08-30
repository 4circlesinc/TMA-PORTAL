<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\FileRequest;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\DocumentRequests;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use App\Support\Files\FileAccess;
use App\Support\Files\FileRequests;
use App\Support\Files\Versions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * §17 — after confirm, original person folders are view-only; Additional
 * Documents stays writable, with versioning still on.
 */
class CipLockingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function contact(Company $company, User $staff): User
    {
        $contact = $this->user(Role::CLIENT, 'gil@galaxy.example', 'Gil Contact');

        CompanyMember::create([
            'company_id' => $company->id, 'user_id' => $contact->id,
            'name' => 'Gil Contact', 'email' => 'gil@galaxy.example',
            'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
            'invited_by' => $staff->id,
        ]);

        return $contact;
    }

    /**
     * @return array{
     *     staff: User,
     *     contact: User,
     *     application: CipApplication,
     *     main: Folder,
     *     additional: Folder,
     *     slot: CipDocument,
     *     extra: FileItem
     * }
     */
    private function lockedPackage(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);

        $application = Applications::create($provider, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(), $staff);

        $person = $application->people()->first();
        $slot = DocumentSlots::fill(
            $person,
            'passport_bio_page',
            UploadedFile::fake()->create('passport.pdf', 40, 'application/pdf'),
            $staff,
        );
        $slot->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $main = Folder::findOrFail($person->fresh()->folder_id);

        $this->actingAs($staff)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->create('notes.pdf', 12, 'application/pdf'),
            'folder' => $main->uuid,
        ])->assertCreated();
        $extra = FileItem::query()->where('folder_id', $main->id)->whereNull('deleted_at')
            ->where('id', '!=', $slot->fresh()->file_id)
            ->firstOrFail();

        $contact = $this->contact($company, $staff);
        Confirmation::confirm($application->fresh(), $contact);

        $application = $application->fresh();
        $additional = Folder::query()
            ->where('parent_id', $application->folder_id)
            ->where('name', Tree::ADDITIONAL)
            ->firstOrFail();

        return compact('staff', 'contact', 'application', 'main', 'additional', 'slot', 'extra');
    }

    public function test_an_admin_cannot_rewrite_an_original_person_folder_after_lock(): void
    {
        ['staff' => $staff, 'main' => $main, 'slot' => $slot, 'extra' => $extra] = $this->lockedPackage();
        $file = $slot->fresh()->file;

        $this->assertFalse(FileAccess::can($staff, 'upload', $main));
        $this->assertFalse(FileAccess::can($staff, 'rename', $main));
        $this->assertFalse(FileAccess::can($staff, 'delete', $main));
        $this->assertTrue(FileAccess::can($staff, 'view', $main));
        $this->assertTrue(FileAccess::can($staff, 'download', $file));
        $this->assertFalse(FileAccess::can($staff, 'upload', $file));
        $this->assertFalse(FileAccess::can($staff, 'delete', $extra));
        $this->assertFalse(Versions::canAddVersion($staff, $file));

        $this->actingAs($staff)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->create('rescan.pdf', 12, 'application/pdf'),
            'folder' => $main->uuid,
        ])->assertForbidden();

        $this->actingAs($staff)->patchJson('/portal/files/files/'.$file->uuid, [
            'name' => 'rewritten.pdf',
        ])->assertForbidden();

        $this->actingAs($staff)->deleteJson('/portal/files/files/'.$file->uuid)->assertForbidden();
        $this->actingAs($staff)->deleteJson('/portal/files/files/'.$extra->uuid)->assertForbidden();
        $this->actingAs($staff)->patchJson('/portal/files/folders/'.$main->uuid, [
            'name' => 'Applicant',
        ])->assertForbidden();

        $this->actingAs($staff)->postJson('/portal/files/folders', [
            'name' => 'Extra drawer',
            'parent' => $main->uuid,
        ])->assertForbidden();

        $bulk = $this->actingAs($staff)->postJson('/portal/files/bulk', [
            'action' => 'delete',
            'items' => [['type' => 'file', 'id' => $file->uuid]],
        ]);
        $bulk->assertOk()->assertJsonPath('ok', false);
        $this->assertNotNull($file->fresh());
        $this->assertNull($file->fresh()->deleted_at);
    }

    public function test_staff_can_still_move_file_status_after_the_package_is_locked(): void
    {
        ['staff' => $staff, 'slot' => $slot] = $this->lockedPackage();
        $file = $slot->fresh()->file;

        $this->actingAs($staff)
            ->patchJson('/portal/files/files/'.$file->uuid.'/review', [
                'status' => DocumentStatus::APPLICATION_REVIEW,
            ])
            ->assertOk()
            ->assertJsonPath('file.review.status', DocumentStatus::APPLICATION_REVIEW);

        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $slot->fresh()->status);
        $this->assertSame(DocumentStatus::APPLICATION_REVIEW, $file->fresh()->review_status);
    }

    public function test_additional_documents_stays_writable_with_versioning(): void
    {
        ['staff' => $staff, 'additional' => $additional] = $this->lockedPackage();

        $this->assertTrue(FileAccess::can($staff, 'upload', $additional));
        $this->assertTrue(FileAccess::can($staff, 'rename', $additional));

        $this->actingAs($staff)->getJson('/portal/files/folders/'.$additional->uuid)
            ->assertOk()
            ->assertJsonPath('permissions.upload', true);

        $this->actingAs($staff)->postJson('/portal/files/folders', [
            'name' => 'Queries',
            'parent' => $additional->uuid,
        ])->assertCreated();

        $this->actingAs($staff)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->create('query.pdf', 12, 'application/pdf'),
            'folder' => $additional->uuid,
        ])->assertCreated();

        $file = FileItem::query()->where('folder_id', $additional->id)->firstOrFail();
        $this->assertTrue(Versions::canAddVersion($staff, $file));

        $this->actingAs($staff)->post('/portal/files/files/'.$file->uuid.'/versions', [
            'file' => UploadedFile::fake()->create('query-v2.pdf', 14, 'application/pdf'),
        ])->assertCreated();

        $this->assertSame(2, FileVersion::where('file_id', $file->id)->count());
    }

    public function test_a_pre_lock_slot_link_cannot_write_after_confirm(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(), $staff);

        $person = $application->people()->first();
        $slot = CipDocument::create([
            'uuid' => (string) Str::uuid(),
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => 'police_certificate',
            'label' => 'Police certificate',
            'required' => true,
        ]);
        $slot->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $link = DocumentRequests::for($slot, $staff);
        $this->assertTrue($link->isOpen());

        Confirmation::confirm($application->fresh(), $this->contact($company, $staff));

        $this->assertNotNull($link->fresh()->revoked_at);
        $this->post('/r/'.$link->token.'/upload', [
            'file' => UploadedFile::fake()->create('certificate.pdf', 12, 'application/pdf'),
            'name' => 'Chen Wei',
        ])->assertStatus(410);

        $this->assertNull($slot->fresh()->file_id);

        $this->expectException(\InvalidArgumentException::class);
        DocumentRequests::for($slot->fresh(), $staff);
    }

    public function test_a_folder_link_into_the_original_package_is_withdrawn_but_additional_documents_is_not(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Tree::provision($application->fresh(), $staff);

        $person = $application->people()->first();
        $slot = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => 'passport_bio_page',
            'label' => 'Passport bio page',
            'required' => true,
        ]);
        $slot->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $main = Folder::findOrFail($person->folder_id);
        $additional = Folder::query()
            ->where('parent_id', $application->fresh()->folder_id)
            ->where('name', Tree::ADDITIONAL)
            ->firstOrFail();

        $originalLink = FileRequest::create([
            'uuid' => (string) Str::uuid(),
            'token' => FileRequests::token(),
            'title' => 'Anything else',
            'folder_id' => $main->id,
            'created_by' => $staff->id,
            'max_files' => 5,
            'allow_multiple' => true,
        ]);
        $extraLink = FileRequest::create([
            'uuid' => (string) Str::uuid(),
            'token' => FileRequests::token(),
            'title' => 'Query response',
            'folder_id' => $additional->id,
            'created_by' => $staff->id,
            'max_files' => 5,
            'allow_multiple' => true,
        ]);

        Confirmation::confirm($application->fresh(), $this->contact($company, $staff));

        $this->assertNotNull($originalLink->fresh()->revoked_at);
        $this->assertNull($extraLink->fresh()->revoked_at);

        $this->post('/r/'.$originalLink->token.'/upload', [
            'file' => UploadedFile::fake()->create('late.pdf', 12, 'application/pdf'),
        ])->assertStatus(410);

        $this->post('/r/'.$extraLink->token.'/upload', [
            'file' => UploadedFile::fake()->create('query.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $this->assertSame($additional->id, FileItem::firstOrFail()->folder_id);

        $this->actingAs($staff)->postJson('/portal/files/requests', [
            'title' => 'Another query',
            'folder' => $main->uuid,
        ])->assertForbidden();
    }
}
