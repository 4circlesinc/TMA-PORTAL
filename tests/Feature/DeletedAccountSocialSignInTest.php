<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as OAuthUser;
use Mockery;
use Tests\TestCase;

/**
 * An account in the Recycle Bin must not be able to let itself back in through
 * Google or Microsoft. Two ways it could: the connected account still points at
 * the surviving row, and the "no user with this email, so register one" branch
 * cannot see the trashed row it would collide with.
 */
class DeletedAccountSocialSignInTest extends TestCase
{
    use RefreshDatabase;

    private function fakeProviderUser(string $email, string $providerId): void
    {
        // The controller type-hints Socialite's concrete Two\User, so build a
        // real one rather than a mock of the contract.
        $oauth = (new OAuthUser)->setRaw(['email_verified' => true])->map([
            'id' => $providerId,
            'name' => 'Selina Kyle',
            'email' => $email,
            'avatar' => null,
        ]);
        $oauth->token = null;
        $oauth->refreshToken = null;
        $oauth->accessTokenResponseBody = ['scope' => ''];

        $driver = Mockery::mock();
        $driver->shouldReceive('user')->andReturn($oauth);
        Socialite::shouldReceive('driver')->with('microsoft')->andReturn($driver);
    }

    private function deletedUser(string $email): User
    {
        $admin = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $victim = User::factory()->create([
            'status' => 'approved', 'account_type' => 'Employee', 'email' => $email,
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $this->actingAs($admin)->deleteJson("/admin/users/{$victim->id}")->assertOk();
        $this->app['auth']->logout();
        $this->flushSession();

        return $victim;
    }

    public function test_a_deleted_account_cannot_sign_back_in_through_its_connected_account(): void
    {
        $victim = $this->deletedUser('selina@firm.test');
        ConnectedAccount::create([
            'user_id' => $victim->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-123',
            'email' => 'selina@firm.test',
            'name' => 'Selina Kyle',
        ]);

        $this->fakeProviderUser('selina@firm.test', 'ms-123');

        $this->get('/auth/social/microsoft/callback')
            ->assertRedirect(route('login'))
            ->assertSessionHas('social_error', 'That account has been removed. Ask an administrator to restore it.');

        $this->assertGuest();
    }

    public function test_a_deleted_account_is_not_silently_registered_again(): void
    {
        $this->deletedUser('bruce@firm.test');

        // No connected account this time: the flow falls through to the branch
        // that would otherwise create a second row on a taken email address.
        $this->fakeProviderUser('bruce@firm.test', 'ms-999');

        $this->get('/auth/social/microsoft/callback')
            ->assertRedirect(route('login'))
            ->assertSessionHas('social_error', 'That account has been removed. Ask an administrator to restore it.');

        $this->assertGuest();
        $this->assertSame(1, User::withTrashed()->where('email', 'bruce@firm.test')->count());
    }
}
