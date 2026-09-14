<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipDocument;
use App\Models\CipDocumentRequirement;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicantType;
use App\Support\Cip\Applications;
use App\Support\Cip\CorRequirements;
use App\Support\Cip\Pack;
use App\Support\Cip\Phase;
use App\Support\Cip\PostApproval;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Post-approval person folders are one repository per person, not one per save.
 *
 * SharePoint's folder-create conflict rule renames a second push to
 * "Dependent 1 14". Copying that name back onto the portal row made the next
 * provision miss the folder and mint another, so a client ended up with
 * Dependent 1, Dependent 1 11, Dependent 1 14… each holding empty COR / NIC /
 * Passport drawers. Provisioning must reuse the numbered copies and fold
 * them into one.
 */
class CipPostApprovalTreeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    public function test_sharepoint_style_suffixes_count_as_the_same_person_folder(): void
    {
        $this->assertSame('Dependent 1', Tree::canonicalPersonName('Dependent 1'));
        $this->assertSame('Dependent 1', Tree::canonicalPersonName('Dependent 1 11'));
        $this->assertSame('Dependent 1', Tree::canonicalPersonName('Dependent 1 14'));
        $this->assertSame('Dependent 1', Tree::canonicalPersonName('Dependent 1 (1)'));
        $this->assertSame('Dependent 1', Tree::canonicalPersonName('Dependent 1 2'));
        $this->assertSame('Dependent 2', Tree::canonicalPersonName('Dependent 2'));
        $this->assertSame('Dependent 2', Tree::canonicalPersonName('Dependent 2 8'));
        $this->assertSame('Main Applicant', Tree::canonicalPersonName('Main Applicant 44'));
        $this->assertSame('Sponsor', Tree::canonicalPersonName('Sponsor 1'));
        $this->assertNull(Tree::canonicalPersonName('Dependent 1 Backup'));
        $this->assertNull(Tree::canonicalPersonName('Additional Documents 1'));
        $this->assertTrue(Tree::isPersonFolderVariant('Dependent 1', 'Dependent 1 14'));
        $this->assertFalse(Tree::isPersonFolderVariant('Dependent 1', 'Dependent 2'));
        $this->assertFalse(Tree::isPersonFolderVariant('Dependent 1', 'Dependent 2 8'));
    }

    public function test_provisioning_twice_does_not_mint_another_dependent_folder(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();

        Tree::provisionPostApproval($application->fresh(), $staff);
        Tree::provisionPostApproval($application->fresh(), $staff);

        $this->assertSame(['Dependent 1', 'Main Applicant'], $this->personNames($application));
    }

    public function test_numbered_dependent_folders_collapse_into_one(): void
    {
        ['staff' => $staff, 'application' => $application, 'dependent' => $dependent] = $this->filed();

        $postRoot = Folder::find($application->post_approval_folder_id);
        $canonical = Folder::find($dependent->post_approval_folder_id);
        $canonical->forceFill(['name' => 'Dependent 1 14'])->save();

        $eleven = $this->numberedPerson($postRoot, $staff, 'Dependent 1 11');
        $twentyOne = $this->numberedPerson($postRoot, $staff, 'Dependent 1 21');

        $cor = Folder::query()
            ->where('parent_id', $eleven->id)
            ->where('name', Pack::folder(Pack::COR))
            ->firstOrFail();

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $cor->id,
            'name' => 'oath.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 12,
            'disk' => 'local',
            'storage_path' => 'vault/oath.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        Tree::provisionPostApproval($application->fresh(), $staff);

        $this->assertSame(['Dependent 1', 'Main Applicant'], $this->personNames($application));

        $kept = Folder::find($dependent->fresh()->post_approval_folder_id);
        $this->assertNotNull($kept);
        $this->assertSame('Dependent 1', $kept->name);
        $this->assertSame($canonical->id, $kept->id);

        $keptCor = Folder::query()
            ->where('parent_id', $kept->id)
            ->where('name', Pack::folder(Pack::COR))
            ->firstOrFail();
        $this->assertSame($keptCor->id, $file->fresh()->folder_id);

        $this->assertTrue($eleven->fresh()->trashed());
        $this->assertTrue($twentyOne->fresh()->trashed());
        $this->assertEqualsCanonicalizing(
            [Pack::folder(Pack::COR), Pack::folder(Pack::NIC), Pack::folder(Pack::PASSPORT)],
            Folder::query()->where('parent_id', $kept->id)->pluck('name')->all(),
        );
    }

    public function test_a_renamed_copy_is_reused_when_the_person_has_no_folder_id(): void
    {
        ['staff' => $staff, 'application' => $application, 'dependent' => $dependent] = $this->filed();

        $folder = Folder::find($dependent->post_approval_folder_id);
        $folder->forceFill(['name' => 'Dependent 1 14'])->save();
        $dependent->forceFill(['post_approval_folder_id' => null])->save();

        Tree::provisionPostApproval($application->fresh(), $staff);

        $this->assertSame(['Dependent 1', 'Main Applicant'], $this->personNames($application));
        $this->assertSame($folder->id, $dependent->fresh()->post_approval_folder_id);
        $this->assertSame('Dependent 1', $folder->fresh()->name);
    }

    public function test_dependent_two_is_not_folded_into_dependent_one(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Omar',
            'last_name' => 'Haddad',
            'date_of_birth' => now()->subYears(12),
            'dependent_ordinal' => 2,
        ]);

        Tree::provisionPostApproval($application->fresh(['people']), $staff);

        $this->assertSame(
            ['Dependent 1', 'Dependent 2', 'Main Applicant'],
            $this->personNames($application->fresh()),
        );

        $postRoot = Folder::find($application->fresh()->post_approval_folder_id);
        $this->numberedPerson($postRoot, $staff, 'Dependent 1 14');

        Tree::provisionPostApproval($application->fresh(['people']), $staff);

        $this->assertSame(
            ['Dependent 1', 'Dependent 2', 'Main Applicant'],
            $this->personNames($application->fresh()),
        );
    }

    public function test_opening_a_post_approval_file_collapses_numbered_copies(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();

        $postRoot = Folder::find($application->post_approval_folder_id);
        $this->numberedPerson($postRoot, $staff, 'Dependent 1 11');
        $this->numberedPerson($postRoot, $staff, 'Dependent 1 14');

        $this->actingAs($staff)
            ->getJson('/portal/cip/applications/'.$application->uuid)
            ->assertOk();

        $this->assertSame(['Dependent 1', 'Main Applicant'], $this->personNames($application->fresh()));
    }

    public function test_browsing_the_post_approval_folder_collapses_numbered_copies(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();

        $postRoot = Folder::find($application->post_approval_folder_id);
        $this->numberedPerson($postRoot, $staff, 'Dependent 1 11');
        $this->numberedPerson($postRoot, $staff, 'Dependent 1 14');

        $this->actingAs($staff)
            ->getJson('/portal/files/?section=all&folder='.$postRoot->uuid)
            ->assertOk();

        $this->assertSame(['Dependent 1', 'Main Applicant'], $this->personNames($application->fresh()));
    }

    public function test_attached_post_approval_files_move_into_the_pack_drawer(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $template = $this->postTemplate($main, CorRequirements::OATH_OF_ALLEGIANCE, 'Oath of Allegiance');

        $file = $this->fileOn($staff, $main->folder_id, 'oath.pdf');
        $this->slot($application, $main, $template, $file, $staff);

        Tree::provisionPostApproval($application->fresh(['people']), $staff);

        $cor = Folder::query()
            ->where('parent_id', $main->fresh()->post_approval_folder_id)
            ->where('name', Pack::folder(Pack::COR))
            ->firstOrFail();

        $this->assertSame($cor->id, $file->fresh()->folder_id);
        $this->assertNull($file->fresh()->deleted_at);
    }

    public function test_a_recycled_slot_file_is_restored_into_the_pack_drawer(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $template = $this->postTemplate($main, CorRequirements::OATH_OF_ALLEGIANCE, 'Oath of Allegiance');

        $file = $this->fileOn($staff, $main->folder_id, 'oath.pdf');
        $this->slot($application, $main, $template, $file, $staff);
        $file->delete();
        $this->assertNotNull($file->fresh()->deleted_at);

        Tree::provisionPostApproval($application->fresh(['people']), $staff);

        $cor = Folder::query()
            ->where('parent_id', $main->fresh()->post_approval_folder_id)
            ->where('name', Pack::folder(Pack::COR))
            ->firstOrFail();

        $this->assertNull($file->fresh()->deleted_at);
        $this->assertSame($cor->id, $file->fresh()->folder_id);
    }

    public function test_carried_forward_files_stay_out_of_the_post_approval_tree(): void
    {
        ['staff' => $staff, 'application' => $application, 'root' => $root] = $this->filed();
        $main = $application->people->firstWhere('role', CipPerson::ROLE_MAIN_APPLICANT);
        $template = $this->postTemplate($main, 'passport_photo', 'Passport photo');
        $template->forceFill([
            'at_pre_approval' => true,
            'carry_forward' => true,
            'folder' => null,
        ])->save();

        $holding = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Main Applicant',
            'folder_type' => Folder::TYPE_USER,
            'parent_id' => $root->id,
            'client_id' => $root->client_id,
            'owner_id' => $root->owner_id,
            'created_by' => $staff->id,
        ]);
        $main->forceFill(['folder_id' => $holding->id])->save();

        $file = $this->fileOn($staff, $holding->id, 'photo.jpg');
        $this->slot($application, $main, $template, $file, $staff);

        Tree::provisionPostApproval($application->fresh(['people']), $staff);

        $this->assertSame($holding->id, $file->fresh()->folder_id);
    }

    /**
     * @return array{staff: User, application: CipApplication, dependent: CipPerson, root: Folder}
     */
    private function filed(): array
    {
        $staff = User::create([
            'name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('password12345'),
        ]);
        $staff->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy', 'created_by' => $staff->id]);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);
        $application = Applications::create($provider, $staff);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        $dependent = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_DEPENDENT,
            'first_name' => 'Kid', 'last_name' => 'Wei',
            'date_of_birth' => now()->subYears(8),
            'dependent_ordinal' => 1,
        ]);

        $application->forceFill([
            'phase' => Phase::POST_APPROVAL,
            'post_approval_at' => now(),
        ])->save();

        PostApproval::prepare($application->fresh(['people']), $staff);
        $application = $application->fresh(['people']);
        $dependent = $dependent->fresh();
        $root = Folder::find($application->folder_id);

        return compact('staff', 'application', 'dependent', 'root');
    }

    private function numberedPerson(Folder $parent, User $staff, string $name): Folder
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_USER,
            'parent_id' => $parent->id,
            'client_id' => $parent->client_id,
            'owner_id' => $parent->owner_id,
            'created_by' => $staff->id,
        ]);
        foreach ([Pack::COR, Pack::NIC, Pack::PASSPORT] as $pack) {
            Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => Pack::folder($pack),
                'folder_type' => Folder::TYPE_USER,
                'parent_id' => $folder->id,
                'client_id' => $parent->client_id,
                'owner_id' => $parent->owner_id,
                'created_by' => $staff->id,
            ]);
        }

        return $folder;
    }

    private function postTemplate(CipPerson $person, string $key, string $label): CipDocumentRequirement
    {
        $row = CipDocumentRequirement::query()
            ->where('applicant_type', ApplicantType::for($person))
            ->where('key', $key)
            ->first();

        if ($row === null) {
            $row = new CipDocumentRequirement;
            $row->forceFill([
                'applicant_type' => ApplicantType::for($person),
                'key' => $key,
                'label' => $label,
                'required' => true,
                'active' => true,
                'sort_order' => 1,
            ]);
        }

        $row->forceFill([
            'label' => $label,
            'at_pre_approval' => false,
            'at_post_approval' => true,
            'carry_forward' => false,
            'folder' => CorRequirements::FOLDER,
        ])->save();

        return $row;
    }

    private function fileOn(User $staff, ?int $folderId, string $name): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folderId,
            'name' => $name,
            'extension' => pathinfo($name, PATHINFO_EXTENSION) ?: 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 24,
            'disk' => 'local',
            'storage_path' => 'vault/'.$name,
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);
    }

    private function slot(
        CipApplication $application,
        CipPerson $person,
        CipDocumentRequirement $template,
        FileItem $file,
        User $staff,
    ): CipDocument {
        $slot = CipDocument::query()
            ->where('person_id', $person->id)
            ->where('type', $template->key)
            ->first();

        if ($slot === null) {
            $slot = new CipDocument;
            $slot->forceFill([
                'application_id' => $application->id,
                'person_id' => $person->id,
                'type' => $template->key,
            ]);
        }

        $slot->forceFill([
            'requirement_id' => $template->id,
            'label' => $template->label,
            'required' => true,
            'file_id' => $file->id,
            'uploaded_by' => $staff->id,
            'uploaded_at' => now(),
        ])->save();

        return $slot;
    }

    /** @return list<string> */
    private function personNames($application): array
    {
        $postRoot = Folder::find($application->fresh()->post_approval_folder_id);
        $this->assertNotNull($postRoot);

        return Folder::query()
            ->where('parent_id', $postRoot->id)
            ->get()
            ->filter(fn (Folder $child) => Tree::canonicalPersonName($child->name) !== null)
            ->pluck('name')
            ->sort()
            ->values()
            ->all();
    }
}
