<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Employees see the clients they are assigned to, and no others.
 *
 * `clients.viewAll` sat in the matrix from the start with a comment claiming
 * that moving it to `[]` would scope employees to their assignments. Nothing
 * read the capability, so the row decided nothing and every employee listed
 * every client. These tests exist because the switch looked flipped-able and
 * was not — they fail if the enforcement is ever removed and the comment is
 * left behind again.
 */
class ClientScopeTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $employee;

    private Client $mine;

    private Client $theirs;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = $this->user(Role::ADMINISTRATOR);
        $this->employee = $this->user(Role::REVIEWING_OFFICER);

        $this->mine = $this->client('acme', 'Acme Corp');
        $this->theirs = $this->client('rival', 'Rival Ltd');

        ClientAssignment::create([
            'client_id' => $this->mine->id,
            'user_id' => $this->employee->id,
            'permission_level' => 'editor',
            'assigned_by' => $this->admin->id,
        ]);
    }

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function client(string $uid, string $name): Client
    {
        return Client::create([
            'uid' => $uid,
            'name' => $name,
            'email' => $uid.'@example.test',
            'data' => [],
            'created_by' => $this->admin->id,
        ]);
    }

    public function test_an_employee_lists_only_their_assigned_clients(): void
    {
        $uids = array_column(
            $this->actingAs($this->employee)->getJson('/portal/clients')->assertOk()->json('clients'),
            'id'
        );

        $this->assertSame(['acme'], $uids);
    }

    public function test_an_administrator_still_lists_every_client(): void
    {
        $uids = array_column(
            $this->actingAs($this->admin)->getJson('/portal/clients')->assertOk()->json('clients'),
            'id'
        );

        sort($uids);
        $this->assertSame(['acme', 'rival'], $uids);
    }

    public function test_an_employee_cannot_open_an_unassigned_client_by_guessing_the_uid(): void
    {
        // The list is filtered, so the only way through is the URL — this is
        // the check that makes the filtering more than cosmetic. 404, not 403,
        // so the error does not confirm the record exists.
        $this->actingAs($this->employee)->getJson('/portal/clients/rival')->assertNotFound();
        $this->actingAs($this->employee)->getJson('/portal/clients/acme')->assertOk();
    }

    public function test_an_employee_cannot_edit_or_delete_an_unassigned_client(): void
    {
        $this->actingAs($this->employee)
            ->patchJson('/portal/clients/rival', ['name' => 'Renamed', 'uid' => 'rival'])
            ->assertNotFound();

        $this->actingAs($this->employee)->deleteJson('/portal/clients/rival')->assertNotFound();

        $this->assertDatabaseHas('clients', ['uid' => 'rival', 'deleted_at' => null]);
    }

    public function test_a_bulk_delete_cannot_reach_past_the_assignment(): void
    {
        // The dangerous one: a list of uids posted in one request, where a
        // single unscoped whereIn would delete the lot.
        $this->actingAs($this->employee)
            ->postJson('/portal/clients/bulk-delete', ['uids' => ['acme', 'rival']]);

        $this->assertSoftDeleted('clients', ['uid' => 'acme']);
        $this->assertDatabaseHas('clients', ['uid' => 'rival', 'deleted_at' => null]);
    }

    public function test_an_ended_assignment_stops_counting(): void
    {
        ClientAssignment::where('client_id', $this->mine->id)
            ->update(['ends_at' => now()->subDay()]);

        $uids = array_column(
            $this->actingAs($this->employee)->getJson('/portal/clients')->assertOk()->json('clients'),
            'id'
        );

        $this->assertSame([], $uids);
    }

    public function test_mail_recipient_suggestions_do_not_leak_unassigned_clients(): void
    {
        // Typing into the To: field was a second way to enumerate the list.
        $suggestions = $this->actingAs($this->employee)
            ->getJson('/portal/mail/suggest?q=rival')
            ->assertOk()
            ->json();

        $blob = json_encode($suggestions);
        $this->assertStringNotContainsString('rival@example.test', $blob);
    }
}
