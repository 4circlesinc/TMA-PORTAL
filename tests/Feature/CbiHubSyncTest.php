<?php

namespace Tests\Feature;

use App\Jobs\ImportCbiDocuments;
use App\Jobs\SyncCbiHub;
use App\Models\CbiApplication;
use App\Models\Client;
use App\Models\User;
use App\Support\Files\FolderProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Sync should not stop at Smartsheet metadata: applicants land in the Client
 * hub and their paperwork is queued for the File Library.
 */
class CbiHubSyncTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('filesystems.files_disk', 'local');
        config()->set('services.smartsheet.cbi_enabled', true);
        config()->set('services.smartsheet.token', 'test-token');
        config()->set('services.smartsheet.workspace_id', '1');

        $this->admin = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    public function test_sync_now_queues_the_client_hub_pass(): void
    {
        Bus::fake();

        Http::fake([
            'https://api.smartsheet.com/*' => Http::response([
                'id' => 1,
                'name' => 'Workspace',
                'sheets' => [],
                'folders' => [],
            ]),
        ]);

        $this->actingAs($this->admin)
            ->postJson('/portal/cbi/sync')
            ->assertOk()
            ->assertJsonPath('hubQueued', true);

        Bus::assertDispatched(SyncCbiHub::class);
    }

    public function test_hub_sync_imports_clients_and_queues_document_import(): void
    {
        Bus::fake([ImportCbiDocuments::class]);

        CbiApplication::create([
            'dedupe_key' => 'k'.uniqid('', true),
            'applicant_name' => 'Ada Lovelace',
            'stage' => 'applications',
            'referred_by' => 'Private',
        ]);

        (new SyncCbiHub($this->admin->id))->handle();

        $this->assertDatabaseHas('clients', ['name' => 'Ada Lovelace']);
        $this->assertNotNull(CbiApplication::first()->client_id);
        $this->assertNotNull(Client::where('name', 'Ada Lovelace')->first()?->folder_id);

        Bus::assertDispatched(ImportCbiDocuments::class);
    }

    public function test_hub_sync_provisions_folders_for_already_linked_clients(): void
    {
        Bus::fake([ImportCbiDocuments::class]);

        $client = Client::create([
            'uid' => 'already-linked',
            'name' => 'Already Linked',
            'data' => [],
        ]);

        CbiApplication::create([
            'dedupe_key' => 'k'.uniqid('', true),
            'applicant_name' => 'Already Linked',
            'stage' => 'applications',
            'client_id' => $client->id,
        ]);

        $this->assertNull($client->fresh()->folder_id);

        (new SyncCbiHub($this->admin->id))->handle();

        $this->assertNotNull($client->fresh()->folder_id);
        Bus::assertDispatched(ImportCbiDocuments::class);
    }

    public function test_application_payload_exposes_folder_and_pending_count(): void
    {
        $client = Client::create([
            'uid' => 'ada-lovelace',
            'name' => 'Ada Lovelace',
            'data' => [],
        ]);
        FolderProvisioner::provisionClientFolder($client, $this->admin);

        $application = CbiApplication::create([
            'dedupe_key' => 'k'.uniqid('', true),
            'applicant_name' => 'Ada Lovelace',
            'stage' => 'applications',
            'client_id' => $client->id,
        ]);

        $this->actingAs($this->admin)
            ->getJson('/portal/cbi/applications/'.$application->uuid)
            ->assertOk()
            ->assertJsonPath('folderUuid', $client->fresh()->folder->uuid)
            ->assertJsonPath('pendingDocuments', 0);
    }

    public function test_summary_includes_document_import_progress(): void
    {
        $this->actingAs($this->admin)
            ->getJson('/portal/cbi/summary')
            ->assertOk()
            ->assertJsonStructure([
                'documents' => ['done', 'pending', 'orphaned', 'clients', 'total', 'percent', 'active', 'sizeKb'],
            ]);
    }
}
