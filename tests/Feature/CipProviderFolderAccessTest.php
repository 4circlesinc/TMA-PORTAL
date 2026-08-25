<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Confirmation;
use App\Support\Cip\DocumentSlots;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\FolderAccess;
use App\Support\Cip\Status;
use App\Support\Cip\Tree;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Provider contacts open every client folder their firm has on file, the
 * same slice ApplicationScope already gives them. That grant is a FileAccess
 * rule, not a share row, so a new contact at Galaxy sees Chen Wei's tree
 * without anyone assigning them as staff.
 */
class CipProviderFolderAccessTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
        Storage::fake(config('filesystems.files_disk', 'local'));
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @return array{0: CipProvider, 1: User, 2: Company} */
    private function providerWithContact(string $code, ?User $contact = null): array
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $code.' Firm']);
        $contact ??= $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $provider = CipProvider::create([
            'name' => $code.' Provider', 'code' => $code, 'company_id' => $company->id,
        ]);

        return [$provider, $contact, $company];
    }

    /** @return array{root: Folder, main: Folder, application: CipApplication} */
    private function filing(CipProvider $provider, User $staff, string $first = 'Chen', string $last = 'Wei'): array
    {
        $application = Applications::create($provider, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $first,
            'last_name' => $last,
        ]);
        $root = Tree::provision($application->fresh(), $staff);
        $person = $application->people()->first();

        return [
            'root' => $root,
            'main' => Folder::findOrFail($person->fresh()->folder_id),
            'application' => $application->fresh(),
        ];
    }

    public function test_every_contact_at_the_filing_firm_can_open_the_client_tree(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        $pat = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $galaxy->company_id,
            'user_id' => $pat->id,
            'name' => $pat->name,
            'email' => $pat->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        ['root' => $root, 'main' => $main] = $this->filing($galaxy, $staff);

        foreach ([$gil, $pat] as $contact) {
            $this->assertSame(FolderAccess::ROLE, FileAccess::folderRole($contact, $root));
            $this->assertTrue(FileAccess::can($contact, 'view', $root));
            $this->assertTrue(FileAccess::can($contact, 'upload', $root));
            $this->assertTrue(FileAccess::can($contact, 'view', $main));
            $this->assertTrue(FileAccess::can($contact, 'upload', $main));
            $this->assertContains($root->id, FileAccess::systemVisibleFolderIds($contact));
        }
    }

    public function test_a_contact_at_another_firm_cannot_open_the_tree(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerWithContact('GAL');
        [, $outsider] = $this->providerWithContact('BLU');
        ['root' => $root, 'main' => $main] = $this->filing($galaxy, $staff);

        $this->assertNull(FileAccess::folderRole($outsider, $root));
        $this->assertFalse(FileAccess::can($outsider, 'view', $root));
        $this->assertFalse(FileAccess::can($outsider, 'view', $main));
        $this->assertNotContains($root->id, FileAccess::systemVisibleFolderIds($outsider));

        $this->actingAs($outsider)
            ->getJson('/portal/files/?section=all&folder='.$root->uuid)
            ->assertForbidden();
    }

    public function test_the_client_folder_appears_in_folder_shortcuts_for_the_firm(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        [, $outsider] = $this->providerWithContact('BLU');
        ['root' => $root] = $this->filing($galaxy, $staff, 'Chen', 'Wei');

        $names = collect(
            $this->actingAs($gil)->getJson('/portal/files/shortcuts')
                ->assertOk()->json('groups.assignedClients')
        )->pluck('name');

        $this->assertTrue($names->contains('Chen Wei'));
        $this->assertTrue(
            collect($this->actingAs($gil)->getJson('/portal/files/shortcuts')->json('groups.assignedClients'))
                ->contains(fn (array $row) => $row['id'] === $root->uuid)
        );

        $this->assertSame(
            [],
            $this->actingAs($outsider)->getJson('/portal/files/shortcuts')->json('groups.assignedClients')
        );
        $this->assertSame(
            [],
            $this->actingAs($gil)->getJson('/portal/files/shortcuts')->json('groups.libraries')
        );
    }

    public function test_the_file_library_clients_section_lists_the_firm_folder(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        [, $outsider] = $this->providerWithContact('BLU');
        ['root' => $root] = $this->filing($galaxy, $staff, 'Chen', 'Wei');

        $names = collect(
            $this->actingAs($gil)->getJson('/portal/files/?section=clients')
                ->assertOk()->json('folders')
        )->pluck('name');

        $this->assertTrue($names->contains('Chen Wei'));
        $this->assertContains(
            $root->uuid,
            collect($this->actingAs($gil)->getJson('/portal/files/?section=clients')->json('folders'))
                ->pluck('id')->all()
        );

        $this->actingAs($outsider)->getJson('/portal/files/?section=clients')
            ->assertOk()
            ->assertJsonCount(0, 'folders');
    }

    public function test_all_files_for_a_provider_contact_is_only_the_clients_folder(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        $stranger = $this->user(Role::CLIENT);
        $this->filing($galaxy, $staff, 'Chen', 'Wei');

        $this->actingAs($gil)->get('/folders/all')->assertOk();
        $this->actingAs($stranger)->get('/folders/all')->assertNotFound();

        $listed = collect(
            $this->actingAs($gil)->getJson('/portal/files/?section=all')
                ->assertOk()->json('folders')
        );
        $this->assertSame(['Clients'], $listed->pluck('name')->all());

        $clientsRoot = FolderProvisioner::clientsRoot();
        $this->assertTrue(FileAccess::can($gil, 'view', $clientsRoot));
        $this->assertFalse(FileAccess::can($gil, 'upload', $clientsRoot));

        $inside = collect(
            $this->actingAs($gil)->getJson('/portal/files/?section=all&folder='.$clientsRoot->uuid)
                ->assertOk()->json('folders')
        )->pluck('name');
        $this->assertTrue($inside->contains('Chen Wei'));

        $staffRoot = FolderProvisioner::staffRoot();
        $this->assertFalse(FileAccess::can($gil, 'view', $staffRoot));
        $this->actingAs($gil)->getJson('/portal/files/?section=all&folder='.$staffRoot->uuid)
            ->assertForbidden();
    }

    public function test_a_provider_contact_reaches_the_workflows_page(): void
    {
        [, $gil] = $this->providerWithContact('GAL');
        $stranger = $this->user(Role::CLIENT);

        $this->actingAs($gil)->get('/workflows')->assertOk();
        $this->actingAs($gil)->get('/workflows/feedback')->assertOk();
        $this->actingAs($stranger)->get('/workflows')->assertNotFound();
        $this->actingAs($stranger)->get('/workflows/feedback')->assertNotFound();

        $this->actingAs($gil)->getJson('/portal/files/workflows?scope=inbox')
            ->assertOk()
            ->assertJsonPath('canSeeAll', false);
    }

    public function test_a_linked_portal_login_does_not_open_the_whole_folder(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy] = $this->providerWithContact('GAL');
        ['root' => $root] = $this->filing($galaxy, $staff);
        $applicant = $this->user(Role::CLIENT);

        Client::query()->whereKey($root->client_id)->update(['user_id' => $applicant->id]);

        $this->assertFalse(FileAccess::can($applicant, 'view', $root));
        $this->assertSame(
            [],
            $this->actingAs($applicant)->getJson('/portal/files/shortcuts')->json('groups.assignedClients')
        );
    }

    public function test_a_removed_contact_loses_the_folder(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil, $company] = $this->providerWithContact('GAL');
        ['root' => $root] = $this->filing($galaxy, $staff);

        $this->assertTrue(FileAccess::can($gil, 'view', $root));

        CompanyMember::query()
            ->where('company_id', $company->id)
            ->where('user_id', $gil->id)
            ->update(['status' => CompanyMember::STATUS_REMOVED, 'removed_at' => now()]);

        $this->assertFalse(FileAccess::can($gil->fresh(), 'view', $root));
        $this->assertNotContains($root->id, FileAccess::systemVisibleFolderIds($gil->fresh()));
    }

    public function test_confirming_the_package_still_blocks_upload_for_the_contact(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        ['root' => $root, 'main' => $main, 'application' => $application] = $this->filing($galaxy, $staff);

        $slot = DocumentSlots::fill(
            $application->people()->first(),
            'passport_bio_page',
            UploadedFile::fake()->create('passport.pdf', 40, 'application/pdf'),
            $gil,
        );
        $slot->forceFill(['status' => DocumentStatus::READY_FOR_SUBMISSION])->save();
        $application->forceFill(['status' => Status::READY_TO_SUBMIT])->save();

        $this->assertTrue(FileAccess::can($gil, 'upload', $main));

        Confirmation::confirm($application->fresh(), $gil);
        $file = $slot->fresh()->file;

        $this->assertTrue(FileAccess::can($gil, 'view', $root));
        $this->assertTrue(FileAccess::can($gil, 'view', $file));
        $this->assertFalse(FileAccess::can($gil, 'upload', $main));
        $this->assertFalse(FileAccess::can($gil, 'upload', $file));
    }

    public function test_opening_an_application_provisions_a_missing_tree(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        $application = Applications::create($galaxy, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Test',
            'last_name' => 'Applicant',
        ]);

        $this->assertNull($application->folder_id);

        $this->actingAs($gil)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk();

        $root = Folder::findOrFail($application->fresh()->folder_id);
        $this->assertTrue(FileAccess::can($gil, 'view', $root));
        $this->assertTrue(
            collect($this->actingAs($gil)->getJson('/portal/files/shortcuts')->json('groups.assignedClients'))
                ->contains(fn (array $row) => $row['id'] === $root->uuid)
        );
    }

    public function test_a_provider_contact_can_open_the_applicant_profile_through_cip(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        [$galaxy, $gil] = $this->providerWithContact('GAL');
        [, $outsider] = $this->providerWithContact('BLU');
        ['application' => $application] = $this->filing($galaxy, $staff);
        $uid = $application->fresh()->client->uid;

        $this->actingAs($gil)
            ->getJson('/portal/cip/clients/'.$uid.'/application')
            ->assertOk()
            ->assertJsonPath('client.id', $uid)
            ->assertJsonPath('client.name', 'Chen Wei')
            ->assertJsonPath('application.clientUid', $uid);

        $this->actingAs($outsider)
            ->getJson('/portal/cip/clients/'.$uid.'/application')
            ->assertOk()
            ->assertJsonPath('application', null)
            ->assertJsonPath('client', null);

        $this->actingAs($gil)->getJson('/portal/clients/'.$uid)->assertForbidden();
    }
}
