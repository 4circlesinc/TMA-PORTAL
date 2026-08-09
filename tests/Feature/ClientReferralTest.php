<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Company;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Who referred a client, and what the client is.
 *
 * The referral has three answers the directory has to tell apart — a company,
 * "Private", and nothing recorded — and the pair of columns behind them can
 * disagree, so these tests pin the rule that settles them.
 */
class ClientReferralTest extends TestCase
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

    private function company(User $staff, string $name): Company
    {
        return Company::create([
            'uid' => str($name)->slug()->value(),
            'name' => $name,
            'created_by' => $staff->id,
        ]);
    }

    /** @return array<string, mixed> */
    private function payload(string $uid, string $name, array $overrides = []): array
    {
        return array_merge([
            'uid' => $uid,
            'name' => $name,
            'profile' => ['firstName' => explode(' ', $name)[0]],
        ], $overrides);
    }

    public function test_a_company_referral_is_stored_and_named(): void
    {
        $staff = $this->staff();
        $this->company($staff, 'Galaxy');

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('john-smith', 'John Smith', [
                'referralType' => 'company',
                'referredByCompanyId' => 'galaxy',
            ]))
            ->assertOk()
            ->assertJsonPath('client.referralType', 'company')
            ->assertJsonPath('client.referredByCompanyId', 'galaxy')
            ->assertJsonPath('client.referredByLabel', 'Galaxy')
            // Being referred by a company does not make the applicant one.
            ->assertJsonPath('client.clientType', 'private')
            ->assertJsonPath('client.clientTypeLabel', 'Private');
    }

    public function test_private_and_not_recorded_are_different_answers(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('david-james', 'David James', [
                'referralType' => 'private',
            ]))
            ->assertOk()
            ->assertJsonPath('client.referralType', 'private')
            ->assertJsonPath('client.referredByLabel', 'Private');

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('sarah-charles', 'Sarah Charles'))
            ->assertOk()
            ->assertJsonPath('client.referralType', 'none')
            ->assertJsonPath('client.referredByLabel', null);
    }

    public function test_a_referral_that_names_no_real_company_is_not_recorded(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('ghost', 'Ghost Ref', [
                'referralType' => 'company',
                'referredByCompanyId' => 'no-such-company',
            ]))
            ->assertOk()
            // Rather than a row claiming a referral it cannot name.
            ->assertJsonPath('client.referralType', 'none')
            ->assertJsonPath('client.referredByCompanyId', null);
    }

    public function test_a_referral_does_not_make_the_client_a_member_of_the_referrer(): void
    {
        $staff = $this->staff();
        $galaxy = $this->company($staff, 'Galaxy');

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload('john-smith', 'John Smith', [
            'referralType' => 'company',
            'referredByCompanyId' => 'galaxy',
        ]))->assertOk();

        $client = Client::where('uid', 'john-smith')->firstOrFail();
        $this->assertNull($client->company_id, 'a referral must not attach the client to the company');
        $this->assertSame(0, $galaxy->clients()->count(), 'the referrer gains no people');
        $this->assertSame(1, $galaxy->referredClients()->count());
        $this->assertSame(1, $galaxy->fresh()->toRecord()['referredCount']);
    }

    public function test_a_client_can_be_typed_as_a_company_in_its_own_right(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('acme-holdings', 'Acme Holdings', [
                'clientType' => 'company',
            ]))
            ->assertOk()
            ->assertJsonPath('client.clientType', 'company')
            ->assertJsonPath('client.clientTypeLabel', 'Company');

        $this->actingAs($staff)
            ->postJson('/portal/clients', $this->payload('bad-type', 'Bad Type', [
                'clientType' => 'partnership',
            ]))
            ->assertStatus(422);
    }

    public function test_editing_can_change_and_clear_a_referral(): void
    {
        $staff = $this->staff();
        $this->company($staff, 'Galaxy');
        $this->company($staff, 'Blue Media');

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload('mary-brown', 'Mary Brown', [
            'referralType' => 'company',
            'referredByCompanyId' => 'galaxy',
        ]))->assertOk();

        $this->actingAs($staff)
            ->patchJson('/portal/clients/mary-brown', $this->payload('mary-brown', 'Mary Brown', [
                'referralType' => 'company',
                'referredByCompanyId' => 'blue-media',
            ]))
            ->assertOk()
            ->assertJsonPath('client.referredByLabel', 'Blue Media');

        $this->actingAs($staff)
            ->patchJson('/portal/clients/mary-brown', $this->payload('mary-brown', 'Mary Brown', [
                'referralType' => 'none',
            ]))
            ->assertOk()
            ->assertJsonPath('client.referralType', 'none')
            ->assertJsonPath('client.referredByCompanyId', null);
    }

    public function test_deleting_a_referrer_leaves_its_referrals_unrecorded_rather_than_dangling(): void
    {
        $staff = $this->staff();
        $this->company($staff, 'Galaxy');

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload('john-smith', 'John Smith', [
            'referralType' => 'company',
            'referredByCompanyId' => 'galaxy',
        ]))->assertOk();

        $this->actingAs($staff)->deleteJson('/portal/companies/galaxy')->assertOk();

        $client = Client::where('uid', 'john-smith')->firstOrFail();
        $this->assertSame(Client::REFERRAL_NONE, $client->referral_type);
        $this->assertNull($client->referred_by_company_id);
        $this->assertNull($client->toRecord()['referredByLabel']);
    }
}
