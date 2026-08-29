<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\ApplicationScope;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
use App\Support\Cip\Engine;
use App\Support\Cip\Status;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The brief's user types, bullet by bullet.
 *
 * Every assertion here quotes a line from "1. User Types" and checks the
 * portal agrees — both that a role CAN do what it is promised, and that it
 * CANNOT do what belongs to somebody else. A capability model drifts one
 * harmless-looking row at a time, and the officer split (who may decide, who
 * may only review) is exactly the kind of thing that goes wrong quietly.
 */
class CipRoleMatrixTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
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

    /* ── Internal: Administrators ───────────────────────────────────── */

    public function test_administrators_hold_every_module_verb(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        // Access all applications · assign applications · manage users ·
        // override permissions · generate reports · system-wide dashboard.
        foreach (['cip.view', 'cip.create', 'cip.review', 'cip.compliance',
            'cip.assign', 'cip.decide', 'cip.configure', 'cip.report'] as $capability) {
            $this->assertTrue(Role::can($admin, $capability), 'admin should hold '.$capability);
        }

        $this->assertTrue(Role::can($admin, 'users.manage'), 'admin should manage users');
    }

    public function test_only_administrators_assign_configure_and_report(): void
    {
        // §10: "The Administrator assigns the file." Configuration and
        // reporting are §26 administrator powers.
        foreach ([Role::REVIEWING_OFFICER, Role::COMPLIANCE_OFFICER, Role::EMPLOYEE, Role::CLIENT] as $type) {
            $user = $this->user($type);
            foreach (['cip.assign', 'cip.configure', 'cip.report'] as $capability) {
                $this->assertFalse(Role::can($user, $capability), $type.' must not hold '.$capability);
            }
            $this->assertFalse(Role::can($user, 'users.manage'), $type.' must not manage users');
        }
    }

    /* ── Internal: CRO / Reviewing officers ─────────────────────────── */

    public function test_officers_hold_the_review_and_compliance_bullets(): void
    {
        $cro = $this->user(Role::REVIEWING_OFFICER);

        // Review applications · assess documents · issue comments · request
        // updates · approve documents — and process submissions / decide.
        $this->assertTrue(Role::can($cro, 'cip.view'), 'a CRO must reach applications');
        $this->assertTrue(Role::can($cro, 'cip.review'));
        $this->assertTrue(Role::can($cro, 'cip.compliance'));
        $this->assertTrue(Role::can($cro, 'cip.decide'));
    }

    public function test_the_reviewer_edges_are_open_to_an_officer_and_shut_to_others(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $cro = $this->user(Role::REVIEWING_OFFICER);
        $employee = $this->user(Role::EMPLOYEE);

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);
        Engine::apply($application->fresh(), Status::REVIEW_APPLICATION, $admin);

        // Approving documents for submission is an officer verb.
        $this->assertTrue(Engine::allows($cro, $application->fresh(), Status::ASSESSMENT_FEEDBACK));
        $this->assertFalse(Engine::allows($employee, $application->fresh(), Status::ASSESSMENT_FEEDBACK));

        $this->expectException(AuthorizationException::class);
        Engine::apply($application->fresh(), Status::ASSESSMENT_FEEDBACK, $employee);
    }

    public function test_officers_may_record_a_decision(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $cro = $this->user(Role::REVIEWING_OFFICER);
        $employee = $this->user(Role::EMPLOYEE);

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $application = Applications::create($provider, $admin);
        $application->forceFill(['status' => Status::BACKGROUND_CHECK])->save();

        // §21 Decision workflow: GRANTED / DENIED — held by the joined officer.
        $this->assertTrue(Engine::allows($cro, $application, Status::GRANTED));
        $this->assertTrue(Engine::allows($cro, $application, Status::DENIED));
        $this->assertFalse(Engine::allows($employee, $application, Status::GRANTED));
        $this->assertFalse(Engine::allows($employee, $application, Status::DENIED));
    }

    /* ── External: Service Providers and Private Clients ────────────── */

    public function test_a_service_provider_contact_reaches_their_firms_applications(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $company = Company::create(['uid' => 'galaxy', 'name' => 'Galaxy']);
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL', 'company_id' => $company->id]);

        $contact = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $contact->id,
            'name' => $contact->name,
            'email' => $contact->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);

        $mine = Applications::create($provider, $staff);
        $other = Applications::create(
            CipProvider::create(['name' => 'Bluemina', 'code' => 'BLU']),
            $staff
        );

        // "View application statuses" — their firm's, and only their firm's.
        $visible = ApplicationScope::query($contact)->pluck('id')->all();
        $this->assertSame([$mine->id], $visible);
        $this->assertNotContains($other->id, $visible);

        // The module must be reachable for them at all — this is the check
        // that the capability matrix alone cannot answer, because external
        // accounts deliberately hold no matrix capability.
        $this->assertTrue(CipAccess::canReach($contact), 'a provider contact must reach CIP');
        $this->assertTrue(CipAccess::canCreate($contact), 'a provider contact must create applications');
    }

    public function test_a_private_client_reaches_only_their_own(): void
    {
        $staff = $this->user(Role::ADMINISTRATOR);
        $provider = CipProvider::create(['name' => 'Private Clients', 'code' => 'PRI']);

        $account = $this->user(Role::CLIENT);
        $client = Client::create(['uid' => 'asem', 'name' => 'Asem', 'user_id' => $account->id, 'data' => []]);

        $mine = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $other = Applications::create($provider, $staff);

        // "Track application status" — their own file only.
        $visible = ApplicationScope::query($account)->pluck('id')->all();
        $this->assertSame([$mine->id], $visible);
        $this->assertNotContains($other->id, $visible);

        $this->assertTrue(CipAccess::canReach($account), 'a private client must reach CIP');
        $this->assertTrue(CipAccess::canCreate($account), 'a private client must create applications');
    }

    public function test_an_unconnected_client_reaches_nothing(): void
    {
        $stranger = $this->user(Role::CLIENT);

        $this->assertFalse(CipAccess::canReach($stranger));
        $this->assertCount(0, ApplicationScope::query($stranger)->get());
    }

    public function test_external_accounts_cannot_drive_lifecycle_moves(): void
    {
        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $owner = $this->user(Role::CLIENT);
        $stranger = $this->user(Role::CLIENT);

        $application = Applications::create($provider, $owner);
        $application->forceFill(['status' => Status::DRAFT])->save();

        $this->assertFalse(CipAccess::canChangeApplicationStatus($owner));
        $this->assertFalse(Engine::allows($owner, $application, Status::NEW));
        $this->assertFalse(Engine::allows($stranger, $application, Status::NEW));
    }

    public function test_externals_never_hold_an_officer_or_admin_verb(): void
    {
        $client = $this->user(Role::CLIENT);

        foreach (['cip.review', 'cip.compliance', 'cip.decide', 'cip.assign',
            'cip.configure', 'cip.report'] as $capability) {
            $this->assertFalse(Role::can($client, $capability), 'a client must not hold '.$capability);
            $this->assertFalse(CipAccess::can($client, $capability));
        }
    }

    /* ── The parked type and the dark switch ────────────────────────── */

    public function test_a_parked_employee_holds_nothing_of_the_module(): void
    {
        $parked = $this->user(Role::EMPLOYEE);

        // They cannot reach the portal at all (role-pending), so anything the
        // module offered them would be a promise it could not keep.
        $this->assertFalse(CipAccess::isOfficer($parked));
        $this->assertFalse(Role::can($parked, 'cip.review'));
        $this->assertFalse(Role::can($parked, 'cip.compliance'));
        $this->assertCount(0, ApplicationScope::query($parked)->get());
    }

    public function test_the_flag_closes_the_module_for_every_role(): void
    {
        config(['services.cip.enabled' => false]);

        foreach ([Role::ADMINISTRATOR, Role::REVIEWING_OFFICER, Role::COMPLIANCE_OFFICER,
            Role::EMPLOYEE, Role::CLIENT] as $type) {
            $user = $this->user($type);
            foreach (['cip.view', 'cip.review', 'cip.compliance', 'cip.decide',
                'cip.assign', 'cip.configure', 'cip.report'] as $capability) {
                $this->assertFalse(Role::can($user, $capability), $type.' should be dark for '.$capability);
            }
            $this->assertFalse(CipAccess::canReach($user), $type.' should not reach a dark module');
        }
    }
}
