<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The aggregate poll behind the bottom-right sync toasts.
 *
 * Both cases here are the same real bug seen from two sides: a toast that says
 * "Syncing OneDrive… 1,103 of 1,103 items" all night. The card only leaves the
 * screen when this endpoint stops saying "syncing", so anything that makes it
 * lie — an abandoned lock, or a 500 that kills the poll loop — pins the toast.
 */
class MeSyncStatusTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        $user = User::create(['name' => 'Ada', 'email' => 'ada@example.com', 'password' => bcrypt('x')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => 'Administrator',
        ])->save();

        return $user;
    }

    private function oneDrive(User $user, array $attributes = []): SharePointConnection
    {
        ConnectedAccount::create([
            'user_id' => $user->id, 'provider' => 'microsoft', 'provider_id' => 'p1',
            'email' => $user->email, 'name' => $user->name, 'token' => 'token',
            'scopes' => ['Files.ReadWrite', 'Mail.Read'], 'sync_onedrive' => true, 'sync_email' => true,
        ]);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'OneDrive',
            'owner_id' => $user->id, 'created_by' => $user->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor', 'origin' => 'sharepoint',
        ]);

        return SharePointConnection::create(array_merge([
            'uuid' => (string) Str::uuid(), 'site_id' => 'site-1', 'drive_id' => 'drive-1',
            'drive_name' => 'OneDrive', 'drive_kind' => 'onedrive', 'folder_id' => $folder->id,
            'created_by' => $user->id, 'owner_upn' => $user->email,
            'delta_link' => 'https://graph.example/delta?token=abc',
        ], $attributes));
    }

    public function test_a_run_still_holding_the_lock_reports_syncing(): void
    {
        $user = $this->user();
        $this->oneDrive($user, [
            'status' => SharePointConnection::STATUS_SYNCING,
            'last_synced_at' => now()->subMinute(),
        ]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('onedrive.state', 'syncing');
    }

    public function test_an_abandoned_lock_does_not_report_syncing_for_ever(): void
    {
        $user = $this->user();
        // A worker killed mid-pass never reaches its final update, so the flag
        // stays set with nothing behind it.
        $this->oneDrive($user, [
            'status' => SharePointConnection::STATUS_SYNCING,
            'last_synced_at' => now()->subMinutes(Synchroniser::LOCK_MINUTES + 5),
        ]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('onedrive.state', 'done');
    }

    public function test_an_unreadable_token_reports_error_instead_of_failing_the_poll(): void
    {
        $user = $this->user();
        $this->oneDrive($user, ['status' => SharePointConnection::STATUS_IDLE]);

        // Ciphertext that no longer matches APP_KEY — what a key rotation
        // leaves behind. Reading it throws, and the throw used to 500 the
        // whole endpoint rather than just the one broken service.
        DB::table('connected_accounts')->where('user_id', $user->id)
            ->update(['token' => 'eyJpdiI6ImJvZ3VzIiwidmFsdWUiOiJib2d1cyIsIm1hYyI6ImJvZ3VzIn0=']);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('onedrive.state', 'error')
            ->assertJsonPath('email.state', 'error');
    }
}
