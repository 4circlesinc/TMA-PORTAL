<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Covers the mailbox end to end with Gmail faked at the HTTP boundary, so the
 * provider mapping, the sync, and the controller are all exercised without
 * touching a real account.
 */
class MailboxTest extends TestCase
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

    private function account(User $user, array $overrides = []): ConnectedAccount
    {
        return ConnectedAccount::create(array_merge([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ], $overrides));
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-1',
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'snippet' => 'Attached is the summary',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    /** The access-token exchange every provider call begins with. */
    private function fakeTokenEndpoint(array $extra = []): void
    {
        Http::fake(array_merge([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
        ], $extra));
    }

    public function test_a_user_without_a_connected_mailbox_is_told_so_rather_than_shown_nothing(): void
    {
        $this->actingAs($this->user())
            ->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('connected', false)
            ->assertJsonPath('folders', []);
    }

    public function test_the_inbox_lists_synced_messages_newest_first_with_folder_counts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['remote_id' => 'old', 'subject' => 'Older', 'sent_at' => now()->subDays(2)]);
        $this->message($user, $account, ['remote_id' => 'new', 'subject' => 'Newer', 'sent_at' => now()]);
        $this->message($user, $account, ['remote_id' => 'sent-1', 'folder' => 'sent', 'is_read' => true]);

        $this->fakeTokenEndpoint();

        $this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=inbox')
            ->assertOk()
            ->assertJsonPath('messages.0.subject', 'Newer')
            ->assertJsonPath('messages.1.subject', 'Older')
            ->assertJsonCount(2, 'messages');

        $this->actingAs($user)
            ->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('connected', true)
            // Both inbox messages are unread; the sent one is not counted here.
            ->assertJsonPath('folders.inbox.unread', 2)
            ->assertJsonPath('folders.sent.total', 1);
    }

    public function test_starring_a_message_reaches_gmail_and_is_mirrored_locally(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'gmail-1']),
        ]);

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['starred' => true])
            ->assertOk()
            ->assertJsonPath('message.starred', true);

        $this->assertTrue($message->fresh()->is_starred);

        // The STARRED label must actually have been added at the provider.
        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/messages/gmail-1/modify')
                && in_array('STARRED', $request['addLabelIds'] ?? [], true);
        });
    }

    public function test_archiving_moves_the_message_and_removes_the_inbox_label(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'gmail-1']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$message->uuid.'/move', ['folder' => 'archive'])
            ->assertOk()
            ->assertJsonPath('message.folder', 'archive');

        $this->assertSame('archive', $message->fresh()->folder);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/messages/gmail-1/modify')
                && in_array('INBOX', $request['removeLabelIds'] ?? [], true);
        });
    }

    public function test_a_message_body_is_fetched_on_first_open_and_cached_after(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-1*' => Http::response([
                'id' => 'gmail-1',
                'threadId' => 'thread-1',
                'labelIds' => ['INBOX'],
                'internalDate' => (string) (now()->getTimestamp() * 1000),
                'snippet' => 'Attached is the summary',
                'payload' => [
                    'headers' => [
                        ['name' => 'From', 'value' => 'Dana Reed <dana@example.com>'],
                        ['name' => 'Subject', 'value' => 'Quarterly review'],
                    ],
                    'mimeType' => 'text/html',
                    'body' => ['data' => rtrim(strtr(base64_encode('<p>Full body</p>'), '+/', '-_'), '=')],
                ],
            ]),
        ]);

        $this->actingAs($user)
            ->getJson('/portal/mail/messages/'.$message->uuid)
            ->assertOk()
            ->assertJsonPath('message.bodyHtml', '<p>Full body</p>');

        $this->assertSame('<p>Full body</p>', $message->fresh()->body_html);
    }

    public function test_sending_posts_a_message_to_gmail(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'sent-123']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'client@example.com', 'name' => 'A Client']],
                'subject' => 'Invoice attached',
                'bodyHtml' => '<p>Please find it enclosed.</p>',
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        Http::assertSent(function ($request) {
            if (! str_contains($request->url(), '/messages/send')) {
                return false;
            }

            // The raw MIME must carry the recipient and subject.
            $raw = base64_decode(strtr($request['raw'], '-_', '+/'), true);

            return str_contains($raw, 'client@example.com')
                && str_contains($raw, 'Invoice attached');
        });
    }

    public function test_a_revoked_grant_asks_the_user_to_reconnect_instead_of_failing(): void
    {
        $user = $this->user();
        $this->account($user);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/sync')
            ->assertStatus(409)
            ->assertJsonPath('reconnect', true);
    }

    public function test_the_sync_maps_gmail_labels_onto_portal_folders_and_flags(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $encoded = fn (string $id) => [
            'id' => $id,
            'threadId' => 't-'.$id,
            'labelIds' => ['INBOX', 'UNREAD', 'STARRED'],
            'internalDate' => (string) (now()->getTimestamp() * 1000),
            'snippet' => 'Hello there',
            'payload' => [
                'headers' => [
                    ['name' => 'From', 'value' => 'Sam Lee <sam@example.com>'],
                    ['name' => 'Subject', 'value' => 'Hello'],
                ],
            ],
        ];

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'a', 'expires_in' => 3600]),
            'gmail.googleapis.com/gmail/v1/users/me/labels' => Http::response(['labels' => []]),
            'gmail.googleapis.com/gmail/v1/users/me/profile' => Http::response(['historyId' => '999']),
            'gmail.googleapis.com/gmail/v1/users/me/messages/m1*' => Http::response($encoded('m1')),
            'gmail.googleapis.com/gmail/v1/users/me/messages?*' => Http::response(['messages' => [['id' => 'm1']]]),
            'gmail.googleapis.com/gmail/v1/users/me/messages*' => Http::response(['messages' => [['id' => 'm1']]]),
        ]);

        new MailSynchronizer($account)->sync();

        $message = MailMessage::where('remote_id', 'm1')->first();

        $this->assertNotNull($message);
        $this->assertSame('inbox', $message->folder);
        $this->assertSame('Sam Lee', $message->from_name);
        $this->assertSame('sam@example.com', $message->from_email);
        $this->assertFalse($message->is_read);
        $this->assertTrue($message->is_starred);

        // The cursor is what makes the next sync incremental.
        $this->assertSame('999', $account->fresh()->mail_cursor);
    }

    public function test_one_user_cannot_reach_another_users_message(): void
    {
        $owner = $this->user();
        $intruder = $this->user();
        $message = $this->message($owner, $this->account($owner));

        $this->actingAs($intruder)
            ->getJson('/portal/mail/messages/'.$message->uuid)
            ->assertNotFound();
    }

    public function test_mail_preferences_round_trip(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', [
                'preferences' => ['signature' => 'Sent from the portal', 'undoSendSeconds' => 12],
            ])
            ->assertOk()
            ->assertJsonPath('preferences.signature', 'Sent from the portal')
            ->assertJsonPath('preferences.undoSendSeconds', 12)
            // Untouched preferences keep their defaults.
            ->assertJsonPath('preferences.conversationView', true);
    }
}
