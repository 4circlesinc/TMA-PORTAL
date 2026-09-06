<?php

namespace Tests\Feature;

use App\Models\CbiApplication;
use App\Models\CbiApplicationSource;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\SmartsheetAttachment;
use App\Models\SmartsheetSheet;
use App\Models\User;
use App\Support\Cbi\DocumentImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Filing a citizenship file's paperwork under the right client.
 *
 * Smartsheet is faked throughout: what matters here is the chain from an
 * attachment to a client's folder, and that a document never lands in the
 * wrong person's folder or twice in the right one.
 */
class CbiDocumentImportTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        config()->set('filesystems.files_disk', 'local');
        config()->set('services.smartsheet.token', 'test-token');

        $this->admin = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
        ]);
    }

    /** An application with a client, a feeding sheet row, and an attachment on it. */
    private function paperwork(string $applicantName, string $fileName, int $rowId = 900): SmartsheetAttachment
    {
        $client = Client::create([
            'uid' => str($applicantName)->slug()->value(),
            'name' => $applicantName,
            'data' => [],
        ]);

        $application = CbiApplication::create([
            'dedupe_key' => 'k'.uniqid('', true),
            'applicant_name' => $applicantName,
            'stage' => 'applications',
            'client_id' => $client->id,
        ]);

        $sheet = SmartsheetSheet::create([
            'remote_id' => $rowId * 10,
            'name' => 'Tracker',
            'status' => 'ok',
        ]);

        CbiApplicationSource::create([
            'application_id' => $application->id,
            'sheet_remote_id' => $sheet->remote_id,
            'row_remote_id' => $rowId,
            'sheet_name' => 'Tracker',
        ]);

        return SmartsheetAttachment::create([
            'sheet_id' => $sheet->id,
            'remote_id' => $rowId * 100,
            'parent_type' => 'ROW',
            'parent_remote_id' => $rowId,
            'name' => $fileName,
            'mime_type' => 'application/pdf',
            'attachment_type' => 'FILE',
            'size_kb' => 12,
        ]);
    }

    /**
     * Closures, not response instances: a stub built once is a single PSR
     * response whose body stream the first read consumes, so the second
     * download in a run would arrive empty. Real requests always get a fresh
     * stream; only the fake needs telling.
     */
    private function fakeSmartsheet(string $body = 'PDF-BYTES'): void
    {
        Http::fake([
            '*/attachments/*' => fn () => Http::response(['url' => 'https://s3.example.test/signed/doc.pdf']),
            's3.example.test/*' => fn () => Http::response($body, 200),
        ]);
    }

    public function test_a_document_lands_in_its_own_client_folder(): void
    {
        $attachment = $this->paperwork('Ada Lovelace', 'passport.pdf');
        $this->fakeSmartsheet();

        $importer = new DocumentImporter($this->admin);
        $importer->import();

        $this->assertSame(1, $importer->stats['imported']);

        $file = FileItem::where('name', 'passport.pdf')->firstOrFail();
        $client = Client::where('name', 'Ada Lovelace')->firstOrFail();

        // Filed in this client's folder, not loose in the library.
        $this->assertNotNull($client->fresh()->folder_id);
        $this->assertSame($client->fresh()->folder_id, $file->folder_id);
        // And the attachment now points at it, which is what makes a re-run safe.
        $this->assertSame($file->id, $attachment->fresh()->file_id);
    }

    public function test_the_bytes_are_actually_stored(): void
    {
        $this->paperwork('Grace Hopper', 'report.pdf');
        $this->fakeSmartsheet('THE-REAL-BYTES');

        (new DocumentImporter($this->admin))->import();

        $file = FileItem::firstOrFail();
        $this->assertGreaterThan(0, $file->size);
        Storage::disk('local')->assertExists($file->storage_path);
        $this->assertSame('THE-REAL-BYTES', $this->plaintextOnDisk('local', $file->storage_path));
    }

    public function test_running_it_again_imports_nothing_new(): void
    {
        $this->paperwork('Ada Lovelace', 'passport.pdf');
        $this->fakeSmartsheet();

        (new DocumentImporter($this->admin))->import();
        $second = new DocumentImporter($this->admin);
        $second->import();

        $this->assertSame(0, $second->stats['imported']);
        $this->assertSame(1, FileItem::count());
    }

    public function test_two_clients_documents_do_not_cross(): void
    {
        $this->paperwork('Ada Lovelace', 'passport.pdf', 901);
        $this->paperwork('Grace Hopper', 'passport.pdf', 902);
        $this->fakeSmartsheet();

        (new DocumentImporter($this->admin))->import();

        $ada = Client::where('name', 'Ada Lovelace')->firstOrFail()->fresh();
        $grace = Client::where('name', 'Grace Hopper')->firstOrFail()->fresh();

        $this->assertNotSame($ada->folder_id, $grace->folder_id);
        $this->assertSame(1, FileItem::where('folder_id', $ada->folder_id)->count());
        $this->assertSame(1, FileItem::where('folder_id', $grace->folder_id)->count());
    }

    public function test_two_documents_of_the_same_name_both_survive(): void
    {
        $attachment = $this->paperwork('Ada Lovelace', 'scan.pdf', 903);
        // A second attachment on the same row: same filename, different file.
        SmartsheetAttachment::create([
            'sheet_id' => $attachment->sheet_id,
            'remote_id' => 99999,
            'parent_type' => 'ROW',
            'parent_remote_id' => $attachment->parent_remote_id,
            'name' => 'scan.pdf',
            'attachment_type' => 'FILE',
            'size_kb' => 8,
        ]);
        $this->fakeSmartsheet();

        (new DocumentImporter($this->admin))->import();

        $this->assertSame(2, FileItem::count());
        $names = FileItem::pluck('name')->sort()->values()->all();
        $this->assertSame(['scan (2).pdf', 'scan.pdf'], $names);
    }

    public function test_an_attachment_with_no_client_is_left_alone(): void
    {
        // A sheet row that feeds no application at all.
        $sheet = SmartsheetSheet::create(['remote_id' => 5000, 'name' => 'Orphans', 'status' => 'ok']);
        $orphan = SmartsheetAttachment::create([
            'sheet_id' => $sheet->id,
            'remote_id' => 5001,
            'parent_type' => 'ROW',
            'parent_remote_id' => 777,
            'name' => 'nobody.pdf',
            'attachment_type' => 'FILE',
            'size_kb' => 3,
        ]);
        $this->fakeSmartsheet();

        $importer = new DocumentImporter($this->admin);
        $importer->import();

        $this->assertSame(0, $importer->stats['imported']);
        $this->assertSame(0, FileItem::count());
        // Untouched, so a later sync that connects the row still brings it in.
        $this->assertNull($orphan->fresh()->file_id);
    }

    public function test_a_failed_download_is_retried_next_run_not_recorded_as_done(): void
    {
        $attachment = $this->paperwork('Ada Lovelace', 'passport.pdf');
        Http::fake([
            '*/attachments/*' => fn () => Http::response(['url' => 'https://s3.example.test/signed/doc.pdf']),
            's3.example.test/*' => fn () => Http::response('', 500),
        ]);

        $importer = new DocumentImporter($this->admin);
        $importer->import();

        $this->assertSame(1, $importer->stats['failed']);
        $this->assertSame(0, FileItem::count());
        $this->assertNull($attachment->fresh()->file_id);
    }

    public function test_the_limit_is_respected_and_the_rest_waits(): void
    {
        $this->paperwork('A One', 'a.pdf', 911);
        $this->paperwork('B Two', 'b.pdf', 912);
        $this->paperwork('C Three', 'c.pdf', 913);
        $this->fakeSmartsheet();

        $importer = new DocumentImporter($this->admin);
        $importer->import(2);

        $this->assertSame(2, $importer->stats['imported']);
        $this->assertSame(1, SmartsheetAttachment::whereNull('file_id')->count());
    }

    public function test_a_dry_run_stores_nothing(): void
    {
        $this->paperwork('Ada Lovelace', 'passport.pdf');
        $this->fakeSmartsheet();

        $importer = new DocumentImporter($this->admin, dryRun: true);
        $importer->import();

        $this->assertSame(1, $importer->stats['imported']);
        $this->assertSame(0, FileItem::count());
    }

    public function test_the_survey_counts_what_is_waiting(): void
    {
        $this->paperwork('Ada Lovelace', 'passport.pdf', 921);
        $this->paperwork('Grace Hopper', 'report.pdf', 922);

        $survey = (new DocumentImporter($this->admin))->survey();

        $this->assertSame(2, $survey['files']);
        $this->assertSame(0, $survey['orphaned']);
        $this->assertSame(2, $survey['clients']);
        $this->assertSame(0, $survey['done']);
    }
}
