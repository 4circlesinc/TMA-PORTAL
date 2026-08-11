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
use Tests\TestCase;

/**
 * Firm-wide pause for SharePoint / OneDrive / Smartsheet document imports.
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

    public function test_admin_can_pause_and_resume_imports(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson('/admin/background-ops/imports-pause', ['paused' => true])
            ->assertOk()
            ->assertJson(['importsPaused' => true]);

        $this->assertTrue(ImportPause::active());

        $this->actingAs($admin)
            ->getJson('/admin/background-ops')
            ->assertOk()
            ->assertJsonPath('importsPaused', true);

        $this->actingAs($admin)
            ->putJson('/admin/background-ops/imports-pause', ['paused' => false])
            ->assertOk()
            ->assertJson(['importsPaused' => false]);

        $this->assertFalse(ImportPause::active());
    }

    public function test_employee_cannot_pause_imports(): void
    {
        $this->actingAs($this->employee())
            ->putJson('/admin/background-ops/imports-pause', ['paused' => true])
            ->assertForbidden();

        $this->assertFalse(ImportPause::active());
    }

    public function test_sharepoint_retry_is_blocked_while_paused(): void
    {
        ImportPause::put(true, $this->admin()->id);
        Queue::fake();

        $this->actingAs($this->admin())
            ->postJson('/portal/files/sync-status/retry')
            ->assertStatus(422);

        Queue::assertNothingPushed();
    }

    public function test_sharepoint_sync_job_noops_while_paused(): void
    {
        $admin = $this->admin();
        $connection = SharePointConnection::query()->create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'site_id' => 'site-1',
            'drive_kind' => 'site',
            'drive_id' => 'drive-1',
            'drive_name' => 'Citizenship Applications',
            'site_name' => 'Firm',
            'status' => SharePointConnection::STATUS_IDLE,
            'sync_enabled' => true,
            'created_by' => $admin->id,
        ]);

        ImportPause::put(true, $admin->id);

        // Must not throw and must not flip the connection into syncing.
        (new SyncSharePointLibrary($connection->id))->handle();

        $this->assertSame(
            SharePointConnection::STATUS_IDLE,
            $connection->fresh()->status
        );
    }

    public function test_cbi_document_import_job_noops_while_paused(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        ImportPause::put(true, $this->admin()->id);
        Queue::fake();

        (new ImportCbiDocuments($this->admin()->id))->handle();

        Queue::assertNotPushed(ImportCbiDocuments::class);
    }

    public function test_cbi_hub_job_noops_while_paused(): void
    {
        config(['services.smartsheet.cbi_enabled' => true]);
        ImportPause::put(true, $this->admin()->id);
        Queue::fake();

        (new SyncCbiHub($this->admin()->id))->handle();

        Queue::assertNotPushed(ImportCbiDocuments::class);
    }

    public function test_me_sync_status_reports_imports_paused(): void
    {
        ImportPause::put(true, $this->admin()->id);

        $this->actingAs($this->admin())
            ->getJson('/me/sync-status')
            ->assertOk()
            ->assertJsonPath('importsPaused', true);
    }
}
