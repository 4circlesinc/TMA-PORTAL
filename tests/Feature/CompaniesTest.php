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

        // Its own people go with it…
        $this->assertSoftDeleted('clients', ['id' => $contact->id]);
        // …but the applicants it referred are the firm's, and stay.
        $this->assertNotSoftDeleted('clients', ['id' => $referred->id]);
        $this->assertNull($referred->fresh()->referred_by_company_id);
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
}
