<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Mail search answers from two places: the mirrored mailbox (subject, sender,
 * preview text) and the provider's own full-text index. These pin the union,
 * the mirror-only answer when the provider is unreachable, and the `limit`
 * the sidebar and the global search ask with. Eight was never one of the
 * inbox's page sizes, so `perPage=8` was refused by the listing validator,
 * which is why mail never showed up in search at all.
 */
class MailSearchTest extends TestCase
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
            'remote_id' => 'gmail-'.Str::random(6),
            'thread_id' => 'thread-'.Str::random(6),
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'snippet' => 'Attached is the summary',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    /** The three inbox messages most of these search across. */
    private function inbox(User $user, ConnectedAccount $account): array
    {
        return [
            'review' => $this->message($user, $account, [
                'remote_id' => 'gmail-1',
                'subject' => 'Quarterly review',
                'snippet' => 'Attached is the summary',
                'from_name' => 'Dana Reed',
                'from_email' => 'dana@example.com',
                'sent_at' => now()->subHours(3),
            ]),
            'invoice' => $this->message($user, $account, [
                'remote_id' => 'gmail-2',
                'subject' => 'Invoice #1042',
                'snippet' => 'Payment for the budget work',
                'from_name' => 'Ana Ruiz',
                'from_email' => 'ana@billing.test',
                'sent_at' => now()->subHours(2),
            ]),
            'onboarding' => $this->message($user, $account, [
                'remote_id' => 'gmail-3',
                'subject' => 'Re: onboarding',
                'snippet' => 'Welcome aboard',
                'from_name' => 'Sam Lee',
                'from_email' => 'sam@example.com',
                'sent_at' => now()->subHour(),
            ]),
        ];
    }

    /**
     * The token exchange every provider call begins with, plus a provider
     * search that finds nothing, so what comes back is the mirror's answer.
     * A test's own fakes override these by key (the search list pattern is
     * the one a test replaces to hand back provider hits).
     */
    private function fakeProvider(array $extra = []): void
    {
        Http::fake(array_merge([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/gmail/v1/users/me/messages?*' => Http::response(['messages' => []]),
        ], $extra));
    }

    /** A Gmail metadata record, the shape the provider hydrates search hits from. */
    private function gmailMetadata(string $id, string $subject, string $from): array
    {
        return [
            'id' => $id,
            'threadId' => 'thread-'.$id,
            'labelIds' => ['INBOX'],
            'internalDate' => (string) (now()->getTimestamp() * 1000),
            'snippet' => 'snippet',
            'payload' => [
                'headers' => [
                    ['name' => 'From', 'value' => $from],
                    ['name' => 'Subject', 'value' => $subject],
                    ['name' => 'Date', 'value' => now()->toRfc2822String()],
                ],
                'mimeType' => 'text/plain',
            ],
        ];
    }

    private function ids(array $json): array
    {
        return array_column($json['messages'] ?? [], 'id');
    }

    public function test_the_mirror_answers_by_subject_sender_and_preview_newest_first(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);
        $this->fakeProvider();

        $this->assertSame(
            [$mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=review')->assertOk()->json()),
            'a word in the subject'
        );

        $this->assertSame(
            [$mail['invoice']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=Ana+Ruiz')->assertOk()->json()),
            'the sender\'s name, any case'
        );

        $this->assertSame(
            [$mail['invoice']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=billing.test')->assertOk()->json()),
            'the sender\'s address'
        );

        $this->assertSame(
            [$mail['invoice']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=budget')->assertOk()->json()),
            'a word only in the preview'
        );

        // Newest first, the way the inbox reads.
        $this->assertSame(
            [$mail['onboarding']->uuid, $mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=example.com')->assertOk()->json()),
        );
    }

    public function test_every_word_has_to_match_somewhere(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);
        $this->fakeProvider();

        $this->actingAs($user)
            ->getJson('/portal/mail/messages?q=quarterly+invoice')
            ->assertOk()
            ->assertJsonCount(0, 'messages');

        // Subject word plus sender word, across two columns.
        $this->assertSame(
            [$mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=quarterly+dana')->assertOk()->json()),
        );
    }

    public function test_a_literal_percent_or_underscore_matches_itself(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $this->inbox($user, $account);
        $wild = $this->message($user, $account, ['subject' => '50% off_today', 'remote_id' => 'gmail-9']);
        $this->fakeProvider();

        $this->assertSame(
            [$wild->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q='.urlencode('50%'))->assertOk()->json()),
        );

        // `_` must not act as the single-character wildcard.
        $this->actingAs($user)
            ->getJson('/portal/mail/messages?q='.urlencode('off_toda_'))
            ->assertOk()
            ->assertJsonCount(0, 'messages');
    }

    public function test_rows_carry_the_list_shape_the_sidebar_renders(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);
        $this->fakeProvider();

        $this->actingAs($user)
            ->getJson('/portal/mail/messages?q=review&limit=8')
            ->assertOk()
            ->assertJsonCount(1, 'messages')
            ->assertJsonPath('messages.0.id', $mail['review']->uuid)
            ->assertJsonPath('messages.0.subject', 'Quarterly review')
            ->assertJsonPath('messages.0.sender', 'Dana Reed')
            ->assertJsonPath('messages.0.email', 'dana@example.com')
            ->assertJsonPath('messages.0.body', 'Attached is the summary')
            ->assertJsonPath('messages.0.folder', 'inbox')
            ->assertJsonStructure(['messages' => [['sentAt', 'avatarUrl', 'threadCount']]]);
    }

    public function test_limit_caps_a_search_and_is_not_a_page_size(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);
        $this->fakeProvider();

        $this->assertSame(
            [$mail['onboarding']->uuid, $mail['invoice']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=e&limit=2')->assertOk()->json()),
            'the newest two of three'
        );

        // Eight is what the sidebar asks for; it is not an inbox page size,
        // so it goes through `limit`, never `perPage`.
        $this->actingAs($user)->getJson('/portal/mail/messages?q=e&limit=8')->assertOk()->assertJsonCount(3, 'messages');
        $this->actingAs($user)->getJson('/portal/mail/messages?q=e&perPage=8')->assertStatus(422);
        $this->actingAs($user)->getJson('/portal/mail/messages?q=e&limit=0')->assertStatus(422);
        $this->actingAs($user)->getJson('/portal/mail/messages?q=e&limit=51')->assertStatus(422);
    }

    public function test_provider_hits_join_the_mirror_without_duplicates(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);

        // "review" only appears in this one's body, which the mirror does not
        // search; the provider's index finds it.
        $bodyHit = $this->message($user, $account, [
            'remote_id' => 'gmail-4',
            'subject' => 'Numbers attached',
            'snippet' => 'See the sheet',
            'from_name' => 'Pat Cole',
            'from_email' => 'pat@example.org',
            'sent_at' => now()->subMinutes(30),
        ]);

        $this->fakeProvider([
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-4*' => Http::response(
                $this->gmailMetadata('gmail-4', 'Numbers attached', 'Pat Cole <pat@example.org>')
            ),
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-1*' => Http::response(
                $this->gmailMetadata('gmail-1', 'Quarterly review', 'Dana Reed <dana@example.com>')
            ),
            // A hit that was never synced has nothing to open, so it is left out.
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-999*' => Http::response(
                $this->gmailMetadata('gmail-999', 'Unsynced review', 'Nobody <nobody@example.com>')
            ),
            'gmail.googleapis.com/gmail/v1/users/me/messages?*' => Http::response([
                'messages' => [['id' => 'gmail-4'], ['id' => 'gmail-1'], ['id' => 'gmail-999']],
            ]),
        ]);

        $this->assertSame(
            [$bodyHit->uuid, $mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=review')->assertOk()->json()),
        );

        Http::assertSent(fn ($request) => str_contains($request->url(), '/messages?')
            && ($request['q'] ?? null) === 'review');
    }

    public function test_a_failing_provider_search_still_answers_from_the_mirror(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);

        $this->fakeProvider([
            'gmail.googleapis.com/gmail/v1/users/me/messages?*' => Http::response(['error' => 'boom'], 500),
        ]);

        $this->assertSame(
            [$mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=review')->assertOk()->json()),
        );
    }

    public function test_a_dead_token_still_answers_from_the_mirror(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        $this->assertSame(
            [$mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=review')->assertOk()->json()),
        );
    }

    public function test_spam_trash_and_other_mailboxes_stay_out(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $mail = $this->inbox($user, $account);
        $this->message($user, $account, ['subject' => 'Spam review', 'folder' => 'spam', 'remote_id' => 'gmail-5']);
        $this->message($user, $account, ['subject' => 'Trashed review', 'folder' => 'trash', 'remote_id' => 'gmail-6']);

        $other = $this->user();
        $otherAccount = $this->account($other, ['email' => 'other@example.com']);
        $this->message($other, $otherAccount, ['subject' => 'Their review', 'remote_id' => 'gmail-7']);

        $this->fakeProvider();

        $this->assertSame(
            [$mail['review']->uuid],
            $this->ids($this->actingAs($user)->getJson('/portal/mail/messages?q=review')->assertOk()->json()),
        );
    }

    public function test_a_search_without_a_connected_mailbox_says_so(): void
    {
        $this->actingAs($this->user())
            ->getJson('/portal/mail/messages?q=review')
            ->assertStatus(409)
            ->assertJsonPath('reconnect', true);
    }
}
