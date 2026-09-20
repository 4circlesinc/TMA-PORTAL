<?php

namespace Tests\Feature;

use App\Models\CipProvider;
use App\Models\Company;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Assignments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The right sidebar's short list.
 *
 * Narrower than the table on purpose: an officer reads the firm's whole book
 * at /citizenship-applications, but the sidebar is their own work, so everyone
 * but an administrator sees only the files they hold. Fifteen rows is the
 * ceiling for everybody, including an administrator asking for more.
 */
class CipApplicationPreviewTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
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

    private function provider(string $code): CipProvider
    {
        $company = Company::create(['uid' => strtolower($code).'-firm', 'name' => $code.' Firm']);

        return CipProvider::create([
            'name' => $code.' Provider', 'code' => $code, 'company_id' => $company->id,
        ]);
    }

    public function test_an_officer_sees_only_the_applications_they_hold(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $mine = Applications::create($provider, $admin);
        $theirs = Applications::create($provider, $admin);

        $officer = $this->user(Role::REVIEWING_OFFICER);
        $colleague = $this->user(Role::REVIEWING_OFFICER);
        Assignments::assign($mine, $officer, $admin);
        Assignments::assign($theirs, $colleague, $admin);

        $response = $this->actingAs($officer)->getJson('/portal/cip/applications/preview');

        $response->assertOk();
        $this->assertSame(
            [$mine->uuid],
            array_column($response->json('applications'), 'id'),
        );
    }

    public function test_an_administrator_sees_the_whole_book(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        $first = Applications::create($provider, $admin);
        $second = Applications::create($provider, $admin);

        $response = $this->actingAs($admin)->getJson('/portal/cip/applications/preview');

        $response->assertOk();
        $ids = array_column($response->json('applications'), 'id');
        sort($ids);
        $expected = [$first->uuid, $second->uuid];
        sort($expected);
        $this->assertSame($expected, $ids);
    }

    public function test_fifteen_rows_is_the_ceiling_however_many_are_asked_for(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');

        foreach (range(1, 18) as $ignored) {
            Applications::create($provider, $admin);
        }

        $response = $this->actingAs($admin)->getJson('/portal/cip/applications/preview?limit=500');

        $response->assertOk();
        $this->assertCount(15, $response->json('applications'));
    }

    public function test_an_officer_holding_nothing_gets_an_empty_list_not_an_error(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $provider = $this->provider('GAL');
        Applications::create($provider, $admin);

        $officer = $this->user(Role::REVIEWING_OFFICER);

        $response = $this->actingAs($officer)->getJson('/portal/cip/applications/preview');

        $response->assertOk();
        $this->assertSame([], $response->json('applications'));
    }

    /**
     * A parked Employee never gets as far as the controller: the portal holds
     * them on the role-pending screen. Asserted as the redirect it is rather
     * than as a 404, so this test fails loudly if that gate ever moves.
     */
    public function test_an_employee_never_reaches_the_preview(): void
    {
        $employee = $this->user(Role::EMPLOYEE);

        $this->actingAs($employee)
            ->get('/portal/cip/applications/preview')
            ->assertRedirect('/auth/role-pending');
    }

    public function test_the_module_being_off_closes_the_endpoint(): void
    {
        config(['services.cip.enabled' => false]);

        $this->actingAs($this->user(Role::ADMINISTRATOR))
            ->getJson('/portal/cip/applications/preview')
            ->assertNotFound();
    }
}
