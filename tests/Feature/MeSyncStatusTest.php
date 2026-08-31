<?php

namespace Tests\Feature;

use App\Models\Calendar;
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

    /*
     * The mailbox had no sync card once its first import was over: this said
     * 'done' for ever after, including while a queued SyncMailbox run was
     * walking the folders. OneDrive and the calendar both report every pass —
     * mail has to as well, or "syncing" means something different per service.
     */
    public function test_a_pass_after_the_first_import_still_reports_syncing(): void
    {
        $user = $this->user();
        $this->oneDrive($user);

        ConnectedAccount::where('user_id', $user->id)->first()->forceFill([
            'mail_backfilled_at' => now()->subDay(),
            'mail_status' => 'syncing',
        ])->save();

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('email.state', 'syncing')
            ->assertJsonPath('email.mode', 'incremental');
    }

    public function test_an_idle_mailbox_reports_done(): void
    {
        $user = $this->user();
        $this->oneDrive($user);

        ConnectedAccount::where('user_id', $user->id)->first()->forceFill([
            'mail_backfilled_at' => now()->subDay(),
            'mail_status' => 'idle',
        ])->save();

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('email.state', 'done');
    }

    public function test_a_stale_mailbox_syncing_flag_does_not_pin_the_toast(): void
    {
        $user = $this->user();
        $this->oneDrive($user);
        $account = ConnectedAccount::where('user_id', $user->id)->first();
        $account->forceFill([
            'mail_backfilled_at' => now()->subDay(),
            'mail_status' => 'syncing',
        ])->save();

        DB::table('connected_accounts')->where('id', $account->id)
            ->update(['updated_at' => now()->subMinutes(ConnectedAccount::MAIL_STALE_MINUTES + 1)]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('email.state', 'done');
    }

    private function calendarAccount(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id, 'provider' => 'microsoft', 'provider_id' => 'p2',
            'email' => $user->email, 'name' => $user->name, 'token' => 'token',
            'scopes' => ['Calendars.ReadWrite'], 'sync_calendar' => true,
        ]);
    }

    private function connectedCalendar(ConnectedAccount $account, array $attributes = []): Calendar
    {
        return Calendar::create(array_merge([
            'uuid' => (string) Str::uuid(), 'name' => 'Calendar',
            'calendar_type' => Calendar::TYPE_PERSONAL,
            'owner_id' => $account->user_id, 'created_by' => $account->user_id,
            'source' => $account->provider, 'connected_account_id' => $account->id,
            'external_id' => 'ext-'.Str::random(6),
            'subscription_status' => 'syncing',
        ], $attributes));
    }

    public function test_a_calendar_run_recently_stamped_reports_syncing(): void
    {
        $user = $this->user();
        $account = $this->calendarAccount($user);
        $this->connectedCalendar($account);
        $this->connectedCalendar($account, [
            'subscription_status' => 'ok', 'subscription_synced_at' => now(),
        ]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('calendar.state', 'syncing')
            ->assertJsonPath('calendar.count', 2)
            ->assertJsonPath('calendar.synced', 1);
    }

    /*
     * The calendar side of the abandoned-lock bug: every connect/queue path
     * stamps subscription_status = 'syncing' and only the sync job's
     * completion clears it, so with no worker the flag stayed set for ever —
     * "Syncing calendar… 1 of 2 calendars" on every page load, for everyone.
     */
    public function test_a_stale_calendar_flag_does_not_pin_the_toast(): void
    {
        $user = $this->user();
        $account = $this->calendarAccount($user);
        $calendar = $this->connectedCalendar($account, [
            'subscription_synced_at' => now()->subDay(),
        ]);
        DB::table('calendars')->where('id', $calendar->id)
            ->update(['updated_at' => now()->subMinutes(Calendar::SYNC_STALE_MINUTES + 5)]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('calendar.state', 'done');
    }

    public function test_a_calendar_import_that_never_ran_reports_error(): void
    {
        $user = $this->user();
        $account = $this->calendarAccount($user);
        $calendar = $this->connectedCalendar($account);
        DB::table('calendars')->where('id', $calendar->id)
            ->update(['updated_at' => now()->subMinutes(Calendar::SYNC_STALE_MINUTES + 5)]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('calendar.state', 'error');
    }

    public function test_discovery_that_never_produced_calendars_goes_quiet(): void
    {
        $user = $this->user();
        $account = $this->calendarAccount($user);
        DB::table('connected_accounts')->where('id', $account->id)
            ->update(['updated_at' => now()->subHour()]);

        $this->actingAs($user)->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('calendar.state', 'off');
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
