<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Version history.
 *
 * The property most of these tests exist to defend: a new version never
 * destroys an old one — not its row, and not its bytes.
 */
class FileVersionTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-versions-'.uniqid();
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

    private function user(string $type = 'Administrator', string $email = 'a@example.com', string $name = 'Ada Admin'): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    /** Upload a real file through the real endpoint, so v1 is created the way it is in production. */
    private function uploadFile(User $user, string $content = 'version one'): FileItem
    {
        $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('Brief.txt', $content),
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    private function addVersion(User $user, FileItem $file, string $content, ?string $note = null): void
    {
        $this->actingAs($user)->post("/portal/files/files/{$file->uuid}/versions", array_filter([
            'file' => UploadedFile::fake()->createWithContent('Brief.txt', $content),
            'note' => $note,
        ]))->assertCreated();
    }

    public function test_uploading_a_file_records_version_one(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user);

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();

        $this->assertCount(1, $res->json('versions'));
        $res->assertJsonPath('versions.0.number', 1)
            ->assertJsonPath('versions.0.isCurrent', true)
            ->assertJsonPath('current', 1);
    }

    public function test_a_new_version_becomes_current_and_the_old_one_survives(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');

        $this->addVersion($user, $file, 'version two', 'Client asked for clause 4 to change');

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();

        // Newest first.
        $res->assertJsonPath('versions.0.number', 2)
            ->assertJsonPath('versions.0.isCurrent', true)
            ->assertJsonPath('versions.0.note', 'Client asked for clause 4 to change')
            ->assertJsonPath('versions.1.number', 1)
            ->assertJsonPath('versions.1.isCurrent', false);

        $this->assertSame(2, $file->fresh()->version_number);
    }

    /**
     * The single most important guarantee: the previous version's BYTES are
     * still on disk and still readable. A history that lists a version it can
     * no longer produce is worse than no history.
     */
    public function test_the_previous_versions_bytes_are_never_deleted(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');

        $v1 = FileVersion::where('file_id', $file->id)->first();
        $v1Path = $v1->storage_path;
        $this->assertFileExists($this->vaultRoot.'/'.$v1Path);

        $this->addVersion($user, $file, 'version two');

        // Same path, still there, and still holding v1's content.
        $this->assertFileExists($this->vaultRoot.'/'.$v1Path, 'v1 bytes were deleted by the v2 upload');
        $this->assertSame('version one', file_get_contents($this->vaultRoot.'/'.$v1Path));

        // And the file now points somewhere else entirely.
        $this->assertNotSame($v1Path, $file->fresh()->storage_path);
    }

    public function test_an_older_version_can_be_downloaded_and_previewed(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');
        $this->addVersion($user, $file, 'version two');

        $v1 = FileVersion::where('file_id', $file->id)->where('version_number', 1)->first();

        $download = $this->actingAs($user)
            ->get("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/download")
            ->assertOk();
        $this->assertSame('version one', $download->streamedContent());
        $this->assertStringContainsString('Brief (v1).txt', $download->headers->get('content-disposition'));

        $preview = $this->actingAs($user)
            ->get("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/preview")
            ->assertOk();
        $this->assertSame('version one', $preview->streamedContent());

        // The file itself still serves v2.
        $current = $this->actingAs($user)->get("/portal/files/files/{$file->uuid}/download")->assertOk();
        $this->assertSame('version two', $current->streamedContent());
    }

    /**
     * Restoring must APPEND. Rewinding by deleting v2 and v3 would silently
     * destroy work — §5 is explicit that later history stays.
     */
    public function test_restoring_appends_a_new_version_and_keeps_later_history(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');
        $this->addVersion($user, $file, 'version two');
        $this->addVersion($user, $file, 'version three');

        $v1 = FileVersion::where('file_id', $file->id)->where('version_number', 1)->first();

        $this->actingAs($user)
            ->postJson("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/restore")
            ->assertOk()
            ->assertJsonPath('version', 4)
            ->assertJsonPath('restoredFrom', 1);

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();

        // Four versions: nothing was rewound.
        $this->assertSame([4, 3, 2, 1], array_column($res->json('versions'), 'number'));
        $res->assertJsonPath('versions.0.isCurrent', true)
            ->assertJsonPath('versions.0.restoredFrom', 1);

        // The restored content is really v1's.
        $this->assertSame('version one',
            $this->actingAs($user)->get("/portal/files/files/{$file->uuid}/download")->streamedContent());

        // v3's bytes are still retrievable too.
        $v3 = FileVersion::where('file_id', $file->id)->where('version_number', 3)->first();
        $this->assertSame('version three',
            $this->actingAs($user)->get("/portal/files/files/{$file->uuid}/versions/{$v3->uuid}/download")->streamedContent());
    }

    public function test_a_restore_gets_its_own_bytes_not_a_shared_pointer(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');
        $this->addVersion($user, $file, 'version two');

        $v1 = FileVersion::where('file_id', $file->id)->where('version_number', 1)->first();
        $this->actingAs($user)->postJson("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/restore")->assertOk();

        $v3 = FileVersion::where('file_id', $file->id)->where('version_number', 3)->first();

        // Same content, different blob — so purging either can never blank the other.
        $this->assertNotSame($v1->storage_path, $v3->storage_path);
        $this->assertFileExists($this->vaultRoot.'/'.$v1->storage_path);
        $this->assertFileExists($this->vaultRoot.'/'.$v3->storage_path);
    }

    public function test_restoring_the_current_version_is_refused(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user);
        $current = FileVersion::where('file_id', $file->id)->where('is_current', true)->first();

        $this->actingAs($user)
            ->postJson("/portal/files/files/{$file->uuid}/versions/{$current->uuid}/restore")
            ->assertStatus(422);
    }

    public function test_a_version_note_can_be_amended_afterwards(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user);
        $v1 = FileVersion::where('file_id', $file->id)->first();

        $this->actingAs($user)
            ->patchJson("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}", ['note' => 'Original signed copy'])
            ->assertOk()
            ->assertJsonPath('note', 'Original signed copy');
    }

    public function test_versions_appear_in_the_activity_timeline(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user);
        $this->addVersion($user, $file, 'two', 'Second draft');

        $v1 = FileVersion::where('file_id', $file->id)->where('version_number', 1)->first();
        $this->actingAs($user)->postJson("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/restore");

        $res = $this->actingAs($user)
            ->getJson("/portal/files/files/{$file->uuid}/activity?filter=versions")->assertOk();

        $actions = array_column($res->json('entries'), 'action');
        $this->assertContains('version', $actions);
        $this->assertContains('version-restored', $actions);
        $this->assertContains('upload', $actions);
    }

    public function test_comments_survive_a_new_version(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user);

        $this->actingAs($user)
            ->postJson("/portal/files/files/{$file->uuid}/comments", ['body' => 'Please check clause 4'])
            ->assertCreated();

        $this->addVersion($user, $file, 'two');

        // The discussion is about the file, not about one revision of it.
        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $this->assertCount(1, $res->json('threads'));
        $this->assertSame('Please check clause 4', $res->json('threads.0.body'));
    }

    public function test_a_viewer_cannot_add_or_restore_a_version(): void
    {
        $owner = $this->user('Reviewing Officer', 'owner@example.com', 'Olive Owner');
        $guest = $this->user('Reviewing Officer', 'guest@example.com', 'Gus Guest');
        $file = $this->uploadFile($owner);

        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id, 'shared_by' => $owner->id,
            'kind' => 'user', 'target_user_id' => $guest->id, 'role' => 'viewer',
        ]);

        // They can read the history…
        $res = $this->actingAs($guest)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();
        $res->assertJsonPath('canAddVersion', false);

        // …but not change it.
        $this->actingAs($guest)->post("/portal/files/files/{$file->uuid}/versions", [
            'file' => UploadedFile::fake()->createWithContent('Brief.txt', 'sneaky'),
        ])->assertForbidden();

        $v1 = FileVersion::where('file_id', $file->id)->first();
        $this->actingAs($guest)
            ->postJson("/portal/files/files/{$file->uuid}/versions/{$v1->uuid}/restore")
            ->assertForbidden();
    }

    public function test_a_stranger_cannot_read_version_history(): void
    {
        $owner = $this->user('Reviewing Officer', 'owner@example.com', 'Olive Owner');
        // A client: colleagues can read firm-wide files by default now.
        $stranger = $this->user('Client', 'stranger@example.com', 'Sam Stranger');
        $file = $this->uploadFile($owner);

        $this->actingAs($stranger)->getJson("/portal/files/files/{$file->uuid}/versions")->assertForbidden();
    }

    public function test_a_version_uuid_from_another_file_is_not_reachable(): void
    {
        $user = $this->user();
        $fileA = $this->uploadFile($user, 'A');
        $fileB = $this->uploadFile($user, 'B');

        $versionOfA = FileVersion::where('file_id', $fileA->id)->first();

        $this->actingAs($user)
            ->get("/portal/files/files/{$fileB->uuid}/versions/{$versionOfA->uuid}/download")
            ->assertNotFound();
    }

    /** Large files can only reach a version through the chunked session. */
    public function test_a_chunked_upload_can_target_an_existing_file_as_a_new_version(): void
    {
        $user = $this->user();
        $file = $this->uploadFile($user, 'version one');

        $init = $this->actingAs($user)->postJson('/portal/files/uploads', [
            'filename' => 'Brief.txt',
            'size' => strlen('chunked version two'),
            'versionOf' => $file->uuid,
            'versionNote' => 'Uploaded in chunks',
        ])->assertCreated();

        $session = $init->json('id');

        $this->actingAs($user)->post("/portal/files/uploads/{$session}/chunk", [
            'index' => 0,
            'chunk' => UploadedFile::fake()->createWithContent('blob', 'chunked version two'),
        ])->assertOk();

        $this->actingAs($user)->postJson("/portal/files/uploads/{$session}/complete")->assertCreated();

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();
        $res->assertJsonPath('versions.0.number', 2)
            ->assertJsonPath('versions.0.note', 'Uploaded in chunks');

        $this->assertSame('chunked version two',
            $this->actingAs($user)->get("/portal/files/files/{$file->uuid}/download")->streamedContent());

        // The name was NOT changed by the version upload.
        $this->assertSame('Brief.txt', $file->fresh()->name);
    }

    public function test_a_file_uploaded_before_versioning_gets_v1_lazily(): void
    {
        $user = $this->user();

        // A row created directly, as pre-versioning code would have.
        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Legacy.txt', 'extension' => 'txt',
            'mime_type' => 'text/plain', 'size' => 5, 'disk' => 'local',
            'storage_path' => 'vault/legacy.txt', 'owner_id' => $user->id, 'uploaded_by' => $user->id,
        ]);
        Storage::disk('local')->put('vault/legacy.txt', 'old!!');

        $this->assertSame(0, FileVersion::where('file_id', $file->id)->count());

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/versions")->assertOk();

        $res->assertJsonPath('versions.0.number', 1)
            ->assertJsonPath('versions.0.isCurrent', true);
    }
}
