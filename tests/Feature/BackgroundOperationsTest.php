<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
