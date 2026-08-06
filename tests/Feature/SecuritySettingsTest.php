<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Notification;
use App\Models\User;
use App\Support\Mail\Postcards;
use App\Support\Security\SecurityAlerts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Fortify\Events\RecoveryCodesGenerated;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;
use Tests\TestCase;

/**
 * Account settings → Security: the panels that used to render but do nothing —
 * phone number, the notification switches, per-session sign-out, and setting a
 * first password on an account that only has a social sign-in.
 */
class SecuritySettingsTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attrs = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $attrs));
    }

    // ------------------------------------------------------------ phone number

    public function test_data_includes_the_phone_number_and_alert_switches(): void
    {
        $user = $this->user(['phone' => '+1 555 123 4567']);

        $this->actingAs($user)->getJson('/security-settings/data')
            ->assertOk()
            ->assertJsonPath('phone', '+1 555 123 4567')
            ->assertJsonPath('alerts.new_device', true)
            ->assertJsonPath('alerts.password_changed', true)
            ->assertJsonPath('alerts.monthly_summary', false);
    }

    public function test_a_phone_number_can_be_added_changed_and_removed(): void
    {
        $user = $this->user(['phone' => null]);

        $this->actingAs($user)->putJson('/security-settings/phone', ['phone' => '+1 555 000 1111'])
            ->assertOk()
            ->assertJsonPath('phone', '+1 555 000 1111');
        $this->assertSame('+1 555 000 1111', $user->fresh()->phone);

        $this->actingAs($user)->putJson('/security-settings/phone', ['phone' => '(246) 555 2222'])
            ->assertOk();
        $this->assertSame('(246) 555 2222', $user->fresh()->phone);

        $this->actingAs($user)->deleteJson('/security-settings/phone')->assertOk();
        $this->assertNull($user->fresh()->phone);
    }

    public function test_a_phone_number_that_isnt_one_is_rejected(): void
    {
        $user = $this->user(['phone' => '+1 555 123 4567']);

        $this->actingAs($user)->putJson('/security-settings/phone', ['phone' => 'call me maybe'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('phone');

        // The number already on file survives a rejected edit.
        $this->assertSame('+1 555 123 4567', $user->fresh()->phone);
    }

    /** Adding a number never claims it was verified — there is no SMS gateway. */
    public function test_saving_a_phone_number_leaves_it_unverified(): void
    {
        $user = $this->user(['phone' => null, 'phone_verified_at' => now()]);

        $this->actingAs($user)->putJson('/security-settings/phone', ['phone' => '+1 555 000 1111'])->assertOk();

        $this->assertNull($user->fresh()->phone_verified_at);
    }

    // ------------------------------------------------------- alert preferences

    public function test_alert_switches_persist(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/security-settings/alerts', [
            'password_changed' => false,
            'monthly_summary' => true,
        ])->assertOk()
            ->assertJsonPath('alerts.password_changed', false)
            ->assertJsonPath('alerts.monthly_summary', true)
            // Untouched switches keep their value.
            ->assertJsonPath('alerts.two_factor_changed', true);

        $user->refresh();
        $this->assertFalse(SecurityAlerts::enabled($user, 'password_changed'));
        $this->assertTrue(SecurityAlerts::enabled($user, 'monthly_summary'));
    }

    public function test_the_new_device_alert_cannot_be_switched_off(): void
    {
        $user = $this->user();

        $this->actingAs($user)->putJson('/security-settings/alerts', ['new_device' => false])
            ->assertOk()
            ->assertJsonPath('alerts.new_device', true);

        $this->assertTrue(SecurityAlerts::enabled($user->fresh(), 'new_device'));
    }

    // ------------------------------------------------------------- sessions

    private function seedSession(User $user, string $id, bool $recent = true): void
    {
        DB::table('sessions')->insert([
            'id' => $id,
            'user_id' => $user->id,
            'ip_address' => '203.0.113.9',
            'user_agent' => 'Mozilla/5.0 (Macintosh) Chrome/120',
            'payload' => base64_encode('x'),
            'last_activity' => $recent ? now()->timestamp : now()->subDay()->timestamp,
        ]);
    }

    public function test_sessions_are_listed_by_digest_never_by_their_real_id(): void
    {
        $user = $this->user();
        $this->seedSession($user, 'other-session-id');

        $response = $this->actingAs($user)->getJson('/security-settings/data')->assertOk();

        $body = $response->json();
        $this->assertNotEmpty($body['sessions']);
        $this->assertSame(hash('sha256', 'other-session-id'), $body['sessions'][0]['id']);
        $this->assertStringNotContainsString('other-session-id', $response->getContent());
    }

    public function test_one_other_session_can_be_signed_out(): void
    {
        $user = $this->user();
        $this->seedSession($user, 'other-session-id');

        $this->actingAs($user)
            ->deleteJson('/security-settings/sessions/'.hash('sha256', 'other-session-id'))
            ->assertOk();

        $this->assertDatabaseMissing('sessions', ['id' => 'other-session-id']);
    }

    /**
     * Deleting the row alone would leave a "stay signed in" browser able to
     * walk straight back in on its remember-me cookie, so the account's token
     * is cycled too.
     */
    public function test_signing_a_session_out_invalidates_remember_me(): void
    {
        $user = $this->user();
        $user->forceFill(['remember_token' => 'the-old-token'])->save();
        $this->seedSession($user, 'other-session-id');

        $this->actingAs($user)
            ->deleteJson('/security-settings/sessions/'.hash('sha256', 'other-session-id'))
            ->assertOk();

        $this->assertNotSame('the-old-token', $user->fresh()->remember_token);
        $this->assertNotEmpty($user->fresh()->remember_token);
    }

    public function test_a_session_that_is_already_gone_reports_it_rather_than_cycling_the_token(): void
    {
        $user = $this->user();
        $user->forceFill(['remember_token' => 'the-old-token'])->save();

        $this->actingAs($user)
            ->deleteJson('/security-settings/sessions/'.hash('sha256', 'no-such-session'))
            ->assertStatus(404);

        $this->assertSame('the-old-token', $user->fresh()->remember_token);
    }

    public function test_another_users_session_cannot_be_signed_out(): void
    {
        $user = $this->user();
        $stranger = $this->user();
        $this->seedSession($stranger, 'stranger-session-id');

        $this->actingAs($user)
            ->deleteJson('/security-settings/sessions/'.hash('sha256', 'stranger-session-id'))
            ->assertStatus(404);

        $this->assertDatabaseHas('sessions', ['id' => 'stranger-session-id']);
    }

    // ------------------------------------------------------- first password

    public function test_an_account_without_a_password_can_set_one(): void
    {
        $user = $this->user(['password_auto' => true]);

        $this->actingAs($user)->postJson('/security-settings/password', [
            'password' => 'correct horse battery staple 91',
            'password_confirmation' => 'correct horse battery staple 91',
        ])->assertOk();

        $user->refresh();
        $this->assertFalse((bool) $user->password_auto);
        $this->assertTrue(Hash::check('correct horse battery staple 91', $user->password));
    }

    public function test_an_account_that_already_has_a_password_is_sent_to_change_password(): void
    {
        $user = $this->user(['password_auto' => false]);

        $this->actingAs($user)->postJson('/security-settings/password', [
            'password' => 'correct horse battery staple 91',
            'password_confirmation' => 'correct horse battery staple 91',
        ])->assertStatus(422)->assertJsonValidationErrors('password');
    }

    // -------------------------------------------------- alerts actually gate

    public function test_changing_a_password_emails_and_notifies_when_the_switch_is_on(): void
    {
        Mail::fake();
        $user = $this->user(['password' => Hash::make('old-password-9999')]);

        $this->actingAs($user)->putJson('/auth/user/password', [
            'current_password' => 'old-password-9999',
            'password' => 'correct horse battery staple 91',
            'password_confirmation' => 'correct horse battery staple 91',
        ])->assertSuccessful();

        Mail::assertQueued(Postcard::class);
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $user->id,
            'type' => 'security.password_changed',
        ]);
    }

    public function test_changing_a_password_stays_quiet_when_the_switch_is_off(): void
    {
        Mail::fake();
        $user = $this->user(['password' => Hash::make('old-password-9999')]);
        SecurityAlerts::update($user, ['password_changed' => false]);

        $this->actingAs($user->fresh())->putJson('/auth/user/password', [
            'current_password' => 'old-password-9999',
            'password' => 'correct horse battery staple 91',
            'password_confirmation' => 'correct horse battery staple 91',
        ])->assertSuccessful();

        Mail::assertNothingQueued();
        $this->assertSame(0, Notification::where('user_id', $user->id)
            ->where('type', 'security.password_changed')->count());
    }

    public function test_turning_two_factor_off_alerts_the_account_owner(): void
    {
        Mail::fake();
        $user = $this->user();

        event(new TwoFactorAuthenticationDisabled($user));

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $user->id,
            'type' => 'security.two_factor_changed',
        ]);
        Mail::assertQueued(Postcard::class);
    }

    public function test_turning_two_factor_on_alerts_the_account_owner(): void
    {
        Mail::fake();
        $user = $this->user();

        event(new TwoFactorAuthenticationConfirmed($user));

        $this->assertSame(1, Notification::where('user_id', $user->id)
            ->where('type', 'security.two_factor_changed')->count());
    }

    /** Enabling two-factor also generates codes; that must not double-alert. */
    public function test_recovery_codes_generated_during_setup_do_not_alert(): void
    {
        Mail::fake();
        $user = $this->user(['two_factor_confirmed_at' => null]);

        event(new RecoveryCodesGenerated($user));

        $this->assertSame(0, Notification::where('user_id', $user->id)
            ->where('type', 'security.two_factor_changed')->count());
    }

    public function test_regenerating_recovery_codes_later_does_alert(): void
    {
        Mail::fake();
        $user = $this->user(['two_factor_confirmed_at' => now()]);

        event(new RecoveryCodesGenerated($user));

        $this->assertSame(1, Notification::where('user_id', $user->id)
            ->where('type', 'security.two_factor_changed')->count());
    }

    public function test_two_factor_alerts_respect_the_switch(): void
    {
        Mail::fake();
        $user = $this->user();
        SecurityAlerts::update($user, ['two_factor_changed' => false]);

        event(new TwoFactorAuthenticationDisabled($user->fresh()));

        $this->assertSame(0, Notification::where('user_id', $user->id)
            ->where('type', 'security.two_factor_changed')->count());
        Mail::assertNothingQueued();
    }

    // ------------------------------------------------------- monthly summary

    public function test_the_monthly_summary_only_goes_to_accounts_that_asked_for_it(): void
    {
        Mail::fake();
        $optedIn = $this->user();
        $optedOut = $this->user();
        SecurityAlerts::update($optedIn, ['monthly_summary' => true]);

        $this->artisan('security:monthly-summary')->assertSuccessful();

        $this->assertDatabaseHas('email_deliveries', ['recipient' => $optedIn->email]);
        $this->assertDatabaseMissing('email_deliveries', ['recipient' => $optedOut->email]);
    }

    public function test_the_monthly_summary_postcard_describes_the_month_it_covers(): void
    {
        $card = Postcards::securitySummary('July 2026', [['Sign-ins', '4']], 'https://example.test/security-settings');

        $this->assertSame('Your security summary for July 2026', $card->subjectLine);
    }
}
