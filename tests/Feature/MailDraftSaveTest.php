<?php

namespace Tests\Feature;

use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailCorrespondent;
use App\Models\MailDraft;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Compose autosave writes the portal row immediately, but only mirrors a
 * draft into Outlook/Gmail once the user has typed a recipient, subject, or
 * a body beyond the signature. Send still reuses that remote draft.
 */
class MailDraftSaveTest extends TestCase
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

    private function microsoftAccount(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['Mail.ReadWrite', 'Mail.Send'],
            'sync_email' => true,
        ]);
    }

    public function test_saving_a_new_draft_creates_it_in_outlook(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
        ]);

        $response = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'to' => [['email' => 'dana@example.com', 'name' => 'Dana']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Draft body</p>',
            ])
            ->assertOk();

        $uuid = $response->json('draft.id');
        $this->assertNotEmpty($uuid);

        $this->assertDatabaseHas('mail_drafts', [
            'uuid' => $uuid,
            'user_id' => $user->id,
            'remote_id' => 'outlook-draft-1',
            'subject' => 'Hello',
        ]);

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && preg_match('#/me/messages$#', parse_url($request->url(), PHP_URL_PATH) ?: '')
            && ($request['subject'] ?? null) === 'Hello');
    }

    public function test_updating_a_draft_patches_the_same_outlook_message(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1' => Http::response(['id' => 'outlook-draft-1']),
        ]);

        $uuid = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'subject' => 'Hello',
                'bodyHtml' => '<p>First</p>',
            ])
            ->assertOk()
            ->json('draft.id');

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'id' => $uuid,
                'subject' => 'Hello again',
                'bodyHtml' => '<p>Second</p>',
            ])
            ->assertOk();

        $this->assertSame(1, MailDraft::query()->where('user_id', $user->id)->count());
        $this->assertSame('outlook-draft-1', MailDraft::query()->where('uuid', $uuid)->value('remote_id'));

        Http::assertSent(fn ($request) => $request->method() === 'PATCH'
            && str_contains($request->url(), '/messages/outlook-draft-1')
            && ($request['subject'] ?? null) === 'Hello again');
    }

    public function test_sending_reuses_the_outlook_draft_instead_of_creating_another(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1/attachments' => Http::response(['value' => []]),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1/send' => Http::response(null, 202),
        ]);

        $uuid = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'to' => [['email' => 'dana@example.com']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Ready</p>',
            ])
            ->json('draft.id');

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'dana@example.com']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Ready</p>',
                'draftId' => $uuid,
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        $creates = collect(Http::recorded())->filter(function ($pair) {
            $request = $pair[0];

            return $request->method() === 'POST'
                && preg_match('#/me/messages$#', parse_url($request->url(), PHP_URL_PATH) ?: '');
        });
        $this->assertCount(1, $creates, 'Send must reuse the Outlook draft created on autosave.');

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with(parse_url($request->url(), PHP_URL_PATH) ?: '', '/messages/outlook-draft-1/send'));

        $this->assertDatabaseMissing('mail_drafts', ['uuid' => $uuid]);
        $this->assertTrue(
            MailCorrespondent::query()
                ->where('user_id', $user->id)
                ->where('email', 'dana@example.com')
                ->exists()
        );
    }

    public function test_a_local_draft_is_kept_when_outlook_is_unreachable(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['error' => ['message' => 'boom']], 500),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'subject' => 'Offline',
                'bodyHtml' => '<p>Still here</p>',
            ])
            ->assertOk();

        $this->assertDatabaseHas('mail_drafts', [
            'user_id' => $user->id,
            'subject' => 'Offline',
            'remote_id' => null,
        ]);
    }

    public function test_an_empty_compose_window_is_not_created_in_outlook(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['id' => 'should-not-create']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'to' => [],
                'subject' => '',
                'bodyHtml' => '<div class="tma-dash__email-compose-signature" data-email-signature><br>Kind Regards,<br>This Electronic Mail and any attached files may contain confidential information.</div>',
            ])
            ->assertOk();

        $this->assertDatabaseHas('mail_drafts', [
            'user_id' => $user->id,
            'remote_id' => null,
        ]);

        Http::assertNotSent(fn ($request) => $request->method() === 'POST'
            && str_contains($request->url(), 'graph.microsoft.com')
            && str_contains($request->url(), '/messages'));
    }

    public function test_the_first_real_edit_creates_the_outlook_draft(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
        ]);

        $uuid = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'subject' => '',
                'bodyHtml' => '<div data-email-signature>Kind Regards</div>',
            ])
            ->assertOk()
            ->json('draft.id');

        $this->assertNull(MailDraft::query()->where('uuid', $uuid)->value('remote_id'));

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'id' => $uuid,
                'to' => [['email' => 'dana@example.com']],
                'subject' => '',
                'bodyHtml' => '<div data-email-signature>Kind Regards</div>',
            ])
            ->assertOk();

        $this->assertSame('outlook-draft-1', MailDraft::query()->where('uuid', $uuid)->value('remote_id'));
    }

    public function test_a_draft_list_row_shows_the_recipient_instead_of_null(): void
    {
        $user = $this->user();
        $account = $this->microsoftAccount($user);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'outlook-draft-real',
            'thread_id' => 'thread-draft-real',
            'folder' => 'draft',
            'subject' => 'Re: Pending Approval',
            'snippet' => 'Following up',
            'from_name' => null,
            'from_email' => null,
            'to' => [['name' => 'Cindy Emmanuel', 'email' => 'cindy@example.com']],
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ]);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'outlook-draft-empty',
            'thread_id' => 'thread-draft-empty',
            'folder' => 'draft',
            'subject' => null,
            'snippet' => 'This Electronic Mail and any attached files may contain confidential information.',
            'from_name' => 'null',
            'from_email' => null,
            'to' => [],
            'is_read' => true,
            'sent_at' => now(),
        ]);

        $rows = collect($this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=draft')
            ->assertOk()
            ->json('messages'))
            ->keyBy('subject');

        $this->assertSame('Cindy Emmanuel', $rows['Re: Pending Approval']['sender']);
        $this->assertSame('cindy@example.com', $rows['Re: Pending Approval']['email']);
        $this->assertSame('Draft', $rows['(no subject)']['sender']);
        $this->assertNotSame('null', $rows['(no subject)']['sender']);
    }

    public function test_continuing_a_draft_reuses_the_provider_message(): void
    {
        $user = $this->user();
        $account = $this->microsoftAccount($user);

        $message = MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'outlook-draft-1',
            'thread_id' => 'thread-1',
            'folder' => 'draft',
            'subject' => 'Hello',
            'snippet' => 'Draft body',
            'body_html' => '<p>Draft body</p>',
            'from_name' => null,
            'from_email' => null,
            'to' => [['email' => 'dana@example.com', 'name' => 'Dana']],
            'is_read' => true,
            'sent_at' => now(),
        ]);

        $response = $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$message->uuid.'/continue')
            ->assertOk();

        $this->assertSame('Hello', $response->json('draft.subject'));
        $this->assertSame('dana@example.com', $response->json('draft.to.0.email'));
        $this->assertSame('outlook-draft-1', MailDraft::query()->where('uuid', $response->json('draft.id'))->value('remote_id'));
    }

    public function test_empty_outlook_drafts_are_not_mirrored_into_the_list(): void
    {
        $user = $this->user();
        $account = $this->microsoftAccount($user);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/mailFolders/drafts/messages*' => Http::response([
                'value' => [
                    [
                        'id' => 'empty-draft',
                        'conversationId' => 'c-empty',
                        'subject' => '',
                        'bodyPreview' => 'This Electronic Mail and any attached files may contain confidential information.',
                        'from' => null,
                        'toRecipients' => [],
                        'ccRecipients' => [],
                        'isRead' => true,
                        'hasAttachments' => true,
                        'receivedDateTime' => '2026-09-04T12:00:00Z',
                        'categories' => [],
                    ],
                    [
                        'id' => 'real-draft',
                        'conversationId' => 'c-real',
                        'subject' => 'Re: Pending Approval',
                        'bodyPreview' => 'Following up',
                        'from' => ['emailAddress' => ['name' => 'Vernon Francis', 'address' => 'user@example.com']],
                        'toRecipients' => [['emailAddress' => ['name' => 'Cindy', 'address' => 'cindy@example.com']]],
                        'ccRecipients' => [],
                        'isRead' => true,
                        'hasAttachments' => false,
                        'receivedDateTime' => '2026-03-03T12:00:00Z',
                        'categories' => [],
                    ],
                ],
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        new MailSynchronizer($account)->sync();

        $this->assertDatabaseMissing('mail_messages', ['remote_id' => 'empty-draft']);
        $this->assertDatabaseHas('mail_messages', [
            'remote_id' => 'real-draft',
            'folder' => 'draft',
            'subject' => 'Re: Pending Approval',
        ]);
    }

    public function test_existing_empty_draft_rows_are_removed_on_sync(): void
    {
        $user = $this->user();
        $account = $this->microsoftAccount($user);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'husk-draft',
            'thread_id' => 'thread-husk',
            'folder' => 'draft',
            'subject' => null,
            'snippet' => 'Kind Regards, This Electronic Mail and any attached files may contain confidential information.',
            'from_name' => 'null',
            'from_email' => null,
            'to' => [],
            'is_read' => true,
            'sent_at' => now()->subDay(),
        ]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        new MailSynchronizer($account)->sync();

        $this->assertDatabaseMissing('mail_messages', ['remote_id' => 'husk-draft']);
    }
}
