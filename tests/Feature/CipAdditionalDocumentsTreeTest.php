<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Company;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Package;
use App\Support\Cip\Tree;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Additional Documents is one drawer on the client, not one per save.
 *
 * SharePoint's folder-create conflict rule renames a second push to
 * "Additional Documents 1". Copying that name back onto the portal row made
 * the next provision miss the drawer and mint another, so a client ended up
 * with Additional Documents 1, 3, 5, 8… each holding the empty purpose
 * folders. Provisioning must reuse the numbered copies and fold them into one.
 */
class CipAdditionalDocumentsTreeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    public function test_provisioning_twice_does_not_mint_another_additional_documents_folder(): void
    {
        ['staff' => $staff, 'application' => $application, 'root' => $root] = $this->filed();

        Tree::provision($application->fresh(), $staff);
        Tree::provision($application->fresh(), $staff);

        $this->assertSame(
            ['Additional Documents'],
            $this->additionalNames($root),
        );
        $this->assertSame([
            Tree::ADDITIONAL_DD_QUERY,
            Tree::ADDITIONAL_NON_COMPLIANCE,
            Tree::ADDITIONAL_QUERIES,
        ], $this->drawerNames(
            Tree::additionalFolder($application->fresh()),
        ));
    }

    public function test_a_second_application_for_the_same_client_shares_the_drawer(): void
    {
        ['staff' => $staff, 'application' => $first, 'root' => $root, 'provider' => $provider] = $this->filed();

        $second = Applications::create($provider, $staff, ['client_id' => $first->client_id]);
        CipPerson::create([
            'application_id' => $second->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
        ]);
        Tree::provision($second->fresh(), $staff);

        $this->assertSame($first->folder_id, $second->fresh()->folder_id);
        $this->assertSame(['Additional Documents'], $this->additionalNames($root));
        $this->assertSame(
            Tree::additionalFolder($first->fresh())?->id,
            Tree::additionalFolder($second->fresh())?->id,
        );
    }

    public function test_numbered_additional_documents_folders_collapse_into_one(): void
    {
        ['staff' => $staff, 'application' => $application, 'root' => $root] = $this->filed();

        $canonical = Tree::additionalFolder($application);
        $canonical->forceFill(['name' => 'Additional Documents 1'])->save();

        $eleven = $this->numberedAdditional($root, $staff, 'Additional Documents 11');
        $fourteen = $this->numberedAdditional($root, $staff, 'Additional Documents 14');

        $queries = Folder::query()
            ->where('parent_id', $eleven->id)
            ->where('name', Tree::ADDITIONAL_QUERIES)
            ->firstOrFail();

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $queries->id,
            'name' => 'unit-query.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 12,
            'disk' => 'local',
            'storage_path' => 'vault/unit-query.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);

        Tree::provision($application->fresh(), $staff);

        $this->assertSame(['Additional Documents'], $this->additionalNames($root));

        $kept = Tree::additionalFolder($application->fresh());
        $this->assertNotNull($kept);
        $this->assertSame(Tree::ADDITIONAL, $kept->name);
        $this->assertSame($canonical->id, $kept->id);

        $keptQueries = Folder::query()
            ->where('parent_id', $kept->id)
            ->where('name', Tree::ADDITIONAL_QUERIES)
            ->firstOrFail();
        $this->assertSame($keptQueries->id, $file->fresh()->folder_id);

        $this->assertTrue($eleven->fresh()->trashed());
        $this->assertTrue($fourteen->fresh()->trashed());
        $this->assertSame([
            Tree::ADDITIONAL_DD_QUERY,
            Tree::ADDITIONAL_NON_COMPLIANCE,
            Tree::ADDITIONAL_QUERIES,
        ], $this->drawerNames($kept));
    }

    public function test_a_numbered_additional_documents_folder_stays_writable_after_lock(): void
    {
        ['staff' => $staff, 'application' => $application, 'root' => $root] = $this->filed();

        $application->forceFill(['locked_at' => now()])->save();
        $clone = $this->numberedAdditional($root, $staff, 'Additional Documents 11');
        Package::forget();

        $this->assertFalse(Package::locksFolder($clone));
        $this->assertFalse(Package::locksFolder(
            Folder::query()
                ->where('parent_id', $clone->id)
                ->where('name', Tree::ADDITIONAL_QUERIES)
                ->firstOrFail(),
        ));
    }

    public function test_sharepoint_style_suffixes_count_as_the_same_drawer(): void
    {
        $this->assertTrue(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Additional Documents'));
        $this->assertTrue(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Additional Documents 1'));
        $this->assertTrue(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Additional Documents 14'));
        $this->assertTrue(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Additional Documents (1)'));
        $this->assertFalse(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Additional Documents Backup'));
        $this->assertFalse(Tree::isDrawerVariant(Tree::ADDITIONAL, 'Main Applicant'));
        $this->assertSame(Tree::ADDITIONAL, Tree::canonicalDrawerName('Additional Documents 8'));
        $this->assertSame(Tree::ADDITIONAL_QUERIES, Tree::canonicalDrawerName('Queries'));
        $this->assertSame(Tree::ADDITIONAL_QUERIES, Tree::canonicalDrawerName('Queries Responses'));
        $this->assertSame(Tree::ADDITIONAL_NON_COMPLIANCE, Tree::canonicalDrawerName('Non-Compliance Requests'));
        $this->assertSame(Tree::ADDITIONAL_DD_QUERY, Tree::canonicalDrawerName('Unit Requests'));
        $this->assertSame(Tree::ADDITIONAL_DD_QUERY, Tree::canonicalDrawerName('Supplementary Documents'));
    }

    public function test_legacy_purpose_drawers_are_renamed_on_provision(): void
    {
        ['staff' => $staff, 'application' => $application] = $this->filed();

        $additional = Tree::additionalFolder($application);
        $this->assertNotNull($additional);

        Folder::query()->where('parent_id', $additional->id)->forceDelete();
        foreach (['Queries', 'Non-Compliance Requests', 'Unit Requests', 'Supplementary Documents'] as $name) {
            Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => $name,
                'folder_type' => Folder::TYPE_USER,
                'parent_id' => $additional->id,
                'client_id' => $additional->client_id,
                'owner_id' => $additional->owner_id,
                'created_by' => $staff->id,
            ]);
        }

        Tree::provision($application->fresh(), $staff);

        $this->assertSame([
            Tree::ADDITIONAL_DD_QUERY,
            Tree::ADDITIONAL_NON_COMPLIANCE,
            Tree::ADDITIONAL_QUERIES,
        ], $this->drawerNames(Tree::additionalFolder($application->fresh())));
    }

    /**
     * @return array{staff: User, application: CipApplication, root: Folder, provider: CipProvider}
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
        $root = Tree::provision($application->fresh(), $staff);
        $application = $application->fresh();

        return compact('staff', 'application', 'root', 'provider');
    }

    private function numberedAdditional(Folder $root, User $staff, string $name): Folder
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_USER,
            'parent_id' => $root->id,
            'client_id' => $root->client_id,
            'owner_id' => $root->owner_id,
            'created_by' => $staff->id,
        ]);
        foreach (Tree::ADDITIONAL_DRAWERS as $drawer) {
            Folder::create([
                'uuid' => (string) Str::uuid(),
                'name' => $drawer,
                'folder_type' => Folder::TYPE_USER,
                'parent_id' => $folder->id,
                'client_id' => $root->client_id,
                'owner_id' => $root->owner_id,
                'created_by' => $staff->id,
            ]);
        }

        return $folder;
    }

    /** @return list<string> */
    private function additionalNames(Folder $root): array
    {
        return Folder::query()
            ->where('parent_id', $root->id)
            ->get()
            ->filter(fn (Folder $child) => Tree::isDrawerVariant(Tree::ADDITIONAL, $child->name))
            ->pluck('name')
            ->sort()
            ->values()
            ->all();
    }

    /** @return list<string> */
    private function drawerNames(?Folder $additional): array
    {
        $this->assertNotNull($additional);

        return Folder::query()
            ->where('parent_id', $additional->id)
            ->pluck('name')
            ->sort()
            ->values()
            ->all();
    }
}
