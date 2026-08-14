<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invitation;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Clients\ClientHubSettings;
use App\Support\Invitations\Invitations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Account settings > Client hub management > Client hub access.
 *
 * The point of these is that the toggles *bite*: a revoked capability has to
 * take the API, the page and the browser's capability list with it, or the
 * screen is decoration.
 */
class ClientHubSettingsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The settings memoize per request; a test process is one process.
        ClientHubSettings::flush();
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function client(array $o = []): Client
    {
        return Client::create(array_merge([
            'uid' => 'acme-co',
            'name' => 'Acme Co',
            'email' => 'owner@acme.test',
            'initial' => 'A',
            'initial_color' => 'blue',
            'data' => [],
        ], $o));
    }

    /** The payload the screen sends: every managed capability, every time. */
    private function payload(array $employee = [], array $rest = []): array
    {
        return array_merge([
            'employee' => array_merge(Role::baselineEmployeeGrants(), $employee),
            'allowSelfRegistration' => true,
            'inviteExpiryDays' => 7,
        ], $rest);
    }

    private function save(User $as, array $employee = [], array $rest = []): TestResponse
    {
        $response = $this->actingAs($as)->putJson('/admin/client-hub', $this->payload($employee, $rest));

        ClientHubSettings::flush();

        return $response;
    }

    // ------------------------------------------------------------- defaults

    public function test_a_firm_that_never_opens_the_screen_keeps_the_matrix_defaults(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        $this->assertTrue(Role::can($employee, 'clients.view'));
        $this->assertTrue(Role::can($employee, 'clients.manage'));
        $this->assertTrue(Role::can($employee, 'clients.invite'));
        // Assignment-scoped, and assigning staff, stay with administrators.
        $this->assertFalse(Role::can($employee, 'clients.viewAll'));
        $this->assertFalse(Role::can($employee, 'clients.assign'));

        $this->assertTrue(ClientHubSettings::allowsSelfRegistration());
        $this->assertSame(7, ClientHubSettings::inviteExpiryDays());
    }

    public function test_the_screen_reports_the_current_grants_and_who_they_apply_to(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->user(Role::EMPLOYEE);
        $this->client();

        $this->actingAs($admin)->getJson('/admin/client-hub')
            ->assertOk()
            ->assertJsonPath('canEdit', true)
            ->assertJsonPath('capabilities.0.id', 'clients.view')
            ->assertJsonPath('capabilities.0.granted', true)
            ->assertJsonPath('allowSelfRegistration', true)
            ->assertJsonPath('inviteExpiryDays', 7)
            ->assertJsonPath('counts.employees', 1)
            ->assertJsonPath('counts.clients', 1);
    }

    // ---------------------------------------------------------------- access

    public function test_a_client_account_cannot_read_or_write_the_settings(): void
    {
        $client = $this->user(Role::CLIENT);

        $this->actingAs($client)->getJson('/admin/client-hub')->assertForbidden();
        $this->actingAs($client)->putJson('/admin/client-hub', $this->payload())->assertForbidden();
    }

    public function test_an_employee_cannot_read_or_write_the_settings_either(): void
    {
        $employee = $this->user(Role::REVIEWING_OFFICER);

        // `settings.clientHub` is administrators-only, so the section never
        // opens for employee-like staff — shaping the hub is not using it.
        $this->actingAs($employee)->getJson('/admin/client-hub')->assertForbidden();
        $this->actingAs($employee)->putJson('/admin/client-hub', $this->payload())->assertForbidden();
    }

    // -------------------------------------------------------- capabilities

    public function test_revoking_reach_closes_the_hub_api_and_page_for_employees(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::REVIEWING_OFFICER);
        $this->client();

        $this->actingAs($employee)->getJson('/portal/clients')->assertOk();

        $this->save($admin, ['clients.view' => false])->assertOk();

        $this->assertFalse(Role::can($employee->fresh(), 'clients.view'));
        $this->actingAs($employee)->getJson('/portal/clients')->assertForbidden();
        // The page gate 404s rather than 403s — a closed page should not
        // confirm it exists (see LegacyPageController).
        $this->actingAs($employee)->get('/clients')->assertNotFound();

        // The browser is told the same thing, so the sidebar row goes too.
        $capabilities = $this->actingAs($employee)->getJson('/me')->assertOk()->json('capabilities');
        $this->assertNotContains('clients.view', $capabilities);
    }

    public function test_an_administrator_keeps_the_hub_after_revoking_it_from_employees(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin, ['clients.view' => false, 'clients.manage' => false])->assertOk();

        // Administrators short-circuit the matrix, so this screen — and the
        // hub behind it — can always be reached again.
        $this->assertTrue(Role::can($admin->fresh(), 'clients.view'));
        $this->actingAs($admin)->getJson('/admin/client-hub')->assertOk();
        $this->actingAs($admin)->getJson('/portal/clients')->assertOk();
    }

    public function test_granting_view_all_widens_an_employee_from_assignments_to_everything(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::REVIEWING_OFFICER);
        $this->client();
        $this->client(['uid' => 'globex', 'name' => 'Globex', 'email' => 'hi@globex.test']);

        // Scoped to live assignments by default, and this employee has none.
        $this->assertCount(0, $this->actingAs($employee)->getJson('/portal/clients')->json('clients'));

        $this->save($admin, ['clients.viewAll' => true])->assertOk();

        $this->assertCount(2, $this->actingAs($employee)->getJson('/portal/clients')->json('clients'));
    }

    public function test_revoking_manage_leaves_the_hub_readable_but_not_writable(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::REVIEWING_OFFICER);

        $this->save($admin, ['clients.manage' => false])->assertOk();

        $this->actingAs($employee)->getJson('/portal/clients')->assertOk();
        $this->actingAs($employee)->postJson('/portal/clients', [
            'uid' => 'new-co', 'name' => 'New Co', 'initial' => 'N', 'initialColor' => 'blue', 'profile' => [],
        ])->assertForbidden();
    }

    public function test_revoking_invite_stops_an_employee_inviting_a_client(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::REVIEWING_OFFICER);
        $client = $this->client();

        $this->save($admin, ['clients.invite' => false])->assertOk();

        $this->actingAs($employee)->postJson('/portal/clients/'.$client->uid.'/invite')->assertForbidden();
    }

    public function test_a_client_account_never_gains_a_hub_capability_however_it_is_saved(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = $this->user(Role::CLIENT);

        $this->save($admin, ['clients.view' => true, 'clients.viewAll' => true])->assertOk();

        $this->assertFalse(Role::can($client->fresh(), 'clients.view'));
        $this->assertFalse(Role::can($client->fresh(), 'clients.viewAll'));
    }

    public function test_an_unknown_capability_in_the_payload_is_rejected_not_stored(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->putJson('/admin/client-hub', $this->payload([], [
            'employee' => ['users.manage' => true],
        ]))->assertStatus(422);
    }

    // ---------------------------------------------------------- invitations

    public function test_client_invitation_links_use_the_configured_expiry(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin, [], ['inviteExpiryDays' => 30])->assertOk();

        [$invitation] = Invitations::issue([
            'type' => Invitation::TYPE_CLIENT,
            'email' => 'owner@acme.test',
            'role' => Role::CLIENT,
        ]);

        $this->assertSame(30, (int) round(now()->diffInDays($invitation->expires_at, false)));

        // A staff invitation is not the client hub's to govern.
        [$staffInvite] = Invitations::issue([
            'type' => Invitation::TYPE_STAFF,
            'email' => 'new@firm.test',
            'role' => Role::EMPLOYEE,
        ]);

        $this->assertSame(
            Invitations::EXPIRY_DAYS,
            (int) round(now()->diffInDays($staffInvite->expires_at, false)),
        );
    }

    public function test_an_invalid_expiry_is_refused(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->putJson('/admin/client-hub', $this->payload([], ['inviteExpiryDays' => 9999]))
            ->assertStatus(422);
    }

    public function test_closing_self_registration_stops_an_invited_client_creating_an_account(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR);

        [$invitation, $token] = Invitations::issue([
            'type' => Invitation::TYPE_CLIENT,
            'email' => 'owner@acme.test',
            'name' => 'Acme Owner',
            'role' => Role::CLIENT,
        ]);

        // Open by default — the flow behaves as it always did.
        $this->get('/invite/'.$token)->assertOk()->assertSee('Create your account');

        $this->save($admin, [], ['allowSelfRegistration' => false])->assertOk();

        $token = $invitation->issueToken();
        $invitation->save();

        $this->get('/invite/'.$token)->assertOk()->assertSee('finish setting up your account', false);

        // And the POST is refused too — the screen is not the gate.
        $this->post('/invite/'.$token, [
            'password' => 'Sup3rSecret!', 'password_confirmation' => 'Sup3rSecret!', 'terms' => 'on',
        ])->assertRedirect('/invite/'.$token);

        $this->assertDatabaseMissing('users', ['email' => 'owner@acme.test']);
    }

    public function test_a_staff_invitation_still_creates_its_account_when_client_self_registration_is_off(): void
    {
        Mail::fake();
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin, [], ['allowSelfRegistration' => false])->assertOk();

        [, $token] = Invitations::issue([
            'type' => Invitation::TYPE_STAFF,
            'email' => 'new@firm.test',
            'name' => 'New Hire',
            'role' => Role::EMPLOYEE,
        ]);

        $this->get('/invite/'.$token)->assertOk()->assertSee('Create your account');
    }

    // --------------------------------------------------------------- audit

    public function test_a_change_is_written_to_the_activity_trail(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin, ['clients.assign' => true])->assertOk();

        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'client.access-updated']);
    }

    public function test_saving_the_same_values_writes_nothing_to_the_trail(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin)->assertOk();

        $this->assertDatabaseMissing('activity_logs', ['activity_type' => 'client.access-updated']);
    }
}
