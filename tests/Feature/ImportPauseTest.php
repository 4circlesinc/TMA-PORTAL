<?php

namespace Tests\Feature;

use App\Jobs\ImportCbiDocuments;
use App\Jobs\SyncCbiHub;
use App\Jobs\SyncSharePointLibrary;
use App\Models\SharePointConnection;
use App\Models\User;
use App\Support\Imports\ImportPause;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Per-import pause switches (Smartsheet / OneDrive / each SharePoint library).
 */
class ImportPauseTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        ImportPause::flush();
        parent::tearDown();
    }

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function employee(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function library(User $admin, string $name = 'Citizenship Applications'): SharePointConnection
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

    public function test_admin_can_pause_one_import_at_a_time(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->admin();
        $lib = $this->library($admin);

        $this->actingAs($admin)
            ->putJson('/admin/background-ops/imports-pause', [
                'target' => 'smartsheet',
                'paused' => true,
            ])
            ->assertOk()
            ->assertJsonPath('paused', true)
            ->assertJsonPath('target', 'smartsheet');

        $this->assertTrue(ImportPause::smartsheet());
        $this->assertFalse(ImportPause::onedrive());
        $this->assertFalse(ImportPause::library($lib->uuid));

        $this->actingAs($admin)
            ->putJson('/admin/background-ops/imports-pause', [
                'target' => 'library:'.$lib->uuid,
                'paused' => true,
            ])
            ->assertOk();

        $this->assertTrue(ImportPause::library($lib->uuid));
        $this->assertTrue(ImportPause::smartsheet());

        $this->actingAs($admin)
            ->getJson('/admin/background-ops')
            ->assertOk()
            ->assertJsonPath('imports.anyPaused', true)
            ->assertJsonFragment(['id' => 'smartsheet', 'paused' => true])
            ->assertJsonFragment(['id' => 'library:'.$lib->uuid, 'paused' => true]);
    }

    public function test_employee_cannot_pause_imports(): void
    {
        $this->actingAs($this->employee())
            ->putJson('/admin/background-ops/imports-pause', [
                'target' => 'onedrive',
                'paused' => true,
            ])
            ->assertForbidden();

        $this->assertFalse(ImportPause::onedrive());
    }

    public function test_sharepoint_retry_is_blocked_only_for_paused_library(): void
    {
        $admin = $this->admin();
        $paused = $this->library($admin, 'Paused Lib');
        $open = $this->library($admin, 'Open Lib');
        ImportPause::putTarget('library:'.$paused->uuid, true, $admin->id);
        Queue::fake();

        $this->actingAs($admin)
            ->postJson('/portal/files/sync-status/retry', ['connection' => $paused->uuid])
            ->assertStatus(422);

        Queue::assertNothingPushed();

        $this->actingAs($admin)
            ->postJson('/portal/files/sync-status/retry', ['connection' => $open->uuid])
            ->assertOk();

        Queue::assertPushed(SyncSharePointLibrary::class, fn ($job) => $job->connectionId === $open->id);
    }

    public function test_sharepoint_sync_job_noops_only_when_that_library_is_paused(): void
    {
        $admin = $this->admin();
        $connection = $this->library($admin);
        ImportPause::putTarget('library:'.$connection->uuid, true, $admin->id);

        (new SyncSharePointLibrary($connection->id))->handle();

        $this->assertSame(
            SharePointConnection::STATUS_IDLE,
            $connection->fresh()->status
        );
    }

    public function test_cbi_jobs_noop_when_smartsheet_is_paused(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->admin();
        ImportPause::putTarget('smartsheet', true, $admin->id);
        Queue::fake();

        (new SyncCbiHub($admin->id))->handle();
        (new ImportCbiDocuments($admin->id))->handle();

        Queue::assertNotPushed(ImportCbiDocuments::class);
        $this->assertFalse(ImportPause::onedrive());
    }

    public function test_me_sync_status_reports_per_service_pause(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        $admin = $this->admin();
        ImportPause::putTarget('smartsheet', true, $admin->id);

        $this->actingAs($admin)
            ->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('importsPaused', true)
            ->assertJsonPath('smartsheet.importsPaused', true);
    }
}
