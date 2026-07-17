<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ClientsTest extends TestCase
{
    use RefreshDatabase;

    private function staff(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    /** @return array<string, mixed> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'uid' => 'bruce-wayne',
            'name' => 'Bruce Wayne',
            'initial' => 'B',
            'initialColor' => 'blue',
            'profile' => [
                'firstName' => 'Bruce',
                'lastName' => 'Wayne',
                'work' => ['jobTitle' => 'Executive', 'department' => 'Leadership', 'company' => 'Wayne Enterprises'],
                'emails' => [['type' => 'work', 'value' => 'bruce@wayneent.com']],
                'phones' => [['type' => 'office', 'value' => '+1 555 0199']],
                'addresses' => [],
                'importantDates' => [],
            ],
        ], $overrides);
    }

    public function test_staff_can_create_a_client_and_it_appears_in_the_directory(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())
            ->assertOk()
            ->assertJsonPath('client.id', 'bruce-wayne')
            ->assertJsonPath('client.name', 'Bruce Wayne')
            ->assertJsonPath('client.profile.work.company', 'Wayne Enterprises');

        // Searchable columns are extracted from the profile blob.
        $this->assertDatabaseHas('clients', [
            'uid' => 'bruce-wayne',
            'name' => 'Bruce Wayne',
            'company' => 'Wayne Enterprises',
            'email' => 'bruce@wayneent.com',
            'phone' => '+1 555 0199',
            'created_by' => $staff->id,
        ]);

        $this->actingAs($staff)->getJson('/portal/clients')
            ->assertOk()
            ->assertJsonCount(1, 'clients')
            ->assertJsonPath('clients.0.id', 'bruce-wayne');
    }

    public function test_name_falls_back_to_profile_when_not_supplied(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload([
            'name' => null,
            'profile' => ['firstName' => 'Ada', 'lastName' => 'Lovelace'],
        ]))->assertOk()->assertJsonPath('client.name', 'Ada Lovelace');
    }

    public function test_a_colliding_uid_is_made_unique(): void
    {
        $staff = $this->staff();

        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();
        $second = $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->assertSame('bruce-wayne-2', $second->json('client.id'));
        $this->assertSame(2, Client::count());
    }

    public function test_staff_can_update_a_client(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->actingAs($staff)->patchJson('/portal/clients/bruce-wayne', $this->payload([
            'name' => 'Bruce T. Wayne',
            'profile' => [
                'firstName' => 'Bruce',
                'middleName' => 'Thomas',
                'lastName' => 'Wayne',
                'work' => ['company' => 'Wayne Foundation'],
                'emails' => [['type' => 'work', 'value' => 'bruce@waynefoundation.org']],
                'phones' => [],
            ],
        ]))->assertOk()->assertJsonPath('client.name', 'Bruce T. Wayne');

        $this->assertDatabaseHas('clients', [
            'uid' => 'bruce-wayne',
            'name' => 'Bruce T. Wayne',
            'company' => 'Wayne Foundation',
            'email' => 'bruce@waynefoundation.org',
        ]);
    }

    public function test_destroy_soft_deletes_and_drops_from_the_directory(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->actingAs($staff)->deleteJson('/portal/clients/bruce-wayne')->assertOk();

        $this->assertSoftDeleted('clients', ['uid' => 'bruce-wayne']);
        $this->actingAs($staff)->getJson('/portal/clients')->assertOk()->assertJsonCount(0, 'clients');
    }

    public function test_bulk_delete_removes_many(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'a-one', 'name' => 'Alice One']))->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'b-two', 'name' => 'Bob Two']))->assertOk();

        $this->actingAs($staff)->postJson('/portal/clients/bulk-delete', ['uids' => ['a-one', 'b-two']])
            ->assertOk()
            ->assertJsonPath('deleted', 2);

        $this->actingAs($staff)->getJson('/portal/clients')->assertOk()->assertJsonCount(0, 'clients');
    }

    public function test_duplicate_creates_a_copy_with_a_new_uid(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->actingAs($staff)->postJson('/portal/clients/bruce-wayne/duplicate')
            ->assertOk()
            ->assertJsonPath('client.id', 'bruce-wayne-copy')
            ->assertJsonPath('client.name', 'Bruce Wayne (copy)')
            ->assertJsonPath('client.profile.work.company', 'Wayne Enterprises');

        $this->assertSame(2, Client::count());
    }

    public function test_client_accounts_cannot_reach_the_directory(): void
    {
        $client = $this->staff(['account_type' => 'Client']);

        $this->actingAs($client)->getJson('/portal/clients')->assertForbidden();
        $this->actingAs($client)->postJson('/portal/clients', $this->payload())->assertForbidden();
    }

    public function test_employees_can_manage_the_directory(): void
    {
        $employee = $this->staff(['account_type' => 'Employee']);

        $this->actingAs($employee)->postJson('/portal/clients', $this->payload())->assertOk();
        $this->actingAs($employee)->getJson('/portal/clients')->assertOk()->assertJsonCount(1, 'clients');
    }
}
