<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\SignatureField;
use App\Models\SignatureRecipient;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Files\Workflow\Status;
use App\Support\Signatures\Sender;
use App\Support\Signatures\Status as SigStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Signature requests seen from the File Library.
 *
 * The signing engine is not re-tested here — it has its own suite. What these
 * cover is the mirror: that a request made against a library file shows up on
 * that file with the right status, that the signed copy is a proper library
 * file, and that the original is never touched.
 */
class FileSignatureBridgeTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->vaultRoot = sys_get_temp_dir().'/tma-sig-'.uniqid();
        @mkdir($this->vaultRoot.'/vault', 0775, true);
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

    private function user(string $type = 'Administrator', string $email = 'ada@example.com'): User
    {
        $u = User::create(['name' => 'Ada Admin', 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    /** A real PDF, because the stamper refuses anything it cannot parse. */
    private function pdfFile(User $owner): FileItem
    {
        copy(base_path('tests/Browser/fixtures/contract.pdf'), $this->vaultRoot.'/vault/contract.pdf');

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'TMA Contract.pdf', 'extension' => 'pdf',
            'mime_type' => 'application/pdf', 'size' => filesize($this->vaultRoot.'/vault/contract.pdf'),
            'disk' => 'local', 'storage_path' => 'vault/contract.pdf',
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
        \App\Support\Files\Versions::recordInitial($file, $owner->id);

        return $file;
    }

    private function requestFor(User $sender, FileItem $file, string $email = 'dana@example.com'): SignatureRequest
    {
        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $file->id,
            'created_by' => $sender->id,
            'title' => $file->name,
            'status' => SigStatus::DRAFT,
        ]);

        $recipient = SignatureRecipient::create([
            'uuid' => (string) Str::uuid(),
            'signature_request_id' => $request->id,
            'name' => 'Dana Reed',
            'email' => $email,
            'role' => 'signer',
            'signing_order' => 1,
            'status' => 'pending',
        ]);

        SignatureField::create([
            'uuid' => (string) Str::uuid(),
            'signature_request_id' => $request->id,
            'signature_recipient_id' => $recipient->id,
            'type' => 'signature',
            'page' => 1, 'x' => 0.2, 'y' => 0.7, 'width' => 0.3, 'height' => 0.08,
            'required' => true,
        ]);

        return $request->fresh();
    }

    public function test_sending_for_signature_shows_on_the_file_as_awaiting_signature(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);

        Sender::send($request, $admin->id);

        $workflow = FileWorkflow::where('file_id', $file->id)->first();
        $this->assertNotNull($workflow, 'the request should mirror onto the file');
        $this->assertSame(Status::TYPE_SIGNATURE, $workflow->type);
        $this->assertSame(Status::AWAITING_SIGNATURE, $workflow->status);
        $this->assertSame($request->id, $workflow->signature_request_id);
        // Pinned to the version that was sent, like every other request type.
        $this->assertSame(1, $workflow->version->version_number);

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();
        $this->assertSame('Awaiting signature', $res->json('badge.label'));
        $this->assertSame('Dana Reed', $res->json('workflows.0.steps.0.name'));
        $this->assertSame('Waiting', $res->json('workflows.0.steps.0.statusLabel'));
    }

    public function test_the_viewer_reflects_progress_without_the_engine_pushing_to_it(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);
        Sender::send($request, $admin->id);

        // Change the engine's state directly, as a signing action would, WITHOUT
        // calling the bridge — the read path must still be correct.
        $request->fresh()->forceFill(['status' => SigStatus::IN_PROGRESS])->save();

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();
        $this->assertSame('Partially signed', $res->json('badge.label'));
    }

    public function test_a_completed_signing_files_the_signed_copy_and_leaves_the_original_alone(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $originalPath = $file->storage_path;
        $originalChecksum = $file->checksum;

        $request = $this->requestFor($admin, $file);
        Sender::send($request, $admin->id);

        // Sign it the way the signing page does.
        $recipient = $request->recipients()->first();
        $field = SignatureField::where('signature_request_id', $request->id)->first();
        $field->update(['value' => 'data:image/png;base64,'.base64_encode('x')]);
        $recipient->forceFill(['status' => 'signed', 'signed_at' => now()])->save();

        Sender::advance($request->fresh());

        $workflow = FileWorkflow::where('file_id', $file->id)->first();
        $this->assertSame(Status::SIGNED, $workflow->status);

        // The original is byte-for-byte untouched.
        $this->assertSame($originalPath, $file->fresh()->storage_path);
        $this->assertSame($originalChecksum, $file->fresh()->checksum);
        $this->assertFileExists($this->vaultRoot.'/'.$originalPath);

        // And the signed copy is a real, separate library file.
        $signed = $request->fresh()->signedFile;
        $this->assertNotNull($signed, 'a signed copy should have been filed');
        $this->assertNotSame($file->id, $signed->id);
        $this->assertStringContainsString('(signed)', $signed->name);

        // Which has version history of its own, like every other file.
        $this->assertSame(1, FileVersion::where('file_id', $signed->id)->count());
        $this->assertSame('Signed copy', FileVersion::where('file_id', $signed->id)->value('note'));
    }

    public function test_the_original_files_timeline_records_the_signing(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);
        Sender::send($request, $admin->id);

        $recipient = $request->recipients()->first();
        SignatureField::where('signature_request_id', $request->id)
            ->update(['value' => 'data:image/png;base64,'.base64_encode('x')]);
        $recipient->forceFill(['status' => 'signed', 'signed_at' => now()])->save();
        Sender::advance($request->fresh());

        $res = $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/activity?filter=signatures")->assertOk();

        $actions = array_column($res->json('entries'), 'action');
        $this->assertContains('signature-sent', $actions);
        $this->assertContains('signed', $actions, 'the document you SENT must show it was signed');

        $texts = array_column($res->json('entries'), 'text');
        $this->assertContains('completed signing this file', $texts);
    }

    public function test_the_signed_output_is_reachable_from_the_workflow(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);
        Sender::send($request, $admin->id);

        SignatureField::where('signature_request_id', $request->id)
            ->update(['value' => 'data:image/png;base64,'.base64_encode('x')]);
        $request->recipients()->first()->forceFill(['status' => 'signed', 'signed_at' => now()])->save();
        Sender::advance($request->fresh());

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();

        $signed = $res->json('workflows.0.signedFile');
        $this->assertNotNull($signed, 'the viewer must be able to reach the signed copy');
        $this->assertStringContainsString('(signed)', $signed['name']);
    }

    public function test_a_declined_signing_shows_as_declined_on_the_file(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);
        Sender::send($request, $admin->id);

        $request->fresh()->forceFill([
            'status' => SigStatus::DECLINED, 'declined_at' => now(),
        ])->save();

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();
        $this->assertSame('Declined', $res->json('badge.label'));
    }

    /** A request built from an upload has no library file to mirror onto. */
    public function test_a_request_without_a_library_file_creates_no_workflow(): void
    {
        $admin = $this->user();

        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => null,
            'created_by' => $admin->id,
            'title' => 'Ad hoc',
            'status' => SigStatus::DRAFT,
        ]);

        $this->assertNull(\App\Support\Files\Workflow\SignatureBridge::sync($request));
        $this->assertSame(0, FileWorkflow::count());
    }

    /**
     * The mirror must never be able to break signing — the engine is the thing
     * that matters, and a broken viewer panel is the lesser failure.
     */
    public function test_a_broken_mirror_does_not_break_sending(): void
    {
        $admin = $this->user();
        $file = $this->pdfFile($admin);
        $request = $this->requestFor($admin, $file);

        // Force the mirror to fail by removing the tables it writes through.
        // Dependency order: events and steps reference workflows.
        \Illuminate\Support\Facades\Schema::drop('file_workflow_events');
        \Illuminate\Support\Facades\Schema::drop('file_workflow_steps');
        \Illuminate\Support\Facades\Schema::drop('file_workflows');

        // Sending still succeeds.
        $tokens = Sender::send($request, $admin->id);
        $this->assertNotEmpty($tokens);
        $this->assertSame(SigStatus::SENT, $request->fresh()->status);
    }
}
