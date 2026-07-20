<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The history backfill, with Gmail faked at the HTTP boundary.
 *
 * Real mail carries values far longer than the schema allows — display names,
 * subjects, thread ids — and because a page is written in one statement, a
 * single oversized row used to abort the whole page and stop the backfill.
 */
class MailBackfillTest extends TestCase
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

    /** A Gmail list page of one message, plus that message's detail. */
    private function fakeGmail(array $headers, ?string $nextPageToken = null): void
    {
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            '*gmail/v1/users/me/messages/msg-1*' => Http::response([
                'id' => 'msg-1',
                'threadId' => $headers['threadId'] ?? 'thread-1',
                'labelIds' => ['INBOX'],
                'snippet' => 'hello',
                'internalDate' => (string) (now()->getTimestamp() * 1000),
                'payload' => ['headers' => $headers['payload']],
            ]),
            '*gmail/v1/users/me/messages*' => Http::response(array_filter([
                'messages' => [['id' => 'msg-1', 'threadId' => $headers['threadId'] ?? 'thread-1']],
                'nextPageToken' => $nextPageToken,
            ])),
            '*gmail/v1/users/me/labels*' => Http::response(['labels' => []]),
            '*gmail/v1/users/me/profile*' => Http::response(['historyId' => '1']),
        ]);
    }

    public function test_a_message_with_oversized_fields_is_stored_rather_than_failing_the_page(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $longName = str_repeat('a', 400);
        $longSubject = str_repeat('s', 1200);

        $this->fakeGmail([
            'threadId' => str_repeat('t', 400),
            'payload' => [
                ['name' => 'From', 'value' => $longName.' <sender@example.com>'],
                ['name' => 'Subject', 'value' => $longSubject],
                ['name' => 'To', 'value' => 'user@example.com'],
            ],
        ]);

        $result = new MailSynchronizer($account)->backfillStep(maxPages: 1);

        $this->assertGreaterThan(0, $result['written'], 'the page should have been written');

        $row = MailMessage::where('connected_account_id', $account->id)->first();
        $this->assertNotNull($row, 'the oversized message should still be stored');
        $this->assertLessThanOrEqual(255, mb_strlen((string) $row->from_name));
        $this->assertLessThanOrEqual(998, mb_strlen((string) $row->subject));
        $this->assertLessThanOrEqual(255, mb_strlen((string) $row->thread_id));
    }

    public function test_backfill_progress_is_saved_per_folder_so_it_can_resume(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        // A next-page token means this folder is not finished yet.
        $this->fakeGmail([
            'payload' => [
                ['name' => 'From', 'value' => 'Dana <dana@example.com>'],
                ['name' => 'Subject', 'value' => 'Hello'],
            ],
        ], nextPageToken: 'page-2');

        new MailSynchronizer($account)->backfillStep(maxPages: 1);

        $progress = $account->fresh()->mail_backfill;

        // Stored as an array, not a raw json string — a queue worker running
        // stale code once saw the latter and died on it.
        $this->assertIsArray($progress, 'progress must be stored as an array, not a raw json string');
        $this->assertArrayHasKey('inbox', $progress, 'the folder it worked on should have a resume point');
        $this->assertSame('page-2', $progress['inbox']['token']);
        $this->assertFalse($progress['inbox']['done']);
    }
}
