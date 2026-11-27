<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Companies\CompanyMembers;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class CompanyMergeTest extends TestCase
{
    use RefreshDatabase;

    private function staff(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_staff_can_fold_a_duplicate_provider_into_the_one_that_remains(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $keeper = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $duplicate = Company::create([
            'uid' => 'galaxy-2',
            'name' => 'Galaxy Partners 2',
            'website' => 'https://galaxy.example',
        ]);

        $keepProvider = CipProvider::create([
            'name' => 'Galaxy Partners',
            'code' => 'GAL',
            'company_id' => $keeper->id,
            'active' => true,
        ]);
        $dropProvider = CipProvider::create([
            'name' => 'Galaxy Partners 2',
            'code' => 'GCC',
            'company_id' => $duplicate->id,
            'active' => true,
        ]);

        $keepFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Galaxy Partners',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_USER,
        ]);
        $dropFolder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Galaxy Partners 2',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_USER,
        ]);
        $papers = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Chen Wei',
            'parent_id' => $dropFolder->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
            'folder_type' => Folder::TYPE_CLIENT,
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $dropFolder->id,
            'name' => 'passport.pdf',
            'storage_path' => 'vault/passport.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
        ]);
        $keepProvider->forceFill(['folder_id' => $keepFolder->id])->save();
        $dropProvider->forceFill(['folder_id' => $dropFolder->id])->save();

        $contact = Client::create([
            'uid' => 'ada-contact',
            'name' => 'Ada Contact',
            'email' => 'ada@galaxy.example',
            'company_id' => $duplicate->id,
            'company' => 'Galaxy Partners 2',
            'data' => ['work' => ['company' => 'Galaxy Partners 2', 'jobTitle' => 'Counsel']],
        ]);
        $referred = Client::create([
            'uid' => 'referred-client',
            'name' => 'Referred Client',
            'referred_by_company_id' => $duplicate->id,
            'data' => [],
        ]);
        CompanyMembers::add($duplicate, [
            'email' => 'ada@galaxy.example',
            'name' => 'Ada Contact',
            'client_id' => $contact->id,
            'can_invite_others' => true,
        ], $staff, notify: false);

        $applicant = Client::create([
            'uid' => 'chen-wei',
            'name' => 'Chen Wei',
            'data' => [],
        ]);
        $application = CipApplication::create([
            'provider_id' => $dropProvider->id,
            'client_id' => $applicant->id,
            'created_by' => $staff->id,
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/merge', ['companyId' => 'galaxy-2'])
            ->assertOk()
            ->assertJsonPath('removedId', 'galaxy-2');

        $contact->refresh();
        $this->assertSame($keeper->id, $contact->company_id);
        $this->assertSame('Galaxy Partners', $contact->company);
        $this->assertSame('Galaxy Partners', $contact->data['work']['company']);
        $this->assertSame('Counsel', $contact->data['work']['jobTitle']);
        $this->assertSame($keeper->id, $referred->fresh()->referred_by_company_id);

        $this->assertTrue(
            CompanyMember::query()->current()->where('company_id', $keeper->id)->where('email', 'ada@galaxy.example')->exists()
        );
        $this->assertFalse(
            CompanyMember::query()->current()->where('company_id', $duplicate->id)->exists()
        );

        $this->assertSame($keepProvider->id, $application->fresh()->provider_id);
        $this->assertSame('GAL', $keepProvider->fresh()->code);
        $this->assertSoftDeleted('cip_providers', ['id' => $dropProvider->id]);
        $this->assertNotSame('GCC', CipProvider::withTrashed()->find($dropProvider->id)->code);

        $this->assertSame($keepFolder->id, $papers->fresh()->parent_id);
        $this->assertSame($keepFolder->id, $file->fresh()->folder_id);
        $this->assertSoftDeleted('folders', ['id' => $dropFolder->id]);

        $this->assertSame('https://galaxy.example', $keeper->fresh()->website);
        $this->assertSoftDeleted('companies', ['id' => $duplicate->id]);

        Mail::assertNothingSent();
    }

    public function test_a_firm_without_a_code_takes_the_one_being_merged(): void
    {
        $staff = $this->staff();
        $keeper = Company::create(['uid' => 'plain', 'name' => 'Plain Firm']);
        $duplicate = Company::create(['uid' => 'gulf', 'name' => 'Gulf Coast']);
        $provider = CipProvider::create([
            'name' => 'Gulf Coast',
            'code' => 'GCC',
            'company_id' => $duplicate->id,
            'active' => true,
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/plain/merge', ['companyId' => 'gulf'])
            ->assertOk();

        $provider->refresh();
        $this->assertSame($keeper->id, $provider->company_id);
        $this->assertSame('GCC', $provider->code);
        $this->assertNull($provider->deleted_at);
    }

    /**
     * The 2026-09-24 register clean-up ({@see \App\Support\Cip\ProviderMerge})
     * put duplicate provider rows in the bin with their company link intact.
     * A firm whose only row went that way, kept in a later merge, used to
     * take the applications onto the binned row: every file read as having
     * no service provider and the firm left the provider list.
     */
    public function test_merging_into_a_firm_whose_only_provider_row_is_binned_keeps_the_files_on_a_live_one(): void
    {
        Mail::fake();

        $staff = $this->staff();
        $keeper = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        $duplicate = Company::create(['uid' => 'igraphix-2', 'name' => 'iGraphix Marketing']);

        $binned = CipProvider::create([
            'name' => 'iGraphix',
            'code' => 'IGX',
            'company_id' => $keeper->id,
            'active' => true,
        ]);
        $binned->delete();

        $live = CipProvider::create([
            'name' => 'iGraphix Marketing',
            'code' => 'IGA',
            'company_id' => $duplicate->id,
            'active' => true,
        ]);

        $login = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::CLIENT,
            'email' => 'dana@igraphix.example',
        ]);
        CompanyMember::create([
            'company_id' => $duplicate->id,
            'user_id' => $login->id,
            'name' => 'Dana Contact',
            'email' => 'dana@igraphix.example',
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $applicant = Client::create(['uid' => 'chen-wei', 'name' => 'Chen Wei', 'data' => []]);
        $application = CipApplication::create([
            'provider_id' => $live->id,
            'client_id' => $applicant->id,
            'created_by' => $staff->id,
        ]);

        $this->actingAs($staff)
            ->postJson('/portal/companies/igraphix/merge', ['companyId' => 'igraphix-2'])
            ->assertOk();

        $provider = $application->fresh()->provider;
        $this->assertNotNull($provider, 'The file still has a service provider after the merge.');
        $this->assertSame($keeper->id, $provider->company_id);
        $this->assertSame('IGA', $provider->code, 'The live row and its code carry on; nothing is renumbered.');
        $this->assertSoftDeleted('cip_providers', ['id' => $binned->id]);

        $options = $this->actingAs($staff)
            ->getJson('/portal/clients/chen-wei/conversations')
            ->assertOk()
            ->json('options.provider');
        $this->assertTrue($options['available']);
        $this->assertSame('iGraphix', $options['companyName']);
        $this->assertSame(1, $options['accountCount'], 'The contact who signs in came across with the firm.');
    }

    /**
     * Files an earlier merge already left on a binned row are put back on a
     * live one: the firm's live row when it has one, else the binned row
     * comes out of the bin; a company merged away since is followed to the
     * firm that remains.
     */
    public function test_files_a_past_merge_left_on_a_binned_row_are_put_back_on_a_live_one(): void
    {
        $staff = $this->staff();
        $file = function (CipProvider $provider, string $uid) use ($staff): CipApplication {
            $client = Client::create(['uid' => $uid, 'name' => $uid, 'data' => []]);

            return CipApplication::create([
                'provider_id' => $provider->id,
                'client_id' => $client->id,
                'created_by' => $staff->id,
            ]);
        };

        // The firm's only row is in the bin, holding its files.
        $igraphix = Company::create(['uid' => 'igraphix', 'name' => 'iGraphix']);
        $onlyRow = CipProvider::create(['name' => 'iGaphix', 'code' => 'IGX', 'company_id' => $igraphix->id, 'active' => true]);
        $stranded = $file($onlyRow, 'stranded-one');
        $onlyRow->delete();

        // The firm has a live row; a binned twin still holds a file.
        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        $galaxyLive = CipProvider::create(['name' => 'Galaxy Partners', 'code' => 'GAL', 'company_id' => $galaxy->id, 'active' => true]);
        $galaxyBinned = CipProvider::create(['name' => 'Galaxy Partners 2', 'code' => 'GA2', 'company_id' => $galaxy->id, 'active' => true]);
        $onTwin = $file($galaxyBinned, 'on-twin');
        $galaxyBinned->delete();

        // The row's company was merged into another since.
        $harbour = Company::create(['uid' => 'harbour', 'name' => 'Harbour Trust']);
        $harbourLive = CipProvider::create(['name' => 'Harbour Trust', 'code' => 'HAR', 'company_id' => $harbour->id, 'active' => true]);
        $harbourOld = Company::create(['uid' => 'harbour-old', 'name' => 'Harbour Trust Ltd']);
        $oldRow = CipProvider::create(['name' => 'Harbour Trust Ltd', 'code' => 'HTL', 'company_id' => $harbourOld->id, 'active' => true]);
        $followed = $file($oldRow, 'followed');
        $oldRow->delete();
        $harbourOld->delete();
        \App\Support\Activity\ActivityLogger::log([
            'actor' => $staff,
            'type' => 'company.merged',
            'module' => 'clients',
            'description' => 'merged',
            'subject' => $harbour,
            'old' => ['companyUid' => 'harbour-old', 'company' => 'Harbour Trust Ltd'],
            'new' => ['companyUid' => 'harbour', 'company' => 'Harbour Trust'],
        ]);

        $result = \App\Support\Companies\CompanyMerge::repairStranded();

        $this->assertSame(['moved' => 2, 'restored' => 1, 'left' => []], $result);
        $this->assertSame($onlyRow->id, $stranded->fresh()->provider?->id);
        $this->assertNull($onlyRow->fresh()->deleted_at);
        $this->assertSame('iGraphix', $onlyRow->fresh()->name, 'It wears the firm\'s name, as on the Service providers tab.');
        $this->assertSame($galaxyLive->id, $onTwin->fresh()->provider?->id);
        $this->assertNull($galaxyBinned->fresh()->company_id, 'The binned twin stops naming the firm.');
        $this->assertSame($harbourLive->id, $followed->fresh()->provider?->id);

        // Nothing left to do the second time.
        $this->assertSame(['moved' => 0, 'restored' => 0, 'left' => []], \App\Support\Companies\CompanyMerge::repairStranded());
    }

    public function test_a_firm_cannot_be_merged_into_itself(): void
    {
        $staff = $this->staff();
        Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);

        $this->actingAs($staff)
            ->postJson('/portal/companies/galaxy/merge', ['companyId' => 'galaxy'])
            ->assertStatus(422);
    }

    public function test_a_service_provider_admin_cannot_merge_firms(): void
    {
        Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Partners']);
        Company::create(['uid' => 'gulf', 'name' => 'Gulf Coast']);

        $admin = User::factory()->create([
            'status' => 'approved',
            'account_type' => Role::SERVICE_PROVIDER_ADMIN,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/companies/galaxy/merge', ['companyId' => 'gulf'])
            ->assertForbidden();
    }
}
