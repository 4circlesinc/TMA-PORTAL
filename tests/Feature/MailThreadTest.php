<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The conversation endpoint.
 *
 * The reading pane used to show only the message that was clicked, so a reply
 * arrived with none of the conversation it belonged to. These cover that the
 * whole thread comes back, in order, without the opened message's freshly
 * fetched body being lost on the way out.
 */
class MailThreadTest extends TestCase
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
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'snippet' => 'snippet',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'body_text' => 'cached body',
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    public function test_a_thread_returns_every_message_in_the_conversation_oldest_first(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $first = $this->message($user, $account, [
            'subject' => 'Quarterly review',
            'sent_at' => now()->subDays(3),
        ]);
        $second = $this->message($user, $account, [
            'subject' => 'Re: Quarterly review',
            'sent_at' => now()->subDays(2),
        ]);
        $third = $this->message($user, $account, [
            'subject' => 'Re: Quarterly review',
            'sent_at' => now()->subDay(),
        ]);

        $response = $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$second->uuid}/thread")
            ->assertOk();

        $ids = collect($response->json('messages'))->pluck('id')->all();

        $this->assertSame(
            [$first->uuid, $second->uuid, $third->uuid],
            $ids,
            'The whole conversation should come back in send order.'
        );
    }

    public function test_a_thread_excludes_other_conversations_and_drafts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $target = $this->message($user, $account);
        $this->message($user, $account, ['thread_id' => 'thread-2']);
        $this->message($user, $account, ['folder' => 'draft']);

        $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$target->uuid}/thread")
            ->assertOk()
            ->assertJsonCount(1, 'messages');
    }

    public function test_another_users_message_is_not_reachable(): void
    {
        $owner = $this->user();
        $account = $this->account($owner);
        $message = $this->message($owner, $account);

        $this->actingAs($this->user())
            ->getJson("/portal/mail/messages/{$message->uuid}/thread")
            ->assertNotFound();
    }

    /**
     * The opened message is hydrated on this request, then the thread is read
     * back from the database. Without swapping the hydrated instance back in,
     * the response would carry the stale pre-fetch row and the body the user
     * just waited for would be missing.
     */
    public function test_the_opened_message_keeps_the_body_fetched_for_it(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $message = $this->message($user, $account, [
            'remote_id' => 'gmail-body',
            'body_html' => null,
            'body_text' => null,
        ]);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/*' => Http::response([
                'id' => 'gmail-body',
                'threadId' => 'thread-1',
                'labelIds' => ['INBOX'],
                'internalDate' => (string) (now()->getTimestamp() * 1000),
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

        $response = $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$message->uuid}/thread")
            ->assertOk();

        $this->assertStringContainsString(
            'Full body',
            (string) $response->json('messages.0.bodyHtml')
        );
        $this->assertTrue($response->json('messages.0.bodyLoaded'));
    }

    /**
     * Messages nobody has opened yet report bodyLoaded:false, which is what
     * tells the client to fetch them when the reader expands them. Without it
     * an unfetched message and a genuinely empty one look identical, and the
     * unfetched one would simply never load.
     */
    public function test_unopened_thread_messages_report_that_their_body_is_missing(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $opened = $this->message($user, $account, ['sent_at' => now()->subDay()]);
        $this->message($user, $account, [
            'body_text' => null,
            'body_html' => null,
            'sent_at' => now()->subDays(2),
        ]);

        $response = $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$opened->uuid}/thread")
            ->assertOk();

        $this->assertFalse($response->json('messages.0.bodyLoaded'));
        $this->assertTrue($response->json('messages.1.bodyLoaded'));
    }

    /** Each message carries its own attachments, not the thread's pooled. */
    public function test_each_message_carries_only_its_own_attachments(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $first = $this->message($user, $account, ['sent_at' => now()->subDays(2)]);
        $second = $this->message($user, $account, ['sent_at' => now()->subDay()]);

        MailAttachment::create([
            'uuid' => (string) Str::uuid(),
            'mail_message_id' => $first->id,
            'remote_id' => 'att-1',
            'filename' => 'contract.pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'is_inline' => false,
        ]);

        $response = $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$second->uuid}/thread")
            ->assertOk();

        $this->assertSame('contract.pdf', $response->json('messages.0.attachments.0.name'));
        $this->assertSame([], $response->json('messages.1.attachments'));
    }

    /**
     * An embedded picture stays listed — a sender pasting a real document into
     * the body gives it a Content-ID exactly as a signature logo has one — but
     * it is flagged so the UI can group the two apart.
     */
    public function test_inline_attachments_are_listed_and_flagged(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        MailAttachment::create([
            'uuid' => (string) Str::uuid(),
            'mail_message_id' => $message->id,
            'remote_id' => 'att-logo',
            'filename' => 'logo.png',
            'mime_type' => 'image/png',
            'size' => 512,
            'is_inline' => true,
            'content_id' => 'logo001',
        ]);

        $response = $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$message->uuid}/thread")
            ->assertOk();

        $this->assertSame('logo.png', $response->json('messages.0.attachments.0.name'));
        $this->assertTrue($response->json('messages.0.attachments.0.inline'));
    }

    /** A message with no thread id is a conversation of one, not a group. */
    public function test_a_message_without_a_thread_id_returns_only_itself(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $target = $this->message($user, $account, ['thread_id' => null]);
        $this->message($user, $account, ['thread_id' => null]);

        $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$target->uuid}/thread")
            ->assertOk()
            ->assertJsonCount(1, 'messages')
            ->assertJsonPath('messages.0.id', $target->uuid);
    }

    /**
     * Timestamps go out as an ISO instant as well as the preformatted labels.
     * The labels are built from a UTC Carbon, so on their own a 9pm message
     * reads as 1am the next day for anyone west of UTC — which is how a
     * message ends up looking like it never arrived.
     */
    public function test_messages_carry_an_iso_timestamp_for_local_rendering(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $sentAt = now()->subHours(5);

        $message = $this->message($user, $account, ['sent_at' => $sentAt]);

        $this->actingAs($user)
            ->getJson("/portal/mail/messages/{$message->uuid}/thread")
            ->assertOk()
            ->assertJsonPath('messages.0.sentAt', $sentAt->toIso8601String());
    }
}
