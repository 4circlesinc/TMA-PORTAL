<?php

namespace Tests\Feature;

use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Reply / reply-all / forward must land in the original conversation the way
 * Gmail and Outlook themselves send them — not as a brand-new email.
 */
class MailSendTest extends TestCase
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

    private function googleAccount(User $user): ConnectedAccount
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

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'remote-1',
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'to' => [['name' => 'Test User', 'email' => 'user@example.com']],
            'cc' => [['name' => 'Pat', 'email' => 'pat@example.com']],
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    public function test_a_gmail_reply_threads_with_rfc_headers_and_the_original_thread_id(): void
    {
        $user = $this->user();
        $account = $this->googleAccount($user);
        $original = $this->message($user, $account, ['remote_id' => 'gmail-1']);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/gmail/v1/users/me/messages/send' => Http::response(['id' => 'sent-123']),
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-1*' => Http::response([
                'id' => 'gmail-1',
                'threadId' => 'thread-1',
                'payload' => [
                    'headers' => [
                        ['name' => 'Message-ID', 'value' => '<CAE123@mail.gmail.com>'],
                        ['name' => 'References', 'value' => '<CAE000@mail.gmail.com>'],
                    ],
                ],
            ]),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'dana@example.com', 'name' => 'Dana Reed']],
                'subject' => 'Re: Quarterly review',
                'bodyHtml' => '<p>Sounds good.</p>',
                'mode' => 'reply',
                'inReplyTo' => $original->uuid,
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        Http::assertSent(function ($request) {
            if (! str_contains($request->url(), '/messages/send')) {
                return false;
            }

            $this->assertSame('thread-1', $request['threadId']);

            $raw = base64_decode(strtr($request['raw'], '-_', '+/'), true);
            $this->assertStringContainsString('In-Reply-To: <CAE123@mail.gmail.com>', $raw);
            $this->assertStringContainsString('References: <CAE000@mail.gmail.com> <CAE123@mail.gmail.com>', $raw);
            $this->assertStringNotContainsString('In-Reply-To: gmail-1', $raw);

            return true;
        });
    }

    public function test_a_gmail_forward_starts_a_new_conversation(): void
    {
        $user = $this->user();
        $account = $this->googleAccount($user);
        $original = $this->message($user, $account, ['remote_id' => 'gmail-1']);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/*' => Http::response(['id' => 'sent-123']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'other@example.com']],
                'subject' => 'Fwd: Quarterly review',
                'bodyHtml' => '<p>FYI</p>',
                'mode' => 'forward',
                'inReplyTo' => $original->uuid,
            ])
            ->assertOk();

        Http::assertSent(function ($request) {
            if (! str_contains($request->url(), '/messages/send')) {
                return false;
            }

            $this->assertArrayNotHasKey('threadId', $request->data());
            $raw = base64_decode(strtr($request['raw'], '-_', '+/'), true);
            $this->assertStringNotContainsString('In-Reply-To:', $raw);

            return true;
        });
    }

    public function test_an_outlook_reply_uses_create_reply_rather_than_a_new_message(): void
    {
        $user = $this->user();
        $account = $this->microsoftAccount($user);
        $original = $this->message($user, $account);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages/remote-1/createReply' => Http::response(['id' => 'draft-reply']),
            'graph.microsoft.com/v1.0/me/messages/draft-reply/send' => Http::response(null, 202),
            'graph.microsoft.com/v1.0/me/messages/draft-reply' => Http::response(['id' => 'draft-reply']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'dana@example.com']],
                'subject' => 'Re: Quarterly review',
                'bodyHtml' => '<p>Sounds good.</p>',
                'mode' => 'reply',
                'inReplyTo' => $original->uuid,
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with(parse_url($request->url(), PHP_URL_PATH), '/messages/remote-1/createReply'));
        Http::assertSent(fn ($request) => $request->method() === 'PATCH'
            && str_contains($request->url(), '/messages/draft-reply')
            && ($request['body']['content'] ?? null) === '<p>Sounds good.</p>');
        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with(parse_url($request->url(), PHP_URL_PATH), '/messages/draft-reply/send'));
        Http::assertNotSent(fn ($request) => $request->method() === 'POST'
            && preg_match('#/me/messages$#', parse_url($request->url(), PHP_URL_PATH) ?: ''));
    }

    public function test_an_outlook_reply_all_uses_create_reply_all(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);
        $original = $this->message($user, ConnectedAccount::query()->first());

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages/remote-1/createReplyAll' => Http::response(['id' => 'draft-all']),
            'graph.microsoft.com/v1.0/me/messages/draft-all/send' => Http::response(null, 202),
            'graph.microsoft.com/v1.0/me/messages/draft-all' => Http::response(['id' => 'draft-all']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [
                    ['email' => 'dana@example.com'],
                    ['email' => 'alex@example.com'],
                ],
                'cc' => [['email' => 'pat@example.com']],
                'subject' => 'Re: Quarterly review',
                'bodyHtml' => '<p>All of you:</p>',
                'mode' => 'reply-all',
                'inReplyTo' => $original->uuid,
            ])
            ->assertOk();

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_contains($request->url(), '/createReplyAll'));
        Http::assertSent(function ($request) {
            if ($request->method() !== 'PATCH' || ! str_contains($request->url(), '/messages/draft-all')) {
                return false;
            }

            $cc = collect($request['ccRecipients'] ?? [])->pluck('emailAddress.address')->all();
            $this->assertContains('pat@example.com', $cc);

            return true;
        });
    }

    public function test_an_outlook_forward_uses_create_forward(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);
        $original = $this->message($user, ConnectedAccount::query()->first());

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages/remote-1/createForward' => Http::response(['id' => 'draft-fwd']),
            'graph.microsoft.com/v1.0/me/messages/draft-fwd/send' => Http::response(null, 202),
            'graph.microsoft.com/v1.0/me/messages/draft-fwd' => Http::response(['id' => 'draft-fwd']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'other@example.com']],
                'subject' => 'Fwd: Quarterly review',
                'bodyHtml' => '<p>FYI</p>',
                'mode' => 'forward',
                'inReplyTo' => $original->uuid,
            ])
            ->assertOk();

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_contains($request->url(), '/createForward'));
    }
}
