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
        $this->assertTrue(Role::can($employee, 'overview.view'));

        $this->assertFalse(Role::can($employee, 'users.view'));
        $this->assertFalse(Role::can($employee, 'directory.view'));
        $this->assertFalse(Role::can($employee, 'presence.view'));
        $this->assertFalse(Role::can($employee, 'clients.viewAll'));
        $this->assertFalse(Role::can($employee, 'users.manage'));
        $this->assertFalse(Role::can($employee, 'clients.assign'));
        $this->assertFalse(Role::can($employee, 'settings.security'));
        $this->assertFalse(Role::can($employee, 'recyclebin.admin'));
    }

    /* ── the Users page ──────────────────────────────────────────────── */

    public function test_the_users_page_is_administrators_only(): void
    {
        // It is the account-management table: every account's status and
        // sign-in history, with approve / suspend / reset / delete on each
        // row. `users.view` used to be granted to Employee *and* used to gate
        // the People section, so closing one closed the other.
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))->get('/users')->assertNotFound();
        $this->actingAs($this->user(Role::CLIENT))->get('/users')->assertNotFound();
        $this->actingAs($this->user(Role::ADMINISTRATOR))->get('/users')->assertOk();
    }

    public function test_an_employee_cannot_read_the_account_table_through_the_api(): void
    {
        // The page 404s; this is the check that makes it more than cosmetic.
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->getJson('/admin/users')
            ->assertForbidden();

        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->getJson('/admin/users')
            ->assertOk();
    }

    public function test_the_people_directory_is_administrators_only(): void
    {
        // Every screen in the section, including the two that carry a second
        // capability — reopening `clients.view` must not reopen People.
        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $accountType) {
            $user = $this->user($accountType);

            foreach (['people', 'people/employees', 'people/clients',
                'people/prospects', 'people/shared-address-book',
                'people/personal-address-book', 'people/distribution-groups'] as $page) {
                $this->actingAs($user)->get('/'.$page)
                    ->assertNotFound('/'.$page.' should be closed to a '.$accountType);
            }

            $this->actingAs($user)->getJson('/portal/people/employees')->assertForbidden();
            $this->actingAs($user)->getJson('/portal/contacts')->assertForbidden();
        }

        $admin = $this->user(Role::ADMINISTRATOR);
        $this->actingAs($admin)->get('/people')->assertOk();
        $this->actingAs($admin)->getJson('/portal/people/employees')->assertOk();
    }

    public function test_a_page_needing_two_capabilities_needs_both(): void
    {
        // people/clients is ['directory.view', 'clients.view']. An employee
        // holds the second and not the first, which is exactly the case a
        // single-capability map got wrong.
        $this->assertSame(
            ['directory.view', 'clients.view'],
            Role::pageCapabilities('people/clients')
        );

        $employee = $this->user(Role::EMPLOYEE);
        $this->assertTrue(Role::can($employee, 'clients.view'));
        $this->assertFalse(Role::canViewPage($employee, 'people/clients'));
    }

    public function test_an_employee_no_longer_sees_colleague_presence(): void
    {
        // Degrades rather than 403s — the dashboard asks for this on every
        // load, so a hard refusal would surface as a broken widget.
        $this->actingAs($this->user(Role::REVIEWING_OFFICER))
            ->getJson('/portal/dashboard/staff')
            ->assertOk()
            ->assertJsonPath('staff', false)
            ->assertJsonPath('employees', []);
    }

    /* ── the account settings rail ───────────────────────────────────── */

    public function test_the_settings_rail_keeps_the_firms_administration_to_administrators(): void
    {
        // /account-settings is the one settings home, so everybody loads it —
        // but the rail it draws also held the firm's security policy,
        // branding, storage and Advanced Preferences, offered to employees and
        // clients alike because it is one static list.
        $employee = $this->user(Role::EMPLOYEE);
        $client = $this->user(Role::CLIENT);
        $admin = $this->user(Role::ADMINISTRATOR);

        $administration = [
            'background-ops', 'notification-history',
            'branding', 'clienthub-access',
            'service-teams', 'custom-fields', 'security-policy', 'signin-policy',
            'alert-settings', 'storage-usage',
            'permissions', 'default-folders', 'folder-templates',
        ];

        foreach ($administration as $section) {
            $this->assertFalse(Role::canViewSettingsPage($employee, $section), $section.' should be closed to employees');
            $this->assertFalse(Role::canViewSettingsPage($client, $section), $section.' should be closed to clients');
            $this->assertTrue(Role::canViewSettingsPage($admin, $section), $section.' should be open to administrators');
        }
    }

    public function test_everyone_keeps_their_own_settings(): void
    {
        // The point of the rail is still personal settings — gating must not
        // take a client's own password or theme away from them.
        $personal = ['profile', 'theme', 'time', 'notifications', 'privacy',
            'account-security', 'connectors'];

        foreach ([Role::CLIENT, Role::EMPLOYEE] as $accountType) {
            $user = $this->user($accountType);
            foreach ($personal as $section) {
                $this->assertTrue(
                    Role::canViewSettingsPage($user, $section),
                    $section.' should stay open to a '.$accountType
                );
            }
        }
    }

    public function test_every_settings_section_asks_for_a_capability_that_exists(): void
    {
        // A typo here would fail closed for everyone but administrators, who
        // hold every capability — so it would ship looking fine.
        foreach (Role::settingsPageCapabilities() as $section => $capability) {
            $this->assertContains(
                $capability,
                Role::capabilityNames(),
                $section.' asks for an unknown capability: '.$capability
            );
        }
    }

    public function test_the_browser_mirror_of_the_settings_rail_matches_the_server(): void
    {
        // portal-access.js hides what the server would refuse. When the two
        // disagree the portal offers a page it then cannot serve, which is the
        // failure this whole class exists to prevent.
        $js = file_get_contents(public_path('js/portal-access.js'));
        $this->assertIsString($js);

        preg_match('/var SETTINGS_CAPABILITIES = \{(.*?)\n  \};/s', $js, $block);
        $this->assertNotEmpty($block, 'SETTINGS_CAPABILITIES not found in portal-access.js');

        preg_match_all("/'([^']+)':\s*'([^']+)'/", $block[1], $pairs, PREG_SET_ORDER);
        $mirror = [];
        foreach ($pairs as $pair) {
            $mirror[$pair[1]] = $pair[2];
        }

        $this->assertSame(Role::settingsPageCapabilities(), $mirror);
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
        $employee = $this->user(Role::REVIEWING_OFFICER);

        // 'users' is deliberately absent — that is the account-management
        // table, not staff tooling. See the Users page tests above.
        foreach (['clients', 'email', 'social/feed'] as $page) {
            $this->actingAs($employee)->get('/'.$page)->assertOk();
        }
    }

    public function test_the_overview_page_is_staff_but_its_administration_stays_closed(): void
    {
        // The page itself is staff tooling — sign-ins, files, activity. The
        // administration it also carries (the settings-rail Admin Overview
        // panel; the Users and Recycle Bin tabs) is gated by its own
        // capabilities, so opening the page must not have opened those.
        $employee = $this->user(Role::REVIEWING_OFFICER);

        $this->actingAs($employee)->get('/overview')->assertOk();
        $this->actingAs($this->user(Role::CLIENT))->get('/overview')->assertNotFound();
        $this->actingAs($this->user(Role::ADMINISTRATOR))->get('/overview')->assertOk();

        $this->assertTrue(Role::can($employee, 'overview.view'));
        $this->assertFalse(Role::can($employee, 'users.view'));
        $this->assertFalse(Role::can($employee, 'recyclebin.admin'));
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
        $me = $this->user(Role::REVIEWING_OFFICER);
        $colleague = $this->user(Role::REVIEWING_OFFICER);
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
