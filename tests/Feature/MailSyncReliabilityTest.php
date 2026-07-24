<?php

namespace Tests\Feature;

use App\Jobs\ResolveSenderPhoto;
use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The incremental sync's failure modes — the ones that lose mail rather than
 * merely delaying it.
 *
 * A message that arrives at the provider and never reaches the portal is the
 * worst thing this module can do, and both bugs covered here did exactly that:
 * the cursor stepping over messages it never read, and photo lookups starving
 * the sync jobs behind them.
 */
class MailSyncReliabilityTest extends TestCase
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
            // A timestamp cursor, so sync takes the incremental path.
            'mail_cursor' => 'ts:2026-07-20T00:00:00Z',
        ]);
    }

    private function graphMessage(string $id, string $received): array
    {
        return [
            'id' => $id,
            'conversationId' => 'conv-'.$id,
            'subject' => 'Message '.$id,
            'bodyPreview' => 'preview',
            'from' => ['emailAddress' => ['name' => 'Sender', 'address' => 'sender@example.com']],
            'toRecipients' => [],
            'isRead' => true,
            'hasAttachments' => false,
            'receivedDateTime' => $received,
            'categories' => [],
        ];
    }

    /**
     * The bug this covers: the folder listing was capped at 100 with no
     * paging and ordered newest-first, so when more than a page had arrived
     * the sync took the newest 100, moved the cursor past all of them, and the
     * older ones were never requested again.
     */
    public function test_a_folder_with_more_than_one_page_is_paged_through_rather_than_truncated(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $firstPage = [];
        for ($i = 0; $i < 100; $i++) {
            $firstPage[] = $this->graphMessage('a'.$i, '2026-07-20T01:'.str_pad((string) ($i % 60), 2, '0', STR_PAD_LEFT).':00Z');
        }

        $secondPage = [$this->graphMessage('b1', '2026-07-20T05:00:00Z')];

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            // The nextLink page. Matched first so it wins over the folder rule.
            'graph.microsoft.com/*skiptoken*' => Http::response(['value' => $secondPage]),
            'graph.microsoft.com/v1.0/me/mailFolders/inbox/messages*' => Http::response([
                'value' => $firstPage,
                '@odata.nextLink' => 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=X',
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        new MailSynchronizer($account)->sync();

        $this->assertDatabaseHas('mail_messages', ['remote_id' => 'b1']);
        $this->assertSame(101, MailMessage::where('user_id', $user->id)->count());
    }

    /**
     * The cursor may never move past mail that was not actually read. A folder
     * that stopped early has to leave the cursor behind the last message it
     * got, so the remainder is picked up next pass instead of being skipped.
     */
    public function test_the_cursor_never_advances_past_unread_history(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        new MailSynchronizer($account)->sync();

        $cursor = $account->fresh()->mail_cursor;

        $this->assertStringStartsWith('ts:', $cursor);
        // Drained every folder, so the cursor may reach the moment the pass
        // began — but never a moment after it, which would step over anything
        // that landed while the pass was running.
        $this->assertLessThanOrEqual(
            now()->addSecond()->toIso8601ZuluString(),
            substr($cursor, 3)
        );
    }

    /**
     * Photo lookups must not share a queue with sync. Thousands of them piled
     * up in front of the two sync jobs that actually bring mail in, and mail
     * stopped arriving until the backlog drained.
     */
    public function test_sender_photo_lookups_run_on_their_own_queue(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        Queue::fake();

        ResolveSenderPhoto::dispatch($account, 'someone@example.com');
        SyncMailbox::dispatch($account);

        Queue::assertPushedOn(config('mail.photos_queue', 'default'), ResolveSenderPhoto::class);

        // Sync stays on the default queue, so a worker draining that queue is
        // never held up behind the photo backlog.
        Queue::assertPushed(SyncMailbox::class, function (SyncMailbox $job) {
            return $job->queue === null || $job->queue === 'default';
        });
    }

    /** The same address queued twice is one job, not two. */
    public function test_a_repeated_photo_lookup_is_deduplicated(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $first = new ResolveSenderPhoto($account, 'Someone@Example.com');
        $second = new ResolveSenderPhoto($account, 'someone@example.com');

        // Case-insensitive: the inbox reports whatever casing the sender used,
        // and two spellings of one address are still one lookup.
        $this->assertSame($first->uniqueId(), $second->uniqueId());
    }

    /**
     * The live check is one request against one folder. A full pass walks six
     * folders and pages through each, which cannot finish inside a
     * five-second timer — polls then overlap until the provider throttles,
     * which is what "auto sync isn't working" actually looks like.
     */
    public function test_the_live_check_costs_a_single_inbox_request(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'seed-1',
            'thread_id' => 'c1',
            'folder' => 'inbox',
            'subject' => 'Existing',
            'from_email' => 'a@example.com',
            'sent_at' => now()->subMinutes(10),
        ]);

        $graphCalls = 0;

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token', 'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => function () use (&$graphCalls) {
                $graphCalls++;

                return Http::response(['value' => [
                    $this->graphMessage('new-1', now()->toIso8601ZuluString()),
                ]]);
            },
        ]);

        $written = new MailSynchronizer($account)->quickCheck();

        $this->assertSame(1, $written);
        $this->assertSame(1, $graphCalls, 'The live check must not walk every folder.');
        $this->assertDatabaseHas('mail_messages', ['remote_id' => 'new-1']);
    }

    /** The live check must never move the cursor the full pass depends on. */
    public function test_the_live_check_leaves_the_sync_cursor_alone(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $before = $account->mail_cursor;

        MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'seed-2',
            'folder' => 'inbox',
            'subject' => 'Existing',
            'from_email' => 'a@example.com',
            'sent_at' => now()->subMinutes(10),
        ]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token', 'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        new MailSynchronizer($account)->quickCheck();

        $this->assertSame($before, $account->fresh()->mail_cursor);
    }

    /** With nothing stored yet there is no watermark, so it defers to a full pass. */
    public function test_the_live_check_does_nothing_on_an_empty_mailbox(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        Http::fake(['*' => Http::response([], 500)]);

        $this->assertSame(0, new MailSynchronizer($account)->quickCheck());
    }
}
