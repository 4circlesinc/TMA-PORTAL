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

    public function test_a_new_provider_takes_three_letters_of_its_name(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Levera Group'])
            ->assertCreated()
            ->assertJsonPath('company.cipCode', 'LEV');
    }

    public function test_a_clashing_name_takes_a_fourth_letter(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Levera Group'])
            ->assertCreated()->assertJsonPath('company.cipCode', 'LEV');

        // LEV is spoken for, so the name gives up a fourth letter.
        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Leverage Ltd'])
            ->assertCreated()->assertJsonPath('company.cipCode', 'LEVE');

        // And a fifth after that.
        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Leverest Inc'])
            ->assertCreated()->assertJsonPath('company.cipCode', 'LEVER');
    }

    public function test_a_typed_code_still_wins(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        // The box is prefilled, not locked: what the firm types is the code.
        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Levera Group', 'cipCode' => 'ZED'])
            ->assertCreated()
            ->assertJsonPath('company.cipCode', 'ZED');
    }

    public function test_a_derived_code_never_takes_the_private_client_code(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        // PRI belongs to the private-clients bucket, so Pristine goes on to
        // four letters rather than claiming it.
        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Pristine Advisors'])
            ->assertCreated()
            ->assertJsonPath('company.cipCode', 'PRIS');
    }

    public function test_a_code_is_never_reissued_from_a_retired_provider(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $gone = Company::create(['uid' => 'levera-old', 'name' => 'Levera Group']);
        \App\Support\Cip\Providers::syncCode($gone, 'LEV');
        \App\Models\CipProvider::where('code', 'LEV')->delete();

        // The retired provider still owns LEV: it prefixes numbers already
        // filed and names a folder in the library.
        $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Levera Group'])
            ->assertCreated()
            ->assertJsonPath('company.cipCode', 'LEVE');
    }

    public function test_renaming_a_company_does_not_rewrite_its_code(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $uid = $this->actingAs($staff)->postJson('/portal/companies', ['name' => 'Levera Group'])
            ->assertCreated()->json('company.id');

        $this->actingAs($staff)->patchJson('/portal/companies/'.$uid, ['name' => 'Northwind Traders'])
            ->assertOk()
            ->assertJsonPath('company.cipCode', 'LEV');
    }

    public function test_editing_a_plain_company_does_not_make_it_a_provider(): void
    {
        $staff = $this->staff();

        $company = Company::create(['uid' => 'plain-co', 'name' => 'Plain Company']);

        // A blank code on update means "leave it alone", not "mint one".
        $this->actingAs($staff)->patchJson('/portal/companies/'.$company->uid, ['name' => 'Plain Company', 'cipCode' => ''])
            ->assertOk()
            ->assertJsonPath('company.cipCode', null);

        $this->assertDatabaseMissing('cip_providers', ['company_id' => $company->id]);
    }

    public function test_the_form_can_ask_what_code_a_name_would_get(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $this->actingAs($staff)->getJson('/portal/companies/suggest-code?name='.urlencode('Levera Group'))
            ->assertOk()
            ->assertJsonPath('code', 'LEV');

        // Asking does not reserve it — only saving does.
        $this->assertDatabaseMissing('cip_providers', ['code' => 'LEV']);

        $company = Company::create(['uid' => 'levera', 'name' => 'Levera Group']);
        \App\Support\Cip\Providers::syncCode($company, 'LEV');

        $this->actingAs($staff)->getJson('/portal/companies/suggest-code?name='.urlencode('Leverage Ltd'))
            ->assertOk()
            ->assertJsonPath('code', 'LEVE');
    }

    public function test_the_header_search_finds_a_provider_by_its_cip_code(): void
    {
        config(['services.cip.enabled' => true]);
        $staff = $this->staff();

        $galaxy = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Advisors']);
        \App\Support\Cip\Providers::syncCode($galaxy, 'GAL');
        $other = Company::create(['uid' => 'northwind', 'name' => 'Northwind']);
        \App\Support\Cip\Providers::syncCode($other, 'NWD');

        // By code, in the case a reader types it.
        $this->actingAs($staff)->getJson('/portal/companies/search?q=gal')
            ->assertOk()
            ->assertJsonCount(1, 'companies')
            ->assertJsonPath('companies.0.name', 'Galaxy Advisors')
            ->assertJsonPath('companies.0.cipCode', 'GAL');

        // And by name, which is the other handle the same record has.
        $this->actingAs($staff)->getJson('/portal/companies/search?q=northwind')
            ->assertOk()
            ->assertJsonCount(1, 'companies')
            ->assertJsonPath('companies.0.cipCode', 'NWD');
    }

    public function test_provider_search_needs_two_characters(): void
    {
        $staff = $this->staff();
        Company::create(['uid' => 'galaxy', 'name' => 'Galaxy Advisors']);

        // One letter would return the whole directory a keystroke at a time.
        $this->actingAs($staff)->getJson('/portal/companies/search?q=g')
            ->assertOk()
            ->assertJsonCount(0, 'companies');
    }
}
