<?php

namespace Tests\Feature;

use App\Jobs\SyncSharePointLibrary;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Imports\ImportPause;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settings → Background Operations, read from the real queue.
 *
 * The case that matters most is the quiet one: jobs queued and nothing
 * draining them, which is how mail, calendar and file sync stop without any
 * visible error.
 */
class BackgroundOperationsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // The test env runs the sync queue; this page inspects the database
        // one, which is what production uses.
        config(['queue.default' => 'database']);
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function queueJob(string $displayName, int $availableSecondsAgo = 0): void
    {
        DB::table('jobs')->insert([
            'queue' => 'default',
            'payload' => json_encode(['displayName' => $displayName, 'job' => $displayName]),
            'attempts' => 0,
            'reserved_at' => null,
            'available_at' => now()->subSeconds($availableSecondsAgo)->timestamp,
            'created_at' => now()->subSeconds($availableSecondsAgo)->timestamp,
        ]);
    }

    private function failJob(string $displayName): string
    {
        $uuid = (string) Str::uuid();
        DB::table('failed_jobs')->insert([
            'uuid' => $uuid,
            'connection' => 'database',
            'queue' => 'default',
            'payload' => json_encode(['displayName' => $displayName, 'job' => $displayName]),
            'exception' => "RuntimeException: it broke\n#0 stack frame\n#1 more noise",
            'failed_at' => now(),
        ]);

        return $uuid;
    }

    private function library(User $admin, string $name = 'Company Documents'): SharePointConnection
    {
        return SharePointConnection::query()->create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'site-'.Str::random(8),
            'drive_kind' => 'site',
            'drive_id' => 'drive-'.Str::random(8),
            'drive_name' => 'Documents',
            'site_name' => $name,
            'status' => SharePointConnection::STATUS_IDLE,
            'sync_enabled' => true,
            'created_by' => $admin->id,
        ]);
    }

    public function test_an_admin_can_start_a_library_sync_now(): void
    {
        Queue::fake();
        $admin = $this->user('Administrator');
        $lib = $this->library($admin);

        $this->actingAs($admin)
            ->postJson('/admin/background-ops/imports-run', ['target' => 'library:'.$lib->uuid])
            ->assertOk()
            ->assertJsonPath('queued', 1);

        Queue::assertPushed(SyncSharePointLibrary::class, fn ($job) => $job->connectionId === $lib->id);
    }

    public function test_a_paused_library_cannot_be_started(): void
    {
        Queue::fake();
        $admin = $this->user('Administrator');
        $lib = $this->library($admin);
        ImportPause::putTarget('library:'.$lib->uuid, true, $admin->id);

        $this->actingAs($admin)
            ->postJson('/admin/background-ops/imports-run', ['target' => 'library:'.$lib->uuid])
            ->assertStatus(422);

        Queue::assertNothingPushed();
    }

    public function test_a_non_admin_cannot_start_a_sync(): void
    {
        Queue::fake();
        $lib = $this->library($this->user('Administrator'));

        $this->actingAs($this->user('Reviewing Officer'))
            ->postJson('/admin/background-ops/imports-run', ['target' => 'library:'.$lib->uuid])
            ->assertForbidden();

        Queue::assertNothingPushed();
    }

    private function fakeGraphSite(): void
    {
        config([
            'services.microsoft.client_id' => 'client',
            'services.microsoft.client_secret' => 'secret',
            'services.microsoft.graph_tenant_id' => 'tenant',
        ]);

        \Illuminate\Support\Facades\Http::fake([
            'login.microsoftonline.com/*' => \Illuminate\Support\Facades\Http::response(['access_token' => 'tok', 'expires_in' => 3599]),
            'graph.microsoft.com/v1.0/sites/site-1/drives*' => \Illuminate\Support\Facades\Http::response(['value' => [
                ['id' => 'drive-1', 'name' => 'Documents'],
                ['id' => 'drive-2', 'name' => 'Archive'],
            ]]),
            'graph.microsoft.com/v1.0/sites/*' => \Illuminate\Support\Facades\Http::response([
                'id' => 'site-1',
                'displayName' => 'Firm Site',
                'webUrl' => 'https://tmant.sharepoint.com/sites/Firm',
            ]),
            'graph.microsoft.com/*' => \Illuminate\Support\Facades\Http::response([]),
        ]);
    }

    public function test_an_admin_can_connect_a_library_from_settings(): void
    {
        Queue::fake();
        $this->fakeGraphSite();
        $admin = $this->user('Administrator');

        $this->actingAs($admin)
            ->postJson('/admin/background-ops/libraries', [
                // A pasted browser URL, not the host:/path form Graph wants.
                'site' => 'https://tmant.sharepoint.com/sites/Firm/',
                'library' => 'Archive',
            ])
            ->assertOk()
            ->assertJsonPath('connected', 'Archive');

        $connection = SharePointConnection::query()->firstOrFail();
        $this->assertSame('drive-2', $connection->drive_id);
        $this->assertSame('site-1', $connection->site_id);

        $folder = $connection->folder;
        $this->assertSame('Archive', $folder->name);
        $this->assertSame('all_staff', $folder->audience);

        Queue::assertPushed(SyncSharePointLibrary::class, fn ($job) => $job->connectionId === $connection->id);
    }

    public function test_connecting_the_same_library_twice_is_refused(): void
    {
        Queue::fake();
        $this->fakeGraphSite();
        $admin = $this->user('Administrator');

        $this->actingAs($admin)
            ->postJson('/admin/background-ops/libraries', ['site' => 'tmant.sharepoint.com:/sites/Firm'])
            ->assertOk();

        $this->actingAs($admin)
            ->postJson('/admin/background-ops/libraries', ['site' => 'tmant.sharepoint.com:/sites/Firm'])
            ->assertStatus(422);

        $this->assertSame(1, SharePointConnection::count());
    }

    public function test_a_non_admin_cannot_connect_a_library(): void
    {
        $this->fakeGraphSite();

        $this->actingAs($this->user('Reviewing Officer'))
            ->postJson('/admin/background-ops/libraries', ['site' => 'tmant.sharepoint.com'])
            ->assertForbidden();
    }

    public function test_a_non_admin_staff_member_cannot_see_the_queue(): void
    {
        $this->actingAs($this->user('Reviewing Officer'))
            ->getJson('/admin/background-ops')
            ->assertForbidden();
    }

    public function test_it_lists_queued_and_failed_jobs(): void
    {
        $this->queueJob('App\\Jobs\\SyncMailbox');
        $uuid = $this->failJob('App\\Jobs\\SyncSharePointLibrary');

        $this->actingAs($this->user('Administrator'))
            ->getJson('/admin/background-ops')
            ->assertOk()
            ->assertJsonPath('inspectable', true)
            ->assertJsonPath('pending.0.name', 'SyncMailbox')
            ->assertJsonPath('failed.0.name', 'SyncSharePointLibrary')
            ->assertJsonPath('failed.0.uuid', $uuid)
            // The stack trace is stripped; only the first line survives.
            ->assertJsonPath('failed.0.error', 'RuntimeException: it broke')
            ->assertJsonPath('health.pending', 1)
            ->assertJsonPath('health.failed', 1);
    }

    public function test_a_backlog_nobody_is_draining_reads_as_stalled(): void
    {
        $this->queueJob('App\\Jobs\\SyncMailbox', 900);

        $this->actingAs($this->user('Administrator'))
            ->getJson('/admin/background-ops')
            ->assertOk()
            ->assertJsonPath('health.stalled', true);
    }

    public function test_a_fresh_job_is_not_stalled(): void
    {
        $this->queueJob('App\\Jobs\\SyncMailbox', 5);

        $this->actingAs($this->user('Administrator'))
            ->getJson('/admin/background-ops')
            ->assertOk()
            ->assertJsonPath('health.stalled', false);
    }

    public function test_a_failed_job_can_be_dismissed(): void
    {
        $uuid = $this->failJob('App\\Jobs\\SyncMailbox');

        $this->actingAs($this->user('Administrator'))
            ->postJson('/admin/background-ops/retry', ['uuid' => $uuid, 'action' => 'forget'])
            ->assertOk();

        $this->assertDatabaseMissing('failed_jobs', ['uuid' => $uuid]);
    }

    public function test_the_failed_list_can_be_cleared(): void
    {
        $this->failJob('App\\Jobs\\SyncMailbox');
        $this->failJob('App\\Jobs\\PushFileToSharePoint');

        $this->actingAs($this->user('Administrator'))
            ->postJson('/admin/background-ops/flush')
            ->assertOk()
            ->assertJsonPath('cleared', 2);

        $this->assertSame(0, DB::table('failed_jobs')->count());
    }
}
