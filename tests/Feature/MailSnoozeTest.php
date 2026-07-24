<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Snooze as a working reminder: a portal-local flag that hides the message
 * from its folder into the virtual Snoozed view, and a scheduled wake pass
 * (mail:wake-snoozed) that clears due snoozes and raises the reminder
 * notification.
 */
class MailSnoozeTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function account(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(6),
            'thread_id' => 'thread-'.Str::random(4),
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    public function test_snoozing_is_local_only_and_never_calls_the_provider(): void
    {
        Http::fake();

        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);
        $until = now()->addHours(3);

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['snooze' => $until->toIso8601String()])
            ->assertOk()
            ->assertJsonPath('message.snoozedUntil', fn ($v) => $v !== null);

        $this->assertTrue($message->fresh()->snoozed_until->equalTo($until->startOfSecond()));
        Http::assertNothingSent();

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['snooze' => null])
            ->assertOk()
            ->assertJsonPath('message.snoozedUntil', null);

        $this->assertNull($message->fresh()->snoozed_until);
    }

    public function test_a_snooze_in_the_past_is_rejected(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['snooze' => now()->subMinute()->toIso8601String()])
            ->assertUnprocessable();
    }

    public function test_a_snoozed_message_hides_from_its_folder_and_shows_in_the_snoozed_view(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $resting = $this->message($user, $account, ['subject' => 'Resting', 'snoozed_until' => now()->addDay()]);
        $awake = $this->message($user, $account, ['subject' => 'Awake']);
        $important = $this->message($user, $account, [
            'subject' => 'Important but resting',
            'is_important' => true,
            'snoozed_until' => now()->addHours(2),
        ]);

        $inbox = $this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox')->assertOk()->json('messages');
        $this->assertSame([$awake->uuid], array_column($inbox, 'id'));

        // Soonest wake first, not newest first.
        $snoozed = $this->actingAs($user)->getJson('/portal/mail/messages?folder=snoozed')->assertOk()->json('messages');
        $this->assertSame([$important->uuid, $resting->uuid], array_column($snoozed, 'id'));

        // The Important view also lets snoozed mail rest.
        $importantView = $this->actingAs($user)->getJson('/portal/mail/messages?folder=important')->assertOk()->json('messages');
        $this->assertSame([], array_column($importantView, 'id'));
    }

    public function test_folder_counts_exclude_snoozed_mail_and_count_the_snoozed_view(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['snoozed_until' => now()->addDay()]);
        $this->message($user, $account, ['snoozed_until' => now()->addDay(), 'is_read' => true]);
        $target = $this->message($user, $account);
        $this->message($user, $account);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'access-token', 'expires_in' => 3600]),
            'gmail.googleapis.com/*' => Http::response(['id' => $target->remote_id]),
        ]);

        $folders = $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$target->uuid.'/move', ['folder' => 'archive'])
            ->assertOk()
            ->json('folders');

        $this->assertSame(1, $folders['inbox']['total']);
        $this->assertSame(2, $folders['snoozed']['total']);
        $this->assertSame(1, $folders['snoozed']['unread']);
    }

    public function test_the_wake_pass_returns_due_mail_and_sends_the_reminder_notification(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $due = $this->message($user, $account, [
            'subject' => 'Renewal paperwork',
            'snoozed_until' => now()->subMinute(),
        ]);
        $notDue = $this->message($user, $account, ['snoozed_until' => now()->addDay()]);

        Artisan::call('mail:wake-snoozed');

        // The due one woke: snooze cleared, back in its folder's listing.
        $this->assertNull($due->fresh()->snoozed_until);
        $this->assertNotNull($notDue->fresh()->snoozed_until);

        $inbox = $this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox')->assertOk()->json('messages');
        $this->assertContains($due->uuid, array_column($inbox, 'id'));

        // And the reminder landed as a portal notification that deep-links
        // straight back to this message.
        $reminder = Notification::where('user_id', $user->id)->where('type', 'email.snooze_due')->first();
        $this->assertNotNull($reminder);
        $this->assertSame('Reminder: Renewal paperwork', $reminder->title);
        $this->assertStringContainsString('Dana Reed', $reminder->message);
        $this->assertSame('/email?message='.$due->uuid, $reminder->action_url);

        // A second pass finds nothing due and creates no duplicate reminder.
        Artisan::call('mail:wake-snoozed');
        $this->assertSame(1, Notification::where('user_id', $user->id)->where('type', 'email.snooze_due')->count());
    }
}
