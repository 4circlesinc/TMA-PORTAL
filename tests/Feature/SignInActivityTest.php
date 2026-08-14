<?php

namespace Tests\Feature;

use App\Models\AuthEvent;
use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The Overview's "Recent sign-ins" feed.
 *
 * Two properties carry the card. It is firm-wide — an employee sees colleagues
 * sign in, not just themselves, which is what separates this from the audit
 * trail's per-viewer scoping. And it is staff-only: a client account has no
 * business knowing when the firm's people signed in, or from where.
 */
class SignInActivityTest extends TestCase
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

    private function event(string $type, ?User $user, string $when = '-1 minute'): AuthEvent
    {
        return AuthEvent::create([
            'user_id' => $user?->id,
            'event' => $type,
            'ip' => '127.0.0.1',
            'user_agent' => 'Mozilla/5.0 (Macintosh) Chrome/120.0',
            'created_at' => now()->parse($when),
        ]);
    }

    public function test_a_staff_member_sees_the_whole_firms_sign_ins(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Rev Officer']);
        $colleague = $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);

        $this->event('login', $colleague);

        $this->actingAs($officer)
            ->getJson('/portal/sign-ins')
            ->assertOk()
            ->assertJsonPath('items.0.description', 'Ada Admin signed in')
            ->assertJsonPath('items.0.status', 'success')
            ->assertJsonPath('items.0.actor.name', 'Ada Admin');
    }

    public function test_a_client_is_refused(): void
    {
        $client = $this->user(Role::CLIENT);
        $this->event('login', $this->user(Role::ADMINISTRATOR));

        $this->actingAs($client)->getJson('/portal/sign-ins')->assertForbidden();
    }

    public function test_it_is_closed_to_guests(): void
    {
        $this->getJson('/portal/sign-ins')->assertUnauthorized();
    }

    /** Failed attempts are the reason this reads auth_events at all. */
    public function test_it_reports_failed_attempts_and_lockouts(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER, ['name' => 'Rev Officer']);
        $known = $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);

        $this->event('login_failed', $known, '-3 minutes');
        $this->event('lockout', null, '-2 minutes');
        // Laravel's Failed event fires for an address matching nobody.
        $this->event('login_failed', null, '-1 minute');

        $response = $this->actingAs($staff)->getJson('/portal/sign-ins')->assertOk();

        $descriptions = array_column($response->json('items'), 'description');
        $this->assertSame([
            'Failed sign-in attempt',
            'An account was locked out after too many attempts',
            'Failed sign-in for Ada Admin',
        ], $descriptions);

        foreach ($response->json('items') as $item) {
            $this->assertSame('failure', $item['status']);
        }

        $this->assertNull($response->json('items.0.actor'));
    }

    public function test_it_leaves_out_sign_outs(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $other = $this->user(Role::ADMINISTRATOR, ['name' => 'Ada Admin']);

        $this->event('logout', $other, '-1 minute');
        $this->event('login', $other, '-2 minutes');

        $items = $this->actingAs($staff)->getJson('/portal/sign-ins')->assertOk()->json('items');

        $this->assertCount(1, $items);
        $this->assertSame('Ada Admin signed in', $items[0]['description']);
    }

    /**
     * IP and device are serialised for administrators only on the audit trail;
     * this feed has a wider audience, so it must not widen that exposure.
     */
    public function test_it_never_hands_out_ip_or_device(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->event('login', $admin);

        $item = $this->actingAs($admin)->getJson('/portal/sign-ins')->assertOk()->json('items.0');

        $this->assertArrayNotHasKey('ip', $item);
        $this->assertArrayNotHasKey('device', $item);
    }

    public function test_it_returns_the_newest_first_and_honours_the_limit(): void
    {
        $staff = $this->user(Role::REVIEWING_OFFICER);
        $one = $this->user(Role::ADMINISTRATOR, ['name' => 'First Person']);
        $two = $this->user(Role::EMPLOYEE, ['name' => 'Second Person']);

        $this->event('login', $one, '-10 minutes');
        $this->event('login', $two, '-1 minute');

        $items = $this->actingAs($staff)
            ->getJson('/portal/sign-ins?limit=1')
            ->assertOk()
            ->json('items');

        $this->assertCount(1, $items);
        $this->assertSame('Second Person signed in', $items[0]['description']);
    }
}
