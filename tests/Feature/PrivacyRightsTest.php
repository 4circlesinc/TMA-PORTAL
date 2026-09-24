<?php

namespace Tests\Feature;

use App\Models\ActivityLog;
use App\Models\AuthEvent;
use App\Models\ConnectedAccount;
use App\Models\PrivacyRequest;
use App\Models\User;
use App\Models\UserLocation;
use App\Support\Access\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PrivacyRightsTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'name' => 'Ada Lovelace',
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
        ], $overrides));
    }

    public function test_a_guest_cannot_download_personal_data(): void
    {
        $this->getJson('/me/privacy/export')->assertUnauthorized();
    }

    public function test_export_returns_the_account_and_not_secrets(): void
    {
        $user = $this->user();
        ConnectedAccount::query()->create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'google-ada',
            'email' => $user->email,
            'token' => 'super-secret-token-value',
            'sync_email' => true,
        ]);

        $this->actingAs($user)->get('/me/privacy/export')
            ->assertOk()
            ->assertHeader('content-disposition', 'attachment; filename="tma-personal-data.json"')
            ->assertJsonPath('account.email', $user->email)
            ->assertJsonPath('connectedAccounts.0.provider', 'google')
            ->assertJsonPath('connectedAccounts.0.syncEmail', true)
            ->assertDontSee('super-secret-token-value', false)
            ->assertDontSee($user->password, false);

        $this->assertDatabaseHas('privacy_requests', [
            'user_id' => $user->id,
            'type' => PrivacyRequest::TYPE_EXPORT,
            'status' => PrivacyRequest::STATUS_COMPLETED,
        ]);
    }

    public function test_erasure_requires_the_confirmation_word(): void
    {
        $user = $this->user();

        $this->actingAs($user)->postJson('/me/privacy/erasure', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('confirm');

        $this->assertNull($user->fresh()->deleted_at);
    }

    public function test_erasure_closes_the_login_and_keeps_the_audit_row(): void
    {
        $user = $this->user();
        $email = $user->email;

        ConnectedAccount::query()->create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-ada',
            'email' => $email,
            'token' => 'token-value',
            'sync_email' => true,
        ]);
        AuthEvent::query()->create([
            'user_id' => $user->id,
            'event' => 'login',
            'ip' => '203.0.113.8',
            'created_at' => now(),
        ]);
        UserLocation::query()->create([
            'user_id' => $user->id,
            'type' => 'office',
            'address' => '1 Rodney Bay',
            'latitude' => 14.07,
            'longitude' => -60.95,
        ]);
        ActivityLog::query()->create([
            'actor_id' => $user->id,
            'activity_type' => 'security.login',
            'module' => 'account',
            'action' => 'login',
            'description' => 'Ada Lovelace signed in as '.$email,
            'ip_address' => '203.0.113.8',
        ]);

        $this->actingAs($user)->postJson('/me/privacy/erasure', ['confirm' => 'DELETE'])
            ->assertOk()
            ->assertJsonPath('erased', true);

        $gone = User::withTrashed()->find($user->id);
        $this->assertNotNull($gone->deleted_at);
        $this->assertSame('erased-'.$user->id.'@users.invalid', $gone->email);
        $this->assertSame('Deleted user', $gone->name);
        $this->assertNull($gone->phone);

        $this->assertDatabaseMissing('connected_accounts', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('auth_events', ['user_id' => $user->id]);
        $this->assertDatabaseMissing('user_locations', ['user_id' => $user->id]);

        $logs = ActivityLog::query()->where('actor_id', $user->id)->get();
        $this->assertNotEmpty($logs);
        foreach ($logs as $log) {
            $this->assertStringNotContainsString($email, (string) $log->description);
            $this->assertNull($log->ip_address);
        }
        $this->assertTrue($logs->contains(fn (ActivityLog $log) => str_contains((string) $log->description, 'Deleted user')));

        $request = PrivacyRequest::query()->where('type', PrivacyRequest::TYPE_ERASURE)->first();
        $this->assertSame(PrivacyRequest::STATUS_COMPLETED, $request->status);
        $this->assertSame($email, $request->detail['email']);
    }

    public function test_the_only_administrator_cannot_erase_their_account(): void
    {
        $admin = $this->user(['account_type' => Role::ADMINISTRATOR]);

        $this->actingAs($admin)->postJson('/me/privacy/erasure', ['confirm' => 'DELETE'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('account');

        $this->assertSame($admin->email, $admin->fresh()->email);
        $this->assertNull($admin->fresh()->deleted_at);
        $this->assertDatabaseHas('privacy_requests', [
            'user_id' => $admin->id,
            'type' => PrivacyRequest::TYPE_ERASURE,
            'status' => PrivacyRequest::STATUS_REFUSED,
        ]);
    }

    public function test_restriction_stops_optional_sync_until_it_is_lifted(): void
    {
        $user = $this->user();
        $account = ConnectedAccount::query()->create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'google-restrict',
            'email' => $user->email,
            'token' => 'token-value',
            'sync_email' => true,
            'sync_calendar' => true,
        ]);

        $this->actingAs($user)->postJson('/me/privacy/restriction')
            ->assertOk()
            ->assertJsonPath('restricted', true);

        $account->refresh();
        $this->assertFalse($account->sync_email);
        $this->assertFalse($account->sync_calendar);
        $this->assertNotNull($user->fresh()->processing_restricted_at);

        $account->sync_email = true;
        $account->save();
        $this->assertFalse($account->fresh()->sync_email);

        $this->actingAs($user)->deleteJson('/me/privacy/restriction')
            ->assertOk()
            ->assertJsonPath('restricted', false);

        $this->assertNull($user->fresh()->processing_restricted_at);
        $account->sync_email = true;
        $account->save();
        $this->assertTrue($account->fresh()->sync_email);
    }
}
