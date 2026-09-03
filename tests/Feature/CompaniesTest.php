<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CompaniesTest extends TestCase
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

    public function test_staff_can_create_a_company_and_attach_a_client(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/companies', [
            'name' => 'Wayne Enterprises',
            'website' => 'https://wayne.example',
        ])->assertCreated()
            ->assertJsonPath('company.name', 'Wayne Enterprises');

        $company = Company::first();
        $this->assertNotNull($company);

        $this->actingAs($staff)->postJson('/portal/clients', [
            'uid' => 'bruce-wayne',
            'name' => 'Bruce Wayne',
            'companyId' => $company->uid,
            'profile' => [
                'firstName' => 'Bruce',
                'lastName' => 'Wayne',
                'work' => ['jobTitle' => 'Executive', 'company' => 'ignored'],
                'emails' => [['type' => 'work', 'value' => 'bruce@wayne.example']],
                'phones' => [],
                'addresses' => [],
                'importantDates' => [],
            ],
        ])->assertOk()
            ->assertJsonPath('client.companyId', $company->uid)
            ->assertJsonPath('client.companyName', 'Wayne Enterprises')
            ->assertJsonPath('client.profile.work.company', 'Wayne Enterprises');

        $this->assertDatabaseHas('clients', [
            'uid' => 'bruce-wayne',
            'company_id' => $company->id,
            'company' => 'Wayne Enterprises',
        ]);

        $this->actingAs($staff)->getJson('/portal/companies/'.$company->uid)
            ->assertOk()
            ->assertJsonPath('company.people.0.id', 'bruce-wayne');
    }

    public function test_the_directory_lists_people_from_every_service_provider(): void
    {
        $staff = $this->staff();
        $galaxy = Company::create(['uid' => 'galaxy-partners', 'name' => 'Galaxy Partners']);
        $wayne = Company::create(['uid' => 'wayne-enterprises', 'name' => 'Wayne Enterprises']);

        Client::create([
            'uid' => 'sarah-cheng', 'name' => 'Sarah Cheng',
            'company_id' => $galaxy->id, 'email' => 'sarah.cheng@galaxypartners.example',
            'data' => [],
        ]);
        Client::create([
            'uid' => 'bruce-wayne', 'name' => 'Bruce Wayne',
            'company_id' => $wayne->id, 'email' => 'bruce@wayne.example',
            'data' => [],
        ]);
        Client::create([
            'uid' => 'orphan-contact', 'name' => 'No Firm',
            'data' => [],
        ]);

        $companies = collect($this->actingAs($staff)->getJson('/portal/companies')
            ->assertOk()
            ->json('companies'));

        $people = $companies->flatMap(fn ($company) => $company['people'] ?? []);
        $this->assertEqualsCanonicalizing(
            ['sarah-cheng', 'bruce-wayne'],
            $people->pluck('id')->all(),
            'The Provider contacts tab is every contact that belongs to a service provider, not the unattached directory.',
        );
        $this->assertEquals(
            'sarah.cheng@galaxypartners.example',
            $people->firstWhere('id', 'sarah-cheng')['email'],
        );
        $this->assertEquals(
            ['sarah-cheng'],
            collect($companies->firstWhere('id', 'galaxy-partners')['people'])->pluck('id')->all(),
        );
    }

    public function test_deleting_a_provider_keeps_its_people_and_referrals(): void
    {
        $staff = $this->staff();
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        $contact = Client::create([
            'uid' => 'contact-one', 'name' => 'Contact One',
            'company_id' => $company->id, 'data' => [],
        ]);
        $referred = Client::create([
            'uid' => 'referred-one', 'name' => 'Referred One',
            'referral_type' => 'company', 'referred_by_company_id' => $company->id, 'data' => [],
        ]);

        $this->actingAs($staff)->deleteJson('/portal/companies/'.$company->uid)->assertOk();

        $this->assertSoftDeleted('companies', ['id' => $company->id]);
        // The people survive; only their link to the provider goes.
        $this->assertNull($contact->fresh()->company_id);
        $this->assertNull($referred->fresh()->referred_by_company_id);
        $this->assertSame('none', $referred->fresh()->referral_type);
    }

    public function test_deleting_a_provider_can_take_its_people_with_it(): void
    {
        $staff = $this->staff();
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        $contact = Client::create([
            'uid' => 'contact-one', 'name' => 'Contact One',
            'company_id' => $company->id, 'data' => [],
        ]);
        $referred = Client::create([
            'uid' => 'referred-one', 'name' => 'Referred One',
            'referral_type' => 'company', 'referred_by_company_id' => $company->id, 'data' => [],
        ]);

        $this->actingAs($staff)
            ->deleteJson('/portal/companies/'.$company->uid.'?withPeople=1')
            ->assertOk();

        // Everyone attached to it goes: its contacts and the clients it
        // referred, which is what the reader is shown on the record.
        $this->assertSoftDeleted('clients', ['id' => $contact->id]);
        $this->assertSoftDeleted('clients', ['id' => $referred->id]);
    }

    public function test_a_new_provider_gets_a_folder_in_the_citizenship_library(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $root = \App\Models\Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Citizenship Applications',
            'folder_type' => \App\Models\Folder::TYPE_ORGANIZATION,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        $provider = \App\Support\Cip\Providers::syncCode($company, 'GAL');

        $this->assertNotNull($provider->folder_id);
        $folder = \App\Models\Folder::find($provider->folder_id);
        $this->assertSame('Galaxy', $folder->name);
        $this->assertSame($root->id, (int) $folder->parent_id);
    }

    public function test_a_provider_adopts_an_existing_library_folder_instead_of_duplicating(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $root = \App\Models\Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Citizenship Applications',
            'folder_type' => \App\Models\Folder::TYPE_ORGANIZATION,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);
        // The sync imported the provider's folder first (names case-differ).
        $existing = \App\Models\Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'GALAXY', 'parent_id' => $root->id,
            'owner_id' => $staff->id, 'created_by' => $staff->id, 'origin' => 'sharepoint',
        ]);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);

        $provider = \App\Support\Cip\Providers::syncCode($company, 'GAL');

        $this->assertSame($existing->id, (int) $provider->folder_id);
        $this->assertSame(1, \App\Models\Folder::where('parent_id', $root->id)->count());
    }

    public function test_a_provider_with_numbered_applications_cannot_be_deleted(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $provider = \App\Support\Cip\Providers::syncCode($company, 'GAL');
        \App\Support\Cip\Applications::create($provider, $staff);

        // Those numbers name this provider forever.
        $this->actingAs($staff)->deleteJson('/portal/companies/'.$company->uid)
            ->assertStatus(422);

        $this->assertNotSoftDeleted('companies', ['id' => $company->id]);
    }

    public function test_a_provider_backed_company_cannot_be_deleted_even_before_its_first_application(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        \App\Support\Cip\Providers::syncCode($company, 'GAL');

        /*
         * Refused with no applications too. The gap this closes put four
         * provider firms in the Recycle Bin: the CIP registry kept offering
         * them while the Service providers tab — which lists companies —
         * showed nothing, and the bin does not list companies, so there was
         * no way back from inside the portal.
         */
        $this->actingAs($staff)->deleteJson('/portal/companies/'.$company->uid)
            ->assertStatus(422)
            ->assertJsonPath('message', 'This company is the service provider firm GAL. Remove the provider registration first.');

        $this->assertNotSoftDeleted('companies', ['id' => $company->id]);
    }
}
