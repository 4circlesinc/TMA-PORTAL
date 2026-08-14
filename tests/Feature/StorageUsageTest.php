<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Settings → Storage → Usage.
 *
 * The page's job is to not under-report: bytes live in old versions, message
 * and Feed attachments and the recycle bin as well as the File Library, and a
 * total that counted only `files` would tell an administrator the account is
 * smaller than it is.
 */
class StorageUsageTest extends TestCase
{
    use RefreshDatabase;

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

    private function folder(User $owner): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Contracts',
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    private function file(User $owner, Folder $folder, string $name, int $size): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'name' => $name,
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => $size,
            'disk' => 'local',
            'storage_path' => 'vault/'.Str::random(8),
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ]);
    }

    private function category(array $body, string $key): array
    {
        foreach ($body['categories'] as $row) {
            if ($row['key'] === $key) {
                return $row;
            }
        }

        $this->fail("No `$key` category in the response.");
    }

    public function test_a_non_administrator_cannot_see_firm_wide_storage(): void
    {
        $this->actingAs($this->user('Reviewing Officer'))
            ->getJson('/admin/storage-usage')
            ->assertForbidden();
    }

    public function test_it_totals_every_place_bytes_are_kept(): void
    {
        $admin = $this->user('Administrator');
        $client = $this->user('Client');
        $folder = $this->folder($admin);

        $this->file($admin, $folder, 'Live.pdf', 1000);
        $this->file($client, $folder, 'Client.pdf', 500);

        // Deleted but not purged: still on disk, still counted.
        $binned = $this->file($admin, $folder, 'Binned.pdf', 300);
        $binned->delete();

        // A superseded version is extra bytes; the current one is the file.
        $current = $this->file($admin, $folder, 'Versioned.pdf', 200);
        foreach ([[1, false, 90], [2, true, 200]] as [$number, $isCurrent, $size]) {
            DB::table('file_versions')->insert([
                'uuid' => (string) Str::uuid(),
                'file_id' => $current->id,
                'version_number' => $number,
                'disk' => 'local',
                'storage_path' => 'vault/v'.$number,
                'size' => $size,
                'is_current' => $isCurrent,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::table('message_attachments')->insert([
            'uuid' => (string) Str::uuid(),
            'disk' => 'local',
            'path' => 'messages/a.png',
            'name' => 'a.png',
            'size' => 40,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('feed_attachments')->insert([
            'uuid' => (string) Str::uuid(),
            'disk' => 'local',
            'path' => 'feed/b.png',
            'name' => 'b.png',
            'size' => 10,
            'status' => 'ready',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $body = $this->actingAs($admin)->getJson('/admin/storage-usage')->assertOk()->json();

        $this->assertSame(1700, $this->category($body, 'files')['bytes']);   // 1000 + 500 + 200
        $this->assertSame(3, $this->category($body, 'files')['count']);
        $this->assertSame(90, $this->category($body, 'versions')['bytes']);
        $this->assertSame(300, $this->category($body, 'bin')['bytes']);
        $this->assertSame(40, $this->category($body, 'messages')['bytes']);
        $this->assertSame(10, $this->category($body, 'feed')['bytes']);
        $this->assertSame(2140, $body['usedBytes']);
    }

    public function test_an_abandoned_upload_counts_only_the_chunks_it_wrote(): void
    {
        $admin = $this->user('Administrator');

        DB::table('upload_sessions')->insert([
            'uuid' => (string) Str::uuid(),
            'user_id' => $admin->id,
            'filename' => 'huge.zip',
            'size' => 10_000,
            'chunk_size' => 1_000,
            'total_chunks' => 10,
            'received_count' => 2,
            'status' => 'uploading',
            'temp_path' => 'tmp/huge',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $body = $this->actingAs($admin)->getJson('/admin/storage-usage')->assertOk()->json();

        $this->assertSame(2_000, $this->category($body, 'uploads')['bytes']);
        $this->assertSame(2_000, $body['usedBytes']);
    }

    public function test_the_limit_is_per_licence_and_counts_only_staff(): void
    {
        config(['portal.storage.limit_bytes' => 0, 'portal.storage.per_licence_bytes' => 1_000]);

        $admin = $this->user('Administrator');
        $this->user('Employee');
        $this->user('Client');

        $body = $this->actingAs($admin)->getJson('/admin/storage-usage')->assertOk()->json();

        $this->assertSame(2, $body['limit']['licences']);
        $this->assertSame(2_000, $body['limit']['bytes']);
        $this->assertSame('licences', $body['limit']['source']);
    }

    public function test_a_configured_allowance_overrides_the_licence_maths(): void
    {
        config(['portal.storage.limit_bytes' => 5_000, 'portal.storage.per_licence_bytes' => 1_000]);

        $body = $this->actingAs($this->user('Administrator'))
            ->getJson('/admin/storage-usage')->assertOk()->json();

        $this->assertSame(5_000, $body['limit']['bytes']);
        $this->assertSame('configured', $body['limit']['source']);
    }

    public function test_it_ranks_owners_and_the_largest_files(): void
    {
        $admin = $this->user('Administrator');
        $client = $this->user('Client');
        $folder = $this->folder($admin);

        $this->file($admin, $folder, 'Small.pdf', 100);
        $this->file($client, $folder, 'Big.pdf', 9_000);

        $body = $this->actingAs($admin)->getJson('/admin/storage-usage')->assertOk()->json();

        $this->assertSame($client->name, $body['topOwners'][0]['name']);
        $this->assertSame(9_000, $body['topOwners'][0]['bytes']);
        $this->assertSame('Big.pdf', $body['largestFiles'][0]['name']);
        $this->assertSame('Contracts', $body['largestFiles'][0]['folder']);
        $this->assertSame($client->name, $body['largestFiles'][0]['owner']);
    }
}
