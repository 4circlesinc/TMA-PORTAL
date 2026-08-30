<?php

namespace Tests\Feature;

use App\Models\CipApplication;
use App\Models\CipApplicationAssignment;
use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Cip\Applications;
use App\Support\Cip\CipAccess;
use App\Support\Cip\DocumentComments;
use App\Support\Cip\DocumentStatus;
use App\Support\Cip\DocumentTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Workflows section — requests and discussion gathered across every file.
 *
 * The per-file panel is covered by {@see FileWorkflowTest} and
 * {@see FileCommentTest}. What matters here is the part those cannot test: that
 * gathering rows from the whole library never widens who can see them, and that
 * the lists actually answer "what is waiting on me".
 */
class WorkflowHubTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-hub-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }

    private function user(string $type, string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function sharedFile(User $owner, string $name = 'Contract.txt'): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $owner->id, 'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent($name, 'draft one'),
            'folder' => $folder->uuid,
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    /**
     * A file ordinary staff cannot reach.
     *
     * It has to sit under a **client** folder. An unfiled upload would not do:
     * the firm-wide default deliberately publishes ordinary staff files to
     * every colleague, and a client's folder is one of the two things that
     * default explicitly does not cover — reachable only by the staff actually
     * assigned to that client.
     */
    private function privateFile(User $owner, string $name = 'Secret.txt'): FileItem
    {
        $client = Client::create(['uid' => 'acme-'.uniqid(), 'name' => 'Acme Ltd', 'data' => []]);

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Acme Ltd',
            'owner_id' => $owner->id, 'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
        ]);

        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent($name, 'private'),
            'folder' => $folder->uuid,
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    private function send(User $sender, FileItem $file, array $payload = []): array
    {
        return $this->actingAs($sender)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", array_merge([
                'type' => 'approval',
                'recipients' => [],
            ], $payload))
            ->assertCreated()
            ->json();
    }

    public function test_the_inbox_lists_requests_waiting_on_you(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->send($ada, $file, ['recipients' => [['userId' => $ben->id]], 'message' => 'Before Friday please']);

        $res = $this->actingAs($ben)->getJson('/portal/files/workflows?scope=inbox')->assertOk();

        $res->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.file.name', 'Contract.txt')
            ->assertJsonPath('items.0.headline.text', 'Your response is needed')
            ->assertJsonPath('items.0.onMe', true)
            ->assertJsonPath('items.0.message', 'Before Friday please')
            ->assertJsonPath('counts.waiting', 1);

        // The actions come from the type, and are what the client draws.
        $this->assertSame(['approve', 'decline', 'request_changes'], $res->json('items.0.myActions'));

        // The sender has nothing waiting on them, but does have an outbox.
        $this->actingAs($ada)->getJson('/portal/files/workflows?scope=inbox')
            ->assertOk()
            ->assertJsonCount(0, 'items')
            ->assertJsonPath('counts.waiting', 0)
            ->assertJsonPath('counts.sent', 1);

        $this->actingAs($ada)->getJson('/portal/files/workflows?scope=sent')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.sender.isSelf', true)
            ->assertJsonPath('items.0.canCancel', true);
    }

    /** Answering it takes it off the list, and off the badge. */
    public function test_responding_clears_the_inbox(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $wf = $this->send($ada, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();

        $this->actingAs($ben)->getJson('/portal/files/workflows?scope=inbox')
            ->assertOk()
            ->assertJsonCount(0, 'items')
            ->assertJsonPath('counts.waiting', 0);

        // It still happened — it is just finished, which is a different filter.
        $this->actingAs($ada)->getJson('/portal/files/workflows?scope=sent&state=closed')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.status', 'approved')
            ->assertJsonPath('items.0.isOpen', false);
    }

    /**
     * The load-bearing rule: gathering rows from the whole library must never
     * be a way to see a file you were not given.
     */
    public function test_the_firm_wide_list_never_shows_a_file_you_cannot_open(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Reviewing Officer', 'cara@example.com', 'Cara Staff');

        // Ada's own upload with no folder: hers alone, and she asks Ben — who
        // can only answer because sending granted him access.
        $secret = $this->privateFile($ada, 'Payroll.txt');
        $this->send($ada, $secret, ['recipients' => [['userId' => $ben->id]]]);

        $cara->refresh();

        $names = collect($this->actingAs($cara)->getJson('/portal/files/workflows?scope=all&state=all')
            ->assertOk()->json('items'))->pluck('file.name');

        $this->assertNotContains('Payroll.txt', $names,
            'a request on a file Cara cannot open must not appear in the firm-wide list');

        // Ben was given access when he was asked, so for him it is visible.
        $this->actingAs($ben)->getJson('/portal/files/workflows?scope=inbox')
            ->assertOk()
            ->assertJsonPath('items.0.file.name', 'Payroll.txt');
    }

    /** A client asking for the firm-wide scope gets their own, not a 500. */
    public function test_a_client_cannot_widen_the_scope(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $client = $this->user('Client', 'cliff@example.com', 'Cliff Client');
        $this->sharedFile($ada);

        $this->actingAs($client)->getJson('/portal/files/workflows?scope=all&state=all')
            ->assertOk()
            ->assertJsonPath('canSeeAll', false)
            ->assertJsonCount(0, 'items');
    }

    public function test_requests_can_be_filtered_by_type_and_searched_by_file(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $contract = $this->sharedFile($ada, 'Contract.txt');
        $invoice = $this->sharedFile($ada, 'Invoice.txt');

        $this->send($ada, $contract, ['recipients' => [['userId' => $ben->id]], 'type' => 'approval']);
        $this->send($ada, $invoice, ['recipients' => [['userId' => $ben->id]], 'type' => 'feedback']);

        $this->actingAs($ben)->getJson('/portal/files/workflows?scope=inbox&type=feedback')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.file.name', 'Invoice.txt');

        $this->actingAs($ben)->getJson('/portal/files/workflows?scope=inbox&q=Contr')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.file.name', 'Contract.txt');
    }

    /* ── comments ─────────────────────────────────────────────── */

    public function test_the_comments_list_shows_threads_that_name_you(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $res = $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=mine')->assertOk();

        $res->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.mentionsMe', true)
            ->assertJsonPath('items.0.author.name', 'Ada Admin')
            ->assertJsonPath('items.0.file.name', 'Contract.txt')
            ->assertJsonPath('items.0.resolved', false)
            ->assertJsonPath('counts.mentions', 1);

        // Ben can answer it, and the thread it belongs to is named so the reply
        // lands on that thread rather than starting a new one.
        $this->assertTrue($res->json('items.0.can.reply'));
        $this->assertSame($res->json('items.0.id'), $res->json('items.0.threadId'));
    }

    /** Resolving a thread takes its mention off the badge. */
    public function test_resolving_a_thread_clears_the_mention_count(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $comment = $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben — thoughts?',
            'mentions' => [$ben->id],
        ])->assertCreated()->json();

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/comments/{$comment['id']}/resolve", ['resolved' => true])
            ->assertOk();

        $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=mine')
            ->assertOk()
            ->assertJsonPath('counts.mentions', 0);

        // And it drops out of the open-threads tab, while staying findable.
        $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=unresolved')
            ->assertOk()
            ->assertJsonCount(0, 'items');

        $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=mine')
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.resolved', true);
    }

    public function test_a_comment_on_a_file_you_cannot_open_is_never_listed(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $cara = $this->user('Reviewing Officer', 'cara@example.com', 'Cara Staff');

        $secret = $this->privateFile($ada, 'Payroll.txt');

        $this->actingAs($ada)->postJson("/portal/files/files/{$secret->uuid}/comments", [
            'body' => 'Numbers look off.',
        ])->assertCreated();

        $names = collect($this->actingAs($cara)->getJson('/portal/files/workflows/comments?scope=all')
            ->assertOk()->json('items'))->pluck('file.name');

        $this->assertNotContains('Payroll.txt', $names);
    }

    /** The Workflows section is staff tooling; a generic client has no page for it. */
    public function test_the_workflows_page_is_closed_to_clients(): void
    {
        $client = $this->user('Client', 'cliff@example.com', 'Cliff Client');

        $this->actingAs($client)->get('/workflows')->assertNotFound();
        $this->actingAs($client)->get('/workflows/feedback')->assertNotFound();
        $this->actingAs($client)->get('/workflows/updates')->assertNotFound();
    }

    /* ── updates required ─────────────────────────────────────── */

    /**
     * @return array{0: CipDocument, 1: CipApplication, 2: FileItem}
     */
    private function cipUpdateRequired(User $staff, string $reason = 'Please rescan the stamp.'): array
    {
        config(['services.cip.enabled' => true]);

        $provider = CipProvider::create([
            'name' => 'Private clients',
            'code' => 'PRI'.substr(uniqid(), -4),
        ]);
        $client = Client::create([
            'uid' => 'asem-'.uniqid(),
            'name' => 'Asem Habtoor',
            'created_by' => $staff->id,
            'data' => [],
        ]);
        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Asem',
            'last_name' => 'Habtoor',
        ]);
        $document = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => DocumentTypes::label(DocumentTypes::BIRTH_CERTIFICATE),
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Birth certificate.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/birth-'.uniqid().'.pdf',
            'owner_id' => $staff->id,
            'uploaded_by' => $staff->id,
            'review_status' => DocumentStatus::UPDATE_REQUIRED,
            'review_note' => $reason,
        ]);
        $document->forceFill([
            'file_id' => $file->id,
            'status' => DocumentStatus::UPDATE_REQUIRED,
            'status_changed_at' => now(),
        ])->save();
        DocumentComments::create($document->fresh(), $staff, $reason);

        return [$document->fresh(), $application->fresh(), $file->fresh()];
    }

    public function test_updates_required_lists_the_reason_on_cip_documents(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $this->cipUpdateRequired($ada, 'The stamp is not visible.');

        $res = $this->actingAs($ada)->getJson('/portal/files/workflows/updates')->assertOk();

        $res->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.label', 'Birth certificate')
            ->assertJsonPath('items.0.reason', 'The stamp is not visible.')
            ->assertJsonPath('items.0.person', 'Asem Habtoor')
            ->assertJsonPath('items.0.file.name', 'Birth certificate.pdf')
            ->assertJsonPath('items.0.status', DocumentStatus::UPDATE_REQUIRED)
            ->assertJsonPath('counts.updates', 1);

        $this->actingAs($ada)->get('/workflows/updates')->assertOk();
    }

    public function test_updates_required_is_scoped_to_applications_the_officer_holds(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Reviewing Officer', 'cara@example.com', 'Cara Staff');
        [, $application] = $this->cipUpdateRequired($ada);

        CipApplicationAssignment::create([
            'application_id' => $application->id,
            'user_id' => $ben->id,
            'role' => CipAccess::REVIEWING_OFFICER,
            'status' => CipApplicationAssignment::STATUS_ACTIVE,
            'assigned_by' => $ada->id,
            'starts_at' => now(),
        ]);

        $this->actingAs($ben)->getJson('/portal/files/workflows/updates')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('counts.updates', 1);

        $this->actingAs($cara)->getJson('/portal/files/workflows/updates')
            ->assertOk()
            ->assertJsonCount(0, 'items')
            ->assertJsonPath('counts.updates', 0);
    }

    public function test_a_provider_contact_sees_updates_required_on_their_firm_files(): void
    {
        config(['services.cip.enabled' => true]);

        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $company = Company::create(['uid' => 'gal-firm', 'name' => 'Galaxy Firm']);
        $gil = $this->user('Client', 'gil@example.com', 'Gil Contact');
        CompanyMember::create([
            'company_id' => $company->id,
            'user_id' => $gil->id,
            'name' => $gil->name,
            'email' => $gil->email,
            'role' => 'member',
            'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        $provider = CipProvider::create([
            'name' => 'Galaxy Provider', 'code' => 'GAL', 'company_id' => $company->id,
        ]);

        $client = Client::create([
            'uid' => 'chen-'.uniqid(), 'name' => 'Chen Wei',
            'created_by' => $ada->id, 'data' => [],
        ]);
        $application = Applications::create($provider, $ada, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen',
            'last_name' => 'Wei',
        ]);
        $document = CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::PASSPORT_BIO_PAGE,
            'label' => DocumentTypes::label(DocumentTypes::PASSPORT_BIO_PAGE),
        ]);
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Passport.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 512,
            'disk' => 'local',
            'storage_path' => 'vault/passport-'.uniqid().'.pdf',
            'owner_id' => $ada->id,
            'uploaded_by' => $ada->id,
            'review_status' => DocumentStatus::UPDATE_REQUIRED,
            'review_note' => 'Crop the edges.',
        ]);
        $document->forceFill([
            'file_id' => $file->id,
            'status' => DocumentStatus::UPDATE_REQUIRED,
            'status_changed_at' => now(),
        ])->save();
        DocumentComments::create($document->fresh(), $ada, 'Crop the edges.');

        $this->actingAs($gil)->get('/workflows/updates')->assertOk();
        $this->actingAs($gil)->getJson('/portal/files/workflows/updates')
            ->assertOk()
            ->assertJsonCount(1, 'items')
            ->assertJsonPath('items.0.reason', 'Crop the edges.')
            ->assertJsonPath('items.0.label', 'Passport bio page');
    }

    public function test_updates_required_can_be_searched_by_document_label(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $this->cipUpdateRequired($ada);

        $this->actingAs($ada)->getJson('/portal/files/workflows/updates?q=Birth')
            ->assertOk()
            ->assertJsonCount(1, 'items');

        $this->actingAs($ada)->getJson('/portal/files/workflows/updates?q=Invoice')
            ->assertOk()
            ->assertJsonCount(0, 'items');
    }
}
