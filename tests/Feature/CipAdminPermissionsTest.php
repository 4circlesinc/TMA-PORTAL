<?php

namespace Tests\Feature;

use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Report;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use App\Support\Cip\CipAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * §26 — every administrator verb is reachable from an admin login, and the
 * ones that are administration stay closed to officers.
 *
 * The engines already live on Applications, Users, Reporting and CIP Console.
 * This pins that an administrator can actually open each door, not that each
 * engine's internals still work.
 */
class CipAdminPermissionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email, string $name = 'Someone'): User
    {
        $user = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    public function test_an_administrator_can_open_every_section_26_door(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);
        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);

        $this->actingAs($admin);

        $this->getJson('/portal/cip/applications')->assertOk()
            ->assertJsonPath('applications.0.id', $application->uuid);

        $this->getJson('/portal/cip/dashboard')->assertOk()
            ->assertJsonPath('cip', true)
            ->assertJsonPath('staff', true);

        $this->getJson('/admin/users')->assertOk()
            ->assertJsonPath('canManage', true)
            ->assertJsonPath('accountTypes', ['CRO / Reviewing officer', 'Administrator']);

        $reports = $this->getJson('/admin/reports')->assertOk()->json();
        $this->assertContains(Report::TYPE_CIP, collect($reports['types'])->pluck('value')->all());

        $this->getJson('/admin/client-hub')->assertOk()
            ->assertJsonPath('canEdit', true);

        $this->getJson('/portal/cip/requirements')->assertOk();
        $this->getJson('/portal/cip/letters')->assertOk()->assertJsonPath('canEdit', true);
        $this->getJson('/portal/cip/distribution')->assertOk()->assertJsonPath('canEdit', true);

        $this->getJson('/portal/cip/applications/'.$application->uuid.'/events')->assertOk()
            ->assertJsonPath('events.0.what', 'Ada Admin filed the application');

        $this->getJson('/portal/cip/applications/'.$application->uuid.'/assignments')->assertOk();

        $this->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
            'userId' => $officer->id,
            'role' => CipAccess::REVIEWING_OFFICER,
        ])->assertCreated();

        $this->assertTrue(
            Assignments::live($application->fresh())->contains('user_id', $officer->id),
            'the administrator may assign the file'
        );

        foreach (['cip-admin', 'cip-distribution', 'cip-documents', 'cip-letters', 'clienthub-access'] as $page) {
            $this->assertTrue(Role::canViewSettingsPage($admin, $page), $page.' should be on CIP Console for an administrator');
        }
    }

    public function test_an_officer_cannot_open_the_administrator_doors(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR, 'ada@example.com', 'Ada Admin');
        $officer = $this->user(Role::REVIEWING_OFFICER, 'rita@example.com', 'Rita Reviewer');
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);

        $this->actingAs($officer);

        $this->getJson('/admin/reports')->assertForbidden();
        $this->postJson('/admin/reports', ['type' => Report::TYPE_CIP, 'range' => 'all'])->assertForbidden();
        $this->getJson('/admin/users')->assertForbidden();
        $this->getJson('/admin/client-hub')->assertForbidden();

        $this->patchJson('/portal/cip/distribution', ['extraEmails' => ['unit@example.com']])
            ->assertForbidden();

        $this->postJson('/portal/cip/applications/'.$application->uuid.'/assignments', [
            'userId' => $officer->id,
        ])->assertNotFound();

        $this->assertFalse(Role::canViewSettingsPage($officer, 'cip-admin'));
        $this->assertFalse(Role::canViewSettingsPage($officer, 'cip-distribution'));
        $this->assertFalse(Role::can($officer, 'cip.configure'));
        $this->assertFalse(Role::can($officer, 'cip.report'));
        $this->assertFalse(Role::can($officer, 'cip.assign'));
        $this->assertFalse(Role::can($officer, 'users.manage'));
    }
}
