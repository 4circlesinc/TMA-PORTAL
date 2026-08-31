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

    public function test_non_admin_staff_can_create_a_client_and_are_its_first_assignee(): void
    {
        /*
         * This reverses the rule this test used to assert.
         *
         * Non-admin staff are scoped to their live assignments, and creating a
         * client previously left them unable to see it until an administrator
         * assigned them — which meant a staff member could add a client and
         * immediately lose it. The 2026-08-09 brief makes the creator the
         * default assignee instead, so the act of creating is itself the
         * assignment.
         *
         * Administrators are deliberately *not* assigned: they already reach
         * every client, so a row would grant nothing. See ClientScopeTest for
         * the scoping this relies on.
         */
        $officer = $this->staff(['account_type' => 'Reviewing Officer']);

        $this->actingAs($officer)->postJson('/portal/clients', $this->payload())->assertOk();
        $this->actingAs($officer)->getJson('/portal/clients')->assertOk()->assertJsonCount(1, 'clients');

        $this->assertTrue(
            \App\Models\ClientAssignment::live()
                ->where('client_id', \App\Models\Client::firstOrFail()->id)
                ->where('user_id', $officer->id)
                ->exists()
        );

        $admin = $this->staff(['account_type' => 'Administrator']);
        $this->actingAs($admin)->postJson('/portal/clients', $this->payload(['uid' => 'clark-kent']))->assertOk();

        $this->assertFalse(
            \App\Models\ClientAssignment::live()
                ->where('client_id', \App\Models\Client::where('uid', 'clark-kent')->firstOrFail()->id)
                ->where('user_id', $admin->id)
                ->exists(),
            'An administrator reaches every client already; an assignment row would say otherwise.'
        );
    }

    /*
     * The listing used to hand back every client's full profile. With eleven
     * thousand of them that was 9.6 MB of JSON and a 127 MB memory peak per
     * request, which is what was exhausting the container — so the shape of
     * this response is load-bearing, not a detail.
     */
    public function test_the_directory_listing_carries_no_profile_blob(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $listed = $this->actingAs($staff)->getJson('/portal/clients')
            ->assertOk()
            ->assertJsonPath('clients.0.id', 'bruce-wayne')
            // The Contact column still has something to draw: it comes from the
            // denormalised column rather than the blob.
            ->assertJsonPath('clients.0.contact', 'bruce@wayneent.com')
            ->assertJsonPath('clients.0.clientTypeLabel', 'Private')
            ->json('clients.0');

        $this->assertArrayNotHasKey('profile', $listed);
    }

    public function test_one_client_still_answers_with_its_full_profile(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        // This is where the detail view gets what the listing no longer sends.
        $this->actingAs($staff)->getJson('/portal/clients/bruce-wayne')
            ->assertOk()
            ->assertJsonPath('client.profile.work.jobTitle', 'Executive')
            ->assertJsonPath('client.profile.emails.0.value', 'bruce@wayneent.com');
    }

    public function test_search_matches_fields_that_live_inside_the_profile(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload([
            'uid' => 'clark-kent',
            'name' => 'Clark Kent',
            'profile' => ['firstName' => 'Clark', 'lastName' => 'Kent'],
        ]))->assertOk();

        // "Executive" appears in no column — only in the blob the browser no
        // longer holds, which is the whole reason this endpoint exists.
        $this->actingAs($staff)->getJson('/portal/clients/search?q=Executive')
            ->assertOk()
            ->assertJsonCount(1, 'ids')
            ->assertJsonPath('ids.0', 'bruce-wayne');

        $this->actingAs($staff)->getJson('/portal/clients/search?q=kent')
            ->assertOk()
            ->assertJsonCount(1, 'ids')
            ->assertJsonPath('ids.0', 'clark-kent');
    }

    public function test_search_ignores_a_term_too_short_to_narrow_anything(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->actingAs($staff)->getJson('/portal/clients/search?q=b')
            ->assertOk()
            ->assertJsonCount(0, 'ids');
    }

    public function test_search_only_reaches_clients_the_account_may_see(): void
    {
        $admin = $this->staff();
        $this->actingAs($admin)->postJson('/portal/clients', $this->payload())->assertOk();

        // A staff member with no assignment sees no clients (see
        // ClientScopeTest); search must not become the way around that.
        $officer = $this->staff(['account_type' => 'Reviewing Officer']);
        $this->actingAs($officer)->getJson('/portal/clients/search?q=Executive')
            ->assertOk()
            ->assertJsonCount(0, 'ids');

        $client = $this->staff(['account_type' => 'Client']);
        $this->actingAs($client)->getJson('/portal/clients/search?q=Executive')->assertForbidden();
    }

    public function test_search_treats_wildcards_as_literal_characters(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        // Unescaped, '%' would match every client in the firm.
        $this->actingAs($staff)->getJson('/portal/clients/search?q=%25')
            ->assertOk()
            ->assertJsonCount(0, 'ids');
    }

    public function test_preview_returns_a_capped_directory_slice(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'a-one', 'name' => 'Alice']))->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'b-two', 'name' => 'Bob']))->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'c-three', 'name' => 'Carol']))->assertOk();

        $this->actingAs($staff)->getJson('/portal/clients/preview?limit=2')
            ->assertOk()
            ->assertJsonCount(2, 'clients')
            ->assertJsonPath('clients.0.id', 'a-one')
            ->assertJsonMissingPath('clients.0.profile');
    }

    public function test_preview_sort_latest_returns_newest_clients_first(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'a-one', 'name' => 'Alice']))->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'b-two', 'name' => 'Bob']))->assertOk();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload(['uid' => 'c-three', 'name' => 'Carol']))->assertOk();

        $this->actingAs($staff)->getJson('/portal/clients/preview?limit=2&sort=latest')
            ->assertOk()
            ->assertJsonCount(2, 'clients')
            ->assertJsonPath('clients.0.id', 'c-three')
            ->assertJsonPath('clients.1.id', 'b-two');
    }

    public function test_search_with_limit_returns_lean_records_not_the_full_id_list(): void
    {
        $staff = $this->staff();
        $this->actingAs($staff)->postJson('/portal/clients', $this->payload())->assertOk();

        $this->actingAs($staff)->getJson('/portal/clients/search?q=Wayne&limit=12')
            ->assertOk()
            ->assertJsonCount(1, 'clients')
            ->assertJsonPath('clients.0.id', 'bruce-wayne')
            ->assertJsonMissingPath('ids')
            ->assertJsonMissingPath('clients.0.profile');
    }
}
