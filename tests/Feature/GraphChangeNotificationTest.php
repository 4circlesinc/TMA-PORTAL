<?php

namespace Tests\Feature;

use App\Jobs\SyncMailbox;
use App\Jobs\SyncSharePointLibrary;
use App\Models\ConnectedAccount;
use App\Models\GraphSubscription;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Microsoft\ChangeNotifications;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Graph change notifications — the instant path for mailbox and OneDrive.
 */
class GraphChangeNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        return $user;
    }

    private function account(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'email' => $user->email,
            'name' => $user->name,
            'token' => 'refresh-token',
            'scopes' => ['Mail.ReadWrite'],
            'sync_email' => true,
        ]);
    }

    public function test_graph_handshake_echoes_the_validation_token_as_plain_text(): void
    {
        $this->post('/hooks/microsoft-graph?validationToken=prove-this-url')
            ->assertOk()
            ->assertHeader('Content-Type', 'text/plain; charset=utf-8')
            ->assertSee('prove-this-url', false);
    }

    public function test_a_mail_notification_queues_an_incremental_sync(): void
    {
        Queue::fake();
        $account = $this->account($this->user());
        $row = GraphSubscription::create([
            'uuid' => (string) Str::uuid(),
            'kind' => GraphSubscription::KIND_MAIL,
            'connected_account_id' => $account->id,
            'graph_subscription_id' => 'sub-mail-1',
            'resource' => 'me/messages',
            'client_state' => 'secret-mail',
            'expires_at' => now()->addDay(),
        ]);

        $this->postJson('/hooks/microsoft-graph', [
            'value' => [[
                'subscriptionId' => $row->graph_subscription_id,
                'clientState' => 'secret-mail',
                'changeType' => 'created',
            ]],
        ])->assertStatus(202);

        Queue::assertPushed(SyncMailbox::class, fn (SyncMailbox $job) => $job->account->id === $account->id);
    }

    public function test_a_drive_notification_queues_a_library_sync(): void
    {
        Queue::fake();
        $user = $this->user();
        $connection = SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'onedrive:'.$user->email,
            'drive_id' => 'drive-1',
            'drive_kind' => 'onedrive',
            'drive_name' => 'OneDrive',
            'created_by' => $user->id,
            'sync_enabled' => true,
        ]);
        $row = GraphSubscription::create([
            'uuid' => (string) Str::uuid(),
            'kind' => GraphSubscription::KIND_DRIVE,
            'sharepoint_connection_id' => $connection->id,
            'graph_subscription_id' => 'sub-drive-1',
            'resource' => '/drives/drive-1/root',
            'client_state' => 'secret-drive',
            'expires_at' => now()->addDay(),
        ]);

        $this->postJson('/hooks/microsoft-graph', [
            'value' => [[
                'subscriptionId' => $row->graph_subscription_id,
                'clientState' => 'secret-drive',
                'changeType' => 'updated',
            ]],
        ])->assertStatus(202);

        Queue::assertPushed(SyncSharePointLibrary::class, fn ($job) => $job->connectionId === $connection->id);
    }

    public function test_a_forged_client_state_is_ignored(): void
    {
        Queue::fake();
        $account = $this->account($this->user());
        GraphSubscription::create([
            'uuid' => (string) Str::uuid(),
            'kind' => GraphSubscription::KIND_MAIL,
            'connected_account_id' => $account->id,
            'graph_subscription_id' => 'sub-mail-2',
            'resource' => 'me/messages',
            'client_state' => 'real-secret',
            'expires_at' => now()->addDay(),
        ]);

        $this->postJson('/hooks/microsoft-graph', [
            'value' => [[
                'subscriptionId' => 'sub-mail-2',
                'clientState' => 'guessed',
                'changeType' => 'created',
            ]],
        ])->assertStatus(202);

        Queue::assertNothingPushed();
    }

    public function test_http_app_urls_do_not_attempt_a_graph_subscription(): void
    {
        config(['app.url' => 'http://localhost', 'services.microsoft.graph_webhook_url' => null]);

        $this->assertNull(ChangeNotifications::webhookUrl());
    }

    public function test_sync_jobs_release_their_unique_lock_when_processing_starts(): void
    {
        $this->assertContains(
            ShouldBeUniqueUntilProcessing::class,
            class_implements(SyncMailbox::class)
        );
        $this->assertContains(
            ShouldBeUniqueUntilProcessing::class,
            class_implements(SyncSharePointLibrary::class)
        );
        $this->assertGreaterThan(0, (new SyncSharePointLibrary(1))->uniqueFor);
        $this->assertGreaterThan(0, (new SyncMailbox($this->account($this->user())))->uniqueFor);
    }
}
