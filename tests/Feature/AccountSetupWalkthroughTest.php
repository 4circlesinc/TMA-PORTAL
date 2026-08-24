<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Onboarding\AccountSetupFlow;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AccountSetupWalkthroughTest extends TestCase
{
    use RefreshDatabase;

    private function staffMidSetup(array $prefs = []): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => null,
            'preferences' => array_merge([
                'accountsSetupComplete' => true,
                'accountSetupStep' => 'preferences',
            ], $prefs),
        ]);
    }

    public function test_getting_started_uses_the_same_complete_counter_as_later_screens(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => null,
        ]);

        $total = AccountSetupFlow::position(AccountSetupFlow::ACCOUNTS, $user)['total'];

        $this->actingAs($user)
            ->get(route('getting-started'))
            ->assertOk()
            ->assertSee("1 of {$total}", false)
            ->assertSee('complete')
            ->assertDontSee('Step 1')
            ->assertSee('Set up your account');
    }

    public function test_each_setup_screen_shows_its_place_in_the_full_walkthrough(): void
    {
        $user = $this->staffMidSetup();
        $total = AccountSetupFlow::position('preferences', $user)['total'];

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'preferences']))
            ->assertOk()
            ->assertSee("2 of {$total}", false)
            ->assertDontSee('Step 2')
            ->assertSee('Your preferences');

        $this->actingAs($user)->post(route('account-setup.store', ['step' => 'preferences']), [
            'themeMode' => 'light',
            'fontScale' => 3,
            'sidebarStyle' => 'hover',
        ])->assertRedirect(route('account-setup.show', ['step' => 'two-factor']));

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'two-factor']))
            ->assertOk()
            ->assertSee("3 of {$total}", false)
            ->assertSee('Two-factor authentication')
            ->assertSee('Microsoft Authenticator')
            ->assertSee('Google Authenticator');

        $this->actingAs($user)
            ->post(route('account-setup.skip', ['step' => 'two-factor']))
            ->assertRedirect(route('account-setup.show', ['step' => 'notifications']));

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'notifications']))
            ->assertOk()
            ->assertSee("4 of {$total}", false)
            ->assertSee('Notifications');
    }

    public function test_a_client_walkthrough_is_preferences_then_two_factor_then_notifications(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => null,
            'preferences' => [
                'accountsSetupComplete' => true,
                'accountSetupStep' => 'preferences',
            ],
        ]);

        $this->assertSame(3, AccountSetupFlow::position('preferences', $user)['total']);

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'preferences']))
            ->assertOk()
            ->assertSee('1 of 3', false);

        $this->actingAs($user)->post(route('account-setup.store', ['step' => 'preferences']), [
            'themeMode' => 'light',
            'fontScale' => 3,
            'sidebarStyle' => 'hover',
        ]);

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'two-factor']))
            ->assertOk()
            ->assertSee('2 of 3', false);

        $this->actingAs($user)->post(route('account-setup.skip', ['step' => 'two-factor']));

        $this->actingAs($user)
            ->get(route('account-setup.show', ['step' => 'notifications']))
            ->assertOk()
            ->assertSee('3 of 3', false);
    }
}
