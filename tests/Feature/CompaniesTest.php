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
}
