<?php

namespace Tests\Feature;

use App\Jobs\AnalyzeMailbox;
use App\Jobs\BackfillMailbox;
use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\MailSyncProgress;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The reconnect / first-import experience: quick analysis, staged progress,
 * stall detection with automatic retry, and a mailbox sign-out that does not
 * disconnect the provider account from the portal.
 */
class MailSyncProgressTest extends TestCase
{
    use RefreshDatabase;

    private function mailUser(): User
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
            'provider_id' => 'p1',
            'email' => $user->email,
            'name' => $user->name,
            'token' => 'refresh-token',
            'scopes' => ['Mail.ReadWrite'],
            'sync_email' => true,
        ]);
    }

    private function seedMessages(User $user, ConnectedAccount $account, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'uuid' => (string) Str::uuid(),
                'user_id' => $user->id,
                'connected_account_id' => $account->id,
                'remote_id' => 'm'.$i,
                'thread_id' => 'thread-'.($i % 10),
                'folder' => 'inbox',
                'subject' => 'Message '.$i,
                'from_email' => 'sender@example.com',
                'is_read' => false, 'is_starred' => false, 'is_important' => false,
                'has_attachments' => $i % 4 === 0,
                'sent_at' => now()->subMinutes($i),
                'created_at' => now(), 'updated_at' => now(),
            ];
        }
        MailMessage::insert($rows);
    }

    private function fakeGraph(): void
    {
        Http::fake([
            'https://login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            // attachmentCounts: one $count request per folder.
            'https://graph.microsoft.com/v1.0/me/mailFolders/*/messages*' => Http::response([
                '@odata.count' => 40,
                'value' => [],
            ]),
            // folderTotals: the folder list with per-folder counts.
            'https://graph.microsoft.com/v1.0/me/mailFolders*' => Http::response([
                'value' => [
                    ['displayName' => 'Inbox', 'totalItemCount' => 8000],
                    ['displayName' => 'Sent Items', 'totalItemCount' => 400],
                    ['displayName' => 'Drafts', 'totalItemCount' => 20],
                ],
            ]),
        ]);
    }

    public function test_analysis_reports_totals_quickly_and_hands_off_to_the_import(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        $this->fakeGraph();
        Queue::fake([SyncMailbox::class, BackfillMailbox::class]);

        new AnalyzeMailbox($account)->handle();

        $progress = MailSyncProgress::where('connected_account_id', $account->id)->firstOrFail();

        // The provider's own totals landed, labelled as estimates.
        $this->assertSame('running', $progress->status);
        $this->assertSame('importing', $progress->current_stage);
        $this->assertSame(8420, $progress->total_messages);
        $this->assertSame(120, $progress->total_attachments); // 3 folders × 40
        $this->assertTrue($progress->totals_estimated);
        $this->assertNotNull($progress->last_progress_at);

        // The heavy work continues on the queue, not in this job.
        Queue::assertPushed(SyncMailbox::class);
        Queue::assertPushed(BackfillMailbox::class);
    }

    public function test_reconnecting_an_imported_mailbox_does_not_restart_the_history_import(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $account->forceFill(['mail_backfilled_at' => now()])->save();
        $this->seedMessages($user, $account, 40);

        $this->fakeGraph();
        Queue::fake([SyncMailbox::class, BackfillMailbox::class]);

        new AnalyzeMailbox($account)->handle();

        $progress = MailSyncProgress::where('connected_account_id', $account->id)->firstOrFail();

        // Existing messages are preserved and counted; only new mail flows in
        // through the incremental sync.
        $this->assertSame('completed', $progress->status);
        $this->assertSame(100, (int) $progress->percentage);
        $this->assertSame(40, (int) $progress->processed_messages);
        $this->assertSame(40, MailMessage::where('connected_account_id', $account->id)->count());

        Queue::assertPushed(SyncMailbox::class);
        Queue::assertNotPushed(BackfillMailbox::class);
    }

    public function test_a_dead_grant_fails_the_analysis_with_an_auth_reason(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        Http::fake([
            'https://login.microsoftonline.com/*' => Http::response(['error' => 'invalid_grant'], 400),
        ]);
        Queue::fake([SyncMailbox::class, BackfillMailbox::class]);

        try {
            new AnalyzeMailbox($account)->handle();
            $this->fail('Expected the analysis to throw on a dead grant.');
        } catch (\App\Support\Mail\MailAuthException) {
            // Expected.
        }

        $progress = MailSyncProgress::where('connected_account_id', $account->id)->firstOrFail();

        $this->assertSame('failed', $progress->status);
        $this->assertSame('auth', $progress->error_code);
        $this->assertNotSame('', (string) $progress->error_message);
    }

    public function test_sync_status_reports_the_stage_counts_and_timing(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $this->seedMessages($user, $account, 30);

        MailSyncProgress::for($account)->forceFill([
            'status' => 'running',
            'current_stage' => 'importing',
            'current_folder' => 'inbox',
            'total_messages' => 8420,
            'processed_messages' => 1250,
            'total_conversations' => 3180,
            'total_attachments' => 1245,
            'total_images' => 680,
            'total_documents' => 565,
            'percentage' => 15,
            'totals_estimated' => true,
            'started_at' => now()->subMinutes(2),
            'last_progress_at' => now()->subSeconds(3),
        ])->save();

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('connected', true)
            ->assertJsonPath('running', true)
            ->assertJsonPath('done', false)
            ->assertJsonPath('failed', false)
            ->assertJsonPath('progress.stage', 'importing')
            ->assertJsonPath('progress.stageLabel', 'Importing messages')
            ->assertJsonPath('progress.stageNumber', 7)
            ->assertJsonPath('progress.stageCount', 10)
            ->assertJsonPath('progress.totalMessages', 8420)
            ->assertJsonPath('progress.processedMessages', 1250)
            ->assertJsonPath('progress.totalConversations', 3180)
            ->assertJsonPath('progress.totalAttachments', 1245)
            ->assertJsonPath('progress.totalImages', 680)
            ->assertJsonPath('progress.totalDocuments', 565)
            ->assertJsonPath('progress.currentFolder', 'inbox')
            ->assertJsonPath('progress.percentage', 15)
            ->assertJsonPath('progress.estimated', true)
            ->assertJsonPath('progress.stalled', false)
            // 1,250 messages in 2 minutes → the remaining ~7,170 have a real,
            // measured estimate rather than an invented one.
            ->assertJsonPath('progress.etaSeconds', fn ($eta) => is_int($eta) && $eta > 0);
    }

    public function test_a_stalled_sync_is_detected_and_retried_automatically(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        MailSyncProgress::for($account)->forceFill([
            'status' => 'running',
            'current_stage' => 'importing',
            'started_at' => now()->subMinutes(5),
            'last_progress_at' => now()->subMinutes(2),
        ])->save();

        Queue::fake([AnalyzeMailbox::class, BackfillMailbox::class, SyncMailbox::class]);

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('progress.stalled', true)
            ->assertJsonPath('progress.retried', true);

        // Mid-import stall resumes the import from its saved page tokens.
        Queue::assertPushed(BackfillMailbox::class);

        // Immediately asking again does not dispatch a second retry — the
        // watchdog is throttled.
        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('progress.stalled', true)
            ->assertJsonPath('progress.retried', false);

        Queue::assertPushed(BackfillMailbox::class, 1);
    }

    public function test_a_failed_sync_reports_its_reason_and_manual_retry_resumes_it(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        MailSyncProgress::for($account)->forceFill([
            'status' => 'failed',
            'current_stage' => 'importing',
            'error_code' => 'rate-limit',
            'error_message' => 'Microsoft is rate-limiting this mailbox. The import pauses and resumes automatically.',
            'started_at' => now()->subMinutes(10),
            'last_progress_at' => now()->subMinutes(5),
        ])->save();

        Queue::fake([AnalyzeMailbox::class, BackfillMailbox::class, SyncMailbox::class]);

        $this->actingAs($user)->getJson('/portal/mail/sync-status')
            ->assertOk()
            ->assertJsonPath('running', false)
            ->assertJsonPath('failed', true)
            ->assertJsonPath('errorCode', 'rate-limit')
            ->assertJsonPath('error', fn ($m) => str_contains((string) $m, 'rate-limiting'));

        $this->actingAs($user)->postJson('/portal/mail/sync/retry')
            ->assertOk()
            ->assertJsonPath('failed', false)
            ->assertJsonPath('running', true);

        Queue::assertPushed(BackfillMailbox::class);

        $progress = MailSyncProgress::where('connected_account_id', $account->id)->firstOrFail();
        $this->assertSame('running', $progress->status);
        $this->assertNull($progress->error_code);
        $this->assertNull($progress->error_message);
    }

    public function test_opening_the_mailbox_restarts_an_unfinished_import(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);

        Queue::fake([AnalyzeMailbox::class, BackfillMailbox::class, SyncMailbox::class]);

        $this->actingAs($user)->getJson('/portal/mail')->assertOk();

        Queue::assertPushed(AnalyzeMailbox::class);

        // Once history is fully imported, opening the page no longer queues
        // an analysis.
        $account->forceFill(['mail_backfilled_at' => now()])->save();

        $this->actingAs($user)->getJson('/portal/mail')->assertOk();

        Queue::assertPushed(AnalyzeMailbox::class, 1);
    }

    public function test_mailbox_sign_out_keeps_the_provider_account_and_the_imported_mail(): void
    {
        $user = $this->mailUser();
        $account = $this->account($user);
        $this->seedMessages($user, $account, 25);

        $this->actingAs($user)->postJson('/portal/mail/sign-out')
            ->assertOk()
            ->assertJsonPath('signedOut', true)
            ->assertJsonPath('provider', 'microsoft');

        // The mailbox is off…
        $this->actingAs($user)->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('connected', false);

        // …but the Microsoft account is still connected to the portal, and
        // nothing that was imported has been thrown away.
        $account->refresh();
        $this->assertFalse((bool) $account->sync_email);
        $this->assertNotNull($account->token);
        $this->assertSame(25, MailMessage::where('connected_account_id', $account->id)->count());
    }

    public function test_signing_out_without_a_mailbox_is_rejected(): void
    {
        $user = $this->mailUser();

        $this->actingAs($user)->postJson('/portal/mail/sign-out')
            ->assertStatus(422);
    }

    public function test_the_connect_flow_can_return_to_the_email_page(): void
    {
        config([
            'services.microsoft.client_id' => 'client-id',
            'services.microsoft.client_secret' => 'secret',
            'services.microsoft.redirect' => 'http://localhost/auth/social/microsoft/callback',
        ]);

        $user = $this->mailUser();

        $this->actingAs($user)
            ->get('/auth/social/microsoft/redirect?sync_email=1&return=email')
            ->assertRedirect();

        $this->assertSame('email', session('social.return'));
    }
}
