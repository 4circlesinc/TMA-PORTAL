<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\Notification;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * New mail must ring the portal bell: the live check and the incremental
 * sync raise `email.received` notifications for genuinely new inbox arrivals
 * — and only those. History imports, self-sent mail and already-read messages
 * stay silent, and a burst collapses into one summary row.
 */
class MailNewMailNotificationTest extends TestCase
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
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['Mail.ReadWrite'],
            'sync_email' => true,
        ]);
    }

    /** The watermark message the live check measures "newer than" against. */
    private function seedMessage(User $user, ConnectedAccount $account): MailMessage
    {
        return MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'seed-1',
            'folder' => 'inbox',
            'subject' => 'Existing',
            'from_email' => 'a@example.com',
            'is_read' => true,
            'sent_at' => now()->subMinutes(30),
        ]);
    }

    private function graphMessage(string $id, array $overrides = []): array
    {
        return array_merge([
            'id' => $id,
            'conversationId' => 'conv-'.$id,
            'subject' => 'Message '.$id,
            'bodyPreview' => 'preview',
            'from' => ['emailAddress' => ['name' => 'Dana Reed', 'address' => 'dana@example.com']],
            'toRecipients' => [],
            'isRead' => false,
            'hasAttachments' => false,
            'receivedDateTime' => now()->toIso8601ZuluString(),
            'categories' => [],
        ], $overrides);
    }

    private function fakeGraph(array $messages): void
    {
        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => $messages]),
        ]);
    }

    public function test_a_new_inbox_arrival_raises_a_notification(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->seedMessage($user, $account);

        $this->fakeGraph([$this->graphMessage('new-1', ['subject' => 'Hello there'])]);

        new MailSynchronizer($account)->quickCheck();

        $notification = Notification::where('user_id', $user->id)->where('type', 'email.received')->first();

        $this->assertNotNull($notification, 'A new unread inbox message must raise email.received.');
        $this->assertSame('New email from Dana Reed', $notification->title);
        $this->assertSame('Hello there', $notification->message);
        $this->assertSame('dana@example.com', $notification->metadata['from_email'] ?? null);
        $this->assertSame('Dana Reed', $notification->metadata['from_name'] ?? null);
        $this->assertStringStartsWith('/email?message=', (string) $notification->action_url);
        $this->assertStringContainsString(
            MailMessage::where('user_id', $user->id)->where('remote_id', 'new-1')->value('uuid'),
            (string) $notification->action_url
        );
    }

    public function test_the_same_arrival_never_notifies_twice(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->seedMessage($user, $account);

        $this->fakeGraph([$this->graphMessage('new-1')]);

        $sync = new MailSynchronizer($account);
        $sync->quickCheck();
        // The overlap window re-reads the same message on the next tick.
        $sync->quickCheck();

        $this->assertSame(
            1,
            Notification::where('user_id', $user->id)->where('type', 'email.received')->count()
        );
    }

    public function test_mail_the_user_sent_themselves_stays_silent(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->seedMessage($user, $account);

        $this->fakeGraph([
            $this->graphMessage('own-1', [
                'from' => ['emailAddress' => ['name' => 'Me', 'address' => 'User@Example.com']],
            ]),
            $this->graphMessage('read-1', ['isRead' => true]),
        ]);

        new MailSynchronizer($account)->quickCheck();

        $this->assertSame(
            0,
            Notification::where('user_id', $user->id)->where('type', 'email.received')->count()
        );
    }

    public function test_a_burst_of_mail_collapses_into_one_summary_notification(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->seedMessage($user, $account);

        $burst = [];
        for ($i = 1; $i <= 6; $i++) {
            $burst[] = $this->graphMessage('burst-'.$i);
        }

        $this->fakeGraph($burst);

        new MailSynchronizer($account)->quickCheck();

        $rows = Notification::where('user_id', $user->id)->where('type', 'email.received')->get();

        $this->assertCount(1, $rows, 'Six arrivals must be one summary, not six rows.');
        $this->assertSame('6 new emails', $rows->first()->title);
    }

    public function test_the_live_sync_endpoint_always_returns_folder_counts(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->seedMessage($user, $account);

        // Nothing new — exactly the case where counts used to be skipped.
        $this->fakeGraph([]);

        $this->actingAs($user)
            ->postJson('/portal/mail/sync?fast=1')
            ->assertOk()
            ->assertJsonPath('synced', 0)
            ->assertJsonPath('folders.inbox.total', 1);
    }
}
