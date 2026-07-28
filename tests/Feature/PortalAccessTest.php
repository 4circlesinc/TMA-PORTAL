<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * What each account type can actually reach.
 *
 * Before App\Support\Access\Role the portal served every page shell to every
 * approved account and let the API refuse afterwards, and messaging offered
 * the whole user directory to everyone — a client could find and message
 * another client. These lock both down.
 */
class PortalAccessTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $accountType, array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $accountType,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    /* ── the capability matrix ───────────────────────────────────────── */

    public function test_an_administrator_holds_every_capability(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        foreach (Role::capabilityNames() as $capability) {
            $this->assertTrue(Role::can($admin, $capability), $capability.' should be open to administrators');
        }
    }

    public function test_a_client_holds_none_of_the_staff_capabilities(): void
    {
        $client = $this->user(Role::CLIENT);

        foreach (Role::capabilityNames() as $capability) {
            $this->assertFalse(Role::can($client, $capability), $capability.' should be closed to clients');
        }
    }

    public function test_an_employee_runs_the_practice_but_does_not_administer_it(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        $this->assertTrue(Role::can($employee, 'clients.view'));
        $this->assertTrue(Role::can($employee, 'mail.use'));
        $this->assertTrue(Role::can($employee, 'signatures.create'));

        $this->assertFalse(Role::can($employee, 'users.manage'));
        $this->assertFalse(Role::can($employee, 'clients.assign'));
        $this->assertFalse(Role::can($employee, 'settings.security'));
        $this->assertFalse(Role::can($employee, 'recyclebin.admin'));
    }

    public function test_an_unknown_capability_is_denied_rather_than_assumed(): void
    {
        // A typo must fail closed. Administrators are the deliberate exception:
        // they hold everything by definition.
        $this->assertFalse(Role::can($this->user(Role::EMPLOYEE), 'clients.veiw'));
    }

    /* ── page shells ─────────────────────────────────────────────────── */

    public function test_a_client_cannot_load_the_staff_page_shells(): void
    {
        $client = $this->user(Role::CLIENT);

        foreach (['clients', 'users', 'email', 'overview', 'social/feed'] as $page) {
            $this->actingAs($client)->get('/'.$page)->assertNotFound();
        }
    }

    public function test_a_client_still_reaches_their_own_pages(): void
    {
        $client = $this->user(Role::CLIENT);

        foreach (['calendar', 'signatures', 'social/messages', 'account-settings'] as $page) {
            $this->actingAs($client)->get('/'.$page)->assertOk();
        }
    }

    public function test_staff_still_reach_the_staff_pages(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        foreach (['clients', 'users', 'email', 'overview'] as $page) {
            $this->actingAs($employee)->get('/'.$page)->assertOk();
        }
    }

    /* ── the mailbox ─────────────────────────────────────────────────── */

    public function test_a_client_has_no_mailbox(): void
    {
        $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/portal/mail')
            ->assertForbidden();
    }

    /* ── messaging reach ─────────────────────────────────────────────── */

    public function test_a_client_cannot_discover_another_client(): void
    {
        $me = $this->user(Role::CLIENT, ['name' => 'Ana Client', 'email' => 'ana@acme.test']);
        $other = $this->user(Role::CLIENT, ['name' => 'Ben Rival', 'email' => 'ben@rival.test']);

        $contacts = $this->actingAs($me)
            ->getJson('/portal/messaging/contacts')
            ->assertOk()
            ->json('contacts');

        $this->assertNotContains($other->id, array_column($contacts, 'id'));
    }

    public function test_a_client_reaches_the_staff_assigned_to_them(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE, ['name' => 'Assigned Employee']);
        $stranger = $this->user(Role::EMPLOYEE, ['name' => 'Unassigned Employee']);
        $me = $this->user(Role::CLIENT, ['email' => 'ana@acme.test']);

        $client = Client::create([
            'uid' => 'acme',
            'name' => 'Acme Corp',
            'email' => 'ana@acme.test',
            'user_id' => $me->id,
            'data' => [],
            'created_by' => $admin->id,
        ]);

        ClientAssignment::create([
            'client_id' => $client->id,
            'user_id' => $employee->id,
            'permission_level' => 'editor',
            'assigned_by' => $admin->id,
        ]);

        $ids = array_column(
            $this->actingAs($me)->getJson('/portal/messaging/contacts')->assertOk()->json('contacts'),
            'id'
        );

        $this->assertContains($employee->id, $ids, 'their assigned employee should be reachable');
        $this->assertContains($admin->id, $ids, 'administrators are always reachable');
        $this->assertNotContains($stranger->id, $ids, 'an unassigned employee should not be');
    }

    public function test_a_client_cannot_open_a_thread_by_posting_a_user_id(): void
    {
        // The contact list is filtered, so the only way through is to guess an
        // id — this is the check that makes the filtering more than cosmetic.
        $me = $this->user(Role::CLIENT, ['email' => 'ana@acme.test']);
        $other = $this->user(Role::CLIENT, ['email' => 'ben@rival.test']);

        $this->actingAs($me)
            ->postJson('/portal/messaging/conversations', ['userId' => $other->id])
            ->assertForbidden();
    }

    public function test_staff_keep_the_whole_directory(): void
    {
        $me = $this->user(Role::EMPLOYEE);
        $colleague = $this->user(Role::EMPLOYEE);
        $client = $this->user(Role::CLIENT);

        $ids = array_column(
            $this->actingAs($me)->getJson('/portal/messaging/contacts')->assertOk()->json('contacts'),
            'id'
        );

        $this->assertContains($colleague->id, $ids);
        $this->assertContains($client->id, $ids);
    }

    /* ── what the browser is told ────────────────────────────────────── */

    public function test_me_reports_the_capabilities_the_shell_gates_on(): void
    {
        $payload = $this->actingAs($this->user(Role::CLIENT))
            ->getJson('/me')
            ->assertOk()
            ->json();

        $this->assertFalse($payload['isStaff']);
        $this->assertSame([], $payload['capabilities']);
    }
}
