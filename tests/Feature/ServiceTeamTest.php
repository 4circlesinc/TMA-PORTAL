<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\ServiceTeams;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Account settings > Client hub management > Service teams.
 *
 * The old screen kept its own list of team names in localStorage. This one
 * does not invent a second kind of team — it puts an existing staff group onto
 * a client. So the tests that matter are that the fan-out writes real
 * assignments, that it cannot smuggle a client into staff access, and that
 * nobody is quietly made the client's primary contact.
 */
class ServiceTeamTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Assigning somebody announces it to them; not what these are about.
        Mail::fake();
    }

    private function user(string $type, string $name = 'Someone'): User
    {
        return User::factory()->create([
            'name' => $name,
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function team(User $creator, string $name = 'Tax Advisory'): Group
    {
        return Group::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'group_type' => Group::TYPE_TEAM,
            'created_by' => $creator->id,
        ]);
    }

    private function join(Group $group, User $user): void
    {
        GroupMember::create(['group_id' => $group->id, 'user_id' => $user->id, 'role' => 'member']);
    }

    private function client(string $uid = 'acme-co', string $name = 'Acme Co'): Client
    {
        return Client::create([
            'uid' => $uid,
            'name' => $name,
            'email' => $uid.'@example.test',
            'initial' => strtoupper($name[0]),
            'initial_color' => 'blue',
            'data' => [],
        ]);
    }

    /* ── assigning ───────────────────────────────────────────────────── */

    public function test_assigning_a_team_puts_every_member_on_the_client(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $bob = $this->user(Role::EMPLOYEE, 'Bob');
        $this->join($team, $alice);
        $this->join($team, $bob);
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'role' => 'account_manager',
            'level' => 'editor',
        ])->assertOk()->assertJsonCount(2, 'assigned');

        // Real ClientAssignment rows — the only thing FileAccess reads.
        foreach ([$alice, $bob] as $member) {
            $this->assertDatabaseHas('client_assignments', [
                'client_id' => $client->id,
                'user_id' => $member->id,
                'role' => 'account_manager',
                'permission_level' => 'editor',
                'status' => ClientAssignment::STATUS_ACTIVE,
            ]);
        }
    }

    public function test_a_team_assignment_never_makes_anyone_the_primary_contact(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $this->join($team, $this->user(Role::EMPLOYEE, 'Alice'));
        $this->join($team, $this->user(Role::EMPLOYEE, 'Bob'));
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'level' => 'view_files',
        ])->assertOk();

        // Primary is one named person. A bulk action has no way to know which,
        // and would otherwise leave whoever happened to be last holding it.
        $this->assertSame(0, ClientAssignment::where('client_id', $client->id)->where('is_primary', true)->count());
    }

    public function test_a_client_in_a_staff_group_is_never_assigned(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $intruder = $this->user(Role::CLIENT, 'Carol');
        $this->join($team, $alice);
        $this->join($team, $intruder);
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'level' => 'editor',
        ])->assertOk()
            ->assertJsonCount(1, 'assigned')
            ->assertJsonPath('skipped', 1);

        // Only staff can be assigned to a client, and a bulk action is exactly
        // where that rule would otherwise be easiest to slip past.
        $this->assertDatabaseMissing('client_assignments', ['user_id' => $intruder->id]);
    }

    public function test_assigning_a_team_twice_does_not_duplicate_assignments(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $this->join($team, $alice);
        $client = $this->client();

        $url = '/admin/service-teams/'.$team->uuid.'/assign';
        $body = ['client' => $client->uid, 'level' => 'editor'];

        $this->actingAs($admin)->postJson($url, $body)->assertOk();
        $this->actingAs($admin)->postJson($url, $body)->assertOk();

        $this->assertSame(1, ClientAssignment::where('client_id', $client->id)->where('user_id', $alice->id)->count());
    }

    public function test_an_empty_team_cannot_be_assigned(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'level' => 'editor',
        ])->assertStatus(422);
    }

    /* ── removing ────────────────────────────────────────────────────── */

    public function test_removing_a_team_ends_the_assignments_rather_than_deleting_them(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $this->join($team, $alice);
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'level' => 'editor',
        ])->assertOk();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/unassign', [
            'client' => $client->uid,
        ])->assertOk()->assertJsonCount(1, 'removed');

        // Ended, not deleted — the history of who worked on this client stays.
        $assignment = ClientAssignment::where('client_id', $client->id)->where('user_id', $alice->id)->first();
        $this->assertNotNull($assignment);
        $this->assertSame(ClientAssignment::STATUS_ENDED, $assignment->status);
        $this->assertFalse($assignment->isLive());
    }

    public function test_removing_a_team_from_a_client_it_is_not_on_is_harmless(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $this->join($team, $this->user(Role::EMPLOYEE, 'Alice'));
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/unassign', [
            'client' => $client->uid,
        ])->assertOk()->assertJsonPath('removed', []);
    }

    /* ── membership is not retroactive ───────────────────────────────── */

    public function test_joining_a_team_later_does_not_backfill_the_client_assignment(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $this->join($team, $alice);
        $client = $this->client();

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $client->uid,
            'level' => 'editor',
        ])->assertOk();

        // Added to the department afterwards.
        $newJoiner = $this->user(Role::EMPLOYEE, 'Dan');
        $this->join($team, $newJoiner);

        // An assignment is a decision about a client. Handing a new joiner a
        // client's files because somebody added them to a group is exactly the
        // accident this must not enable.
        $this->assertDatabaseMissing('client_assignments', ['user_id' => $newJoiner->id]);
    }

    /* ── who may do it ───────────────────────────────────────────────── */

    public function test_only_administrators_can_assign_a_service_team(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $this->join($team, $this->user(Role::EMPLOYEE, 'Alice'));
        $client = $this->client();

        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $type) {
            $this->actingAs($this->user($type))
                ->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
                    'client' => $client->uid,
                    'level' => 'editor',
                ])->assertForbidden();
        }

        $this->assertSame(0, ClientAssignment::where('client_id', $client->id)->count());
    }

    /* ── what the screen is told ─────────────────────────────────────── */

    public function test_the_screen_counts_staff_and_the_clients_the_whole_team_is_on(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $alice = $this->user(Role::EMPLOYEE, 'Alice');
        $bob = $this->user(Role::EMPLOYEE, 'Bob');
        $this->join($team, $alice);
        $this->join($team, $bob);

        $both = $this->client('both-co', 'Both Co');
        $onlyAlice = $this->client('half-co', 'Half Co');

        $this->actingAs($admin)->postJson('/admin/service-teams/'.$team->uuid.'/assign', [
            'client' => $both->uid,
            'level' => 'editor',
        ])->assertOk();

        // Alice alone, not as part of the team.
        ClientAssignment::create([
            'client_id' => $onlyAlice->id,
            'user_id' => $alice->id,
            'role' => 'general',
            'permission_level' => 'view_files',
            'status' => ClientAssignment::STATUS_ACTIVE,
            'assigned_by' => $admin->id,
        ]);

        $teams = $this->actingAs($admin)->getJson('/admin/service-teams')->assertOk()->json('teams');

        $this->assertSame(2, $teams[0]['memberCount']);
        // "Which clients is this team on", not "has anyone from this team ever
        // touched this client" — so Half Co does not count.
        $this->assertSame(1, $teams[0]['clientCount']);
    }

    public function test_staff_in_counts_only_staff(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'Ada');
        $team = $this->team($admin);
        $this->join($team, $this->user(Role::EMPLOYEE, 'Alice'));
        $this->join($team, $this->user(Role::CLIENT, 'Carol'));

        $this->assertSame(1, ServiceTeams::staffIn($team)->count());
    }
}
