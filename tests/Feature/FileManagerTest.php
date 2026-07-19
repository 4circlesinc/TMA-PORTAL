<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class FileManagerTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        // Isolate the file vault to a throwaway temp dir for the test run.
        $this->vaultRoot = sys_get_temp_dir().'/tma-vault-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config(['filesystems.disks.local.root' => $this->vaultRoot]);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    private function approvedUser(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    public function test_create_folder_and_subfolder_returns_uuid_without_storage_path(): void
    {
        $user = $this->approvedUser();

        $res = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Projects']);
        $res->assertCreated()->assertJsonPath('name', 'Projects');
        $this->assertNotEmpty($res->json('id'));
        $this->assertArrayNotHasKey('storage_path', $res->json());

        $parent = $res->json('id');
        $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Alpha', 'parent' => $parent])
            ->assertCreated()->assertJsonPath('parent.name', 'Projects');
    }

    public function test_circular_move_is_rejected(): void
    {
        $user = $this->approvedUser();
        $root = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Root'])->json('id');
        $child = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Child', 'parent' => $root])->json('id');

        $this->actingAs($user)->postJson("/portal/files/folders/{$root}/move", ['target' => $child])
            ->assertStatus(422)
            ->assertJsonPath('message', 'A folder can’t be moved into one of its own subfolders.');
    }

    public function test_duplicate_folder_name_is_rejected(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Docs'])->assertCreated();
        $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'docs'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'A folder with that name already exists here.');
    }

    public function test_direct_upload_then_browse_lists_the_file(): void
    {
        $user = $this->approvedUser();
        $file = UploadedFile::fake()->createWithContent('report.pdf', '%PDF-1.4 fake');

        $this->actingAs($user)->post('/portal/files/files', ['file' => $file])
            ->assertCreated()->assertJsonPath('name', 'report.pdf');

        $browse = $this->actingAs($user)->getJson('/portal/files/?section=filebox');
        $browse->assertOk()->assertJsonPath('files.0.name', 'report.pdf');
        $this->assertStringNotContainsString('vault/', json_encode($browse->json()));
    }

    public function test_recent_includes_file_box_files_not_only_foldered_ones(): void
    {
        $user = $this->approvedUser();

        // A loose file in the File Box (folder_id null) and one inside a folder.
        $this->actingAs($user)->post('/portal/files/files', ['file' => UploadedFile::fake()->createWithContent('loose.pdf', '%PDF-1.4 a')])->assertCreated();
        $folder = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Docs'])->json('id');
        $this->actingAs($user)->post('/portal/files/files', ['file' => UploadedFile::fake()->createWithContent('filed.pdf', '%PDF-1.4 b'), 'folder' => $folder])->assertCreated();

        $names = collect($this->actingAs($user)->getJson('/portal/files/?section=recent')->assertOk()->json('files'))
            ->pluck('name');

        // Regression: `folder_id NOT IN (...)` used to drop every File Box file
        // because NULL is never "not in" a set.
        $this->assertTrue($names->contains('loose.pdf'), 'File Box file must appear in Recent Files');
        $this->assertTrue($names->contains('filed.pdf'), 'Foldered file must appear in Recent Files');
    }

    public function test_duplicate_upload_keep_both_appends_counter(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->post('/portal/files/files', ['file' => UploadedFile::fake()->createWithContent('a.txt', 'one')])->assertCreated();

        $res = $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('a.txt', 'two'),
            'conflict' => 'keep-both',
        ]);
        $res->assertCreated()->assertJsonPath('name', 'a (1).txt');
    }

    public function test_executable_extension_is_rejected_with_specific_message(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('evil.php', '<?php echo 1;'),
        ])->assertStatus(422)->assertJsonPath('message', 'That file type is not allowed for security reasons.');
    }

    public function test_mime_spoofed_image_is_rejected(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('photo.jpg', '<?php system($_GET[0]); ?>'),
        ])->assertStatus(422);
    }

    public function test_delete_folder_recycles_its_files_without_purging_bytes(): void
    {
        $user = $this->approvedUser();
        $folderUuid = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Box2'])->json('id');
        $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('inside.txt', 'hi'),
            'folder' => $folderUuid,
        ])->assertCreated();

        $fileRow = FileItem::first();
        $this->assertFileExists($this->vaultRoot.'/'.$fileRow->storage_path);

        // Delete the folder → folder + file soft-deleted, bytes intact.
        $this->actingAs($user)->deleteJson("/portal/files/folders/{$folderUuid}")->assertOk();
        $this->assertTrue(FileItem::withTrashed()->find($fileRow->id)->trashed());
        $this->assertFileExists($this->vaultRoot.'/'.$fileRow->storage_path);

        // Restore folder → file comes back.
        $this->actingAs($user)->postJson("/portal/files/folders/{$folderUuid}/restore")->assertOk();
        $this->assertNull(FileItem::find($fileRow->id)->deleted_at);
    }

    public function test_recycle_then_permanent_delete_removes_bytes(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->post('/portal/files/files', ['file' => UploadedFile::fake()->createWithContent('t.txt', 'x')])->assertCreated();
        $file = FileItem::first();
        $path = $this->vaultRoot.'/'.$file->storage_path;

        $this->actingAs($user)->deleteJson("/portal/files/files/{$file->uuid}")->assertOk();
        $this->actingAs($user)->getJson('/portal/files/?section=recycle')->assertJsonPath('files.0.name', 't.txt');

        $this->actingAs($user)->deleteJson("/portal/files/files/{$file->uuid}/force")->assertOk();
        $this->assertFileDoesNotExist($path);
        $this->assertNull(FileItem::withTrashed()->find($file->id));
    }

    public function test_favourite_toggle_shows_in_favourites(): void
    {
        $user = $this->approvedUser();
        $uuid = $this->actingAs($user)->postJson('/portal/files/folders', ['name' => 'Fav'])->json('id');

        $this->actingAs($user)->postJson('/portal/files/favorites/toggle', ['type' => 'folder', 'id' => $uuid])
            ->assertOk()->assertJsonPath('favorite', true);

        $this->actingAs($user)->getJson('/portal/files/?section=favorites')->assertJsonPath('folders.0.name', 'Fav');
    }

    public function test_non_owner_cannot_see_or_modify_another_users_file(): void
    {
        $owner = $this->approvedUser();
        $other = $this->approvedUser();

        $this->actingAs($owner)->post('/portal/files/files', ['file' => UploadedFile::fake()->createWithContent('secret.txt', 'x')])->assertCreated();
        $file = FileItem::first();

        // Not listed for the other user.
        $this->actingAs($other)->getJson('/portal/files/?section=all')->assertJsonCount(0, 'files');

        // Direct calls are forbidden, not just hidden.
        $this->actingAs($other)->deleteJson("/portal/files/files/{$file->uuid}")->assertStatus(403);
        $this->actingAs($other)->patchJson("/portal/files/files/{$file->uuid}", ['name' => 'hacked.txt'])->assertStatus(403);
        $this->actingAs($other)->get("/portal/files/files/{$file->uuid}/download")->assertStatus(403);
    }

    public function test_chunked_upload_pipeline_creates_file_only_after_complete(): void
    {
        $user = $this->approvedUser();

        $init = $this->actingAs($user)->postJson('/portal/files/uploads', [
            'filename' => 'notes.txt', 'size' => 5, 'chunkSize' => 1024 * 1024,
        ]);
        $init->assertCreated();
        $id = $init->json('id');
        $this->assertSame(1, $init->json('totalChunks'));
        $this->assertSame(0, FileItem::count()); // nothing yet

        $this->actingAs($user)->post("/portal/files/uploads/{$id}/chunk", [
            'index' => 0,
            'chunk' => UploadedFile::fake()->createWithContent('c', 'hello'),
        ])->assertOk();
        $this->assertSame(0, FileItem::count()); // still nothing until complete

        $this->actingAs($user)->postJson("/portal/files/uploads/{$id}/complete")
            ->assertCreated()->assertJsonPath('name', 'notes.txt');
        $this->assertSame(1, FileItem::count());
    }

    public function test_oversized_upload_init_is_rejected(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->postJson('/portal/files/uploads', [
            'filename' => 'huge.zip', 'size' => (2 * 1024 * 1024 * 1024) + 1,
        ])->assertStatus(422)->assertJsonPath('message', 'File exceeds the 2 GB limit.');
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }
}
