<?php

namespace Tests\Feature;

use App\Models\CbiApplication;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * The CBI module is in development and must not exist for anyone but an
 * administrator with the feature flag on. These pin the whole contract:
 * 404 — never 403 — for the flag being off, for non-admin accounts, and for
 * every API endpoint, so nobody can even learn the module is there. There
 * is deliberately no sidebar entry, no SPA page and no Role capability to
 * test; the flag and the admin check are the entire surface.
 */
class CbiAccessTest extends TestCase
{
    use RefreshDatabase;

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

    public function test_everything_404s_when_the_flag_is_off(): void
    {
        config(['services.smartsheet.cbi_enabled' => false]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->get('/dev/cbi')->assertNotFound();
        $this->actingAs($admin)->getJson('/portal/cbi/summary')->assertNotFound();
        $this->actingAs($admin)->getJson('/portal/cbi/applications')->assertNotFound();
    }

    public function test_non_admins_get_404_not_403_with_the_flag_on(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);

        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $type) {
            $user = $this->user($type);
            $this->actingAs($user)->get('/dev/cbi')->assertNotFound();
            $this->actingAs($user)->getJson('/portal/cbi/summary')->assertNotFound();
            $this->actingAs($user)->getJson('/portal/cbi/applications')->assertNotFound();
            $this->actingAs($user)->postJson('/portal/cbi/sync')->assertNotFound();
        }
    }

    public function test_an_admin_with_the_flag_on_gets_the_module(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->get('/dev/cbi')->assertOk();

        $this->actingAs($admin)->getJson('/portal/cbi/summary')
            ->assertOk()
            ->assertJsonStructure(['stages', 'total', 'facets', 'sync']);

        $this->actingAs($admin)->getJson('/portal/cbi/applications')
            ->assertOk()
            ->assertJsonStructure(['items', 'total', 'page', 'lastPage']);
    }

    public function test_applications_filter_by_stage_and_search(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);

        CbiApplication::create([
            'dedupe_key' => 'N:2026001', 'applicant_number' => '2026-001',
            'applicant_name' => 'Amara Okafor', 'stage' => 'tracker', 'status' => 'SUBMITTED',
        ]);
        CbiApplication::create([
            'dedupe_key' => 'N:2026002', 'applicant_number' => '2026-002',
            'applicant_name' => 'Deniz Aydin', 'stage' => 'closed', 'status' => 'CLOSED',
        ]);

        $this->actingAs($admin)->getJson('/portal/cbi/applications?stage=tracker')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('items.0.applicantName', 'Amara Okafor');

        $this->actingAs($admin)->getJson('/portal/cbi/applications?q=deniz')
            ->assertOk()->assertJsonPath('total', 1)
            ->assertJsonPath('items.0.applicantName', 'Deniz Aydin');
    }

    public function test_comments_post_and_land_in_the_activity_trail(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);

        $application = CbiApplication::create([
            'dedupe_key' => 'N:2026003', 'applicant_name' => 'Lina Haddad', 'stage' => 'applications',
        ]);

        $this->actingAs($admin)
            ->postJson('/portal/cbi/applications/'.$application->uuid.'/comments', ['body' => 'First contact made.'])
            ->assertCreated()
            ->assertJsonPath('source', 'portal');

        $this->assertDatabaseHas('cbi_comments', [
            'application_id' => $application->id,
            'user_id' => $admin->id,
            'source' => 'portal',
        ]);
        $this->assertDatabaseHas('cbi_application_events', [
            'application_id' => $application->id,
            'type' => 'comment_added',
            'actor_user_id' => $admin->id,
        ]);
    }

    public function test_applications_list_resolves_assignees_from_a_plain_staff_cache(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->user(Role::ADMINISTRATOR);

        CbiApplication::create([
            'dedupe_key' => 'N:2026004',
            'applicant_name' => 'Amara Okafor',
            'stage' => 'applications',
            'assigned_to' => $admin->name,
            'assigned_to_canonical' => $admin->name,
        ]);

        $first = $this->actingAs($admin)->getJson('/portal/cbi/applications')->assertOk();
        $first->assertJsonPath('items.0.people.0.name', $admin->name);
        $first->assertJsonPath('items.0.people.0.userId', $admin->id);

        $cached = Cache::get('cbi.staff-directory');
        $this->assertIsArray($cached);
        $this->assertIsArray($cached[0] ?? null);
        $this->assertArrayHasKey('name', $cached[0]);
        $this->assertArrayHasKey('photo', $cached[0]);
        $this->assertArrayNotHasKey('password', $cached[0]);

        $this->actingAs($admin)->getJson('/portal/cbi/applications')
            ->assertOk()
            ->assertJsonPath('items.0.people.0.name', $admin->name)
            ->assertJsonPath('items.0.people.0.userId', $admin->id);
    }
}
