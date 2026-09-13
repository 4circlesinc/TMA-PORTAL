<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The Fee Calculator (/calculator) is open to every approved account: it is
 * arithmetic on the reader's own inputs, nothing the server holds. This pins
 * that it stays outside the capability gate for every working role, that the
 * shell it gets carries the menu row and the view the module mounts into,
 * and that a guest is still sent to sign in.
 */
class FeeCalculatorPageTest extends TestCase
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

    public function test_every_working_role_reaches_the_calculator(): void
    {
        foreach ([
            Role::CLIENT,
            Role::SERVICE_PROVIDER_ADMIN,
            Role::REVIEWING_OFFICER,
            Role::COMPLIANCE_OFFICER,
            Role::ADMINISTRATOR,
        ] as $accountType) {
            $html = $this->actingAs($this->user($accountType))
                ->get('/calculator')
                ->assertOk('/calculator should be open to '.$accountType)
                ->getContent();

            $this->assertStringContainsString('data-nav="calculator"', $html, $accountType.' should see the menu row');
            $this->assertStringContainsString('data-view="calculator"', $html, $accountType.' should get the view host');
        }
    }

    public function test_the_calculator_is_not_capability_gated(): void
    {
        $this->assertSame([], Role::pageCapabilities('calculator'));
    }

    public function test_a_guest_is_sent_to_sign_in(): void
    {
        $this->get('/calculator')->assertRedirect();
    }
}
