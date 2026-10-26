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
