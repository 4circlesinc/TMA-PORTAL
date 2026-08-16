<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The File Library's catch-up read.
 *
 * The interesting cases are all about not lying to a replica. Scope must
 * include what the id lists alone would miss — a file inside a shared
 * folder's subtree is visible by containment, and Recent's own scope gets
 * that wrong on purpose. Deletions must arrive as rows, not absences. And
 * the cursor pair must survive a page boundary landing inside one second,
 * which is the failure that leaves one record silently wrong for ever.
 */
class FilesSyncTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Client'): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function folder(User $owner, array $attrs = []): Folder
    {
        return Folder::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'name' => 'Folder '.Str::random(6),
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ], $attrs));
    }

    private function file(User $owner, array $attrs = []): FileItem
    {
        return FileItem::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'name' => 'File '.Str::random(6).'.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/'.Str::random(8).'.pdf',
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ], $attrs));
    }

    private function share(User $to, string $type, int $id, User $by): void
    {
        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(64),
            'item_type' => $type, 'item_id' => $id, 'shared_by' => $by->id,
            'kind' => 'user', 'target_user_id' => $to->id, 'role' => 'viewer',
        ]);
    }

    private function sync(User $as, array $query = [])
    {
        return $this->actingAs($as)->getJson(
            '/portal/files/sync'.($query ? '?'.http_build_query($query) : ''),
        );
    }

    private function ids(array $records): array
    {
        return array_column($records, 'id');
    }

    public function test_no_cursor_returns_what_the_account_owns(): void
    {
        $user = $this->user();
        $folder = $this->folder($user);
        $file = $this->file($user, ['folder_id' => $folder->id]);
        // Somebody else's world, invisible.
        $other = $this->user();
        $this->folder($other);
        $this->file($other);

        $res = $this->sync($user);

        $res->assertOk();
        $this->assertSame([$folder->uuid], $this->ids($res->json('folders')));
        $this->assertSame([$file->uuid], $this->ids($res->json('files')));
        $this->assertFalse($res->json('more'));
    }

    /**
     * The containment case — the reason SyncScope exists at all. A share
     * names one folder; the subtree beneath it, and every file in that
     * subtree, is what the account can actually browse, and what the id
     * lists alone would never mention.
     */
    public function test_a_shared_folder_brings_its_subtree_and_contained_files(): void
    {
        $owner = $this->user();
        $reader = $this->user();

        $shared = $this->folder($owner);
        $nested = $this->folder($owner, ['parent_id' => $shared->id]);
        $inside = $this->file($owner, ['folder_id' => $nested->id]);
        // A sibling never shared stays invisible.
        $private = $this->folder($owner);
        $this->file($owner, ['folder_id' => $private->id]);

        $this->share($reader, 'folder', $shared->id, $owner);

        $res = $this->sync($reader);

        $this->assertEqualsCanonicalizing(
            [$shared->uuid, $nested->uuid],
            $this->ids($res->json('folders')),
        );
        $this->assertSame([$inside->uuid], $this->ids($res->json('files')));
    }

    public function test_the_cursor_returns_only_what_moved_after_it(): void
    {
        $user = $this->user();
        $old = $this->file($user);
        $old->forceFill(['updated_at' => now()->subDay()])->saveQuietly();
        $fresh = $this->file($user);

        $res = $this->sync($user, ['filesSince' => now()->subHours(2)->toIso8601String()]);

        $this->assertSame([$fresh->uuid], $this->ids($res->json('files')));
    }

    public function test_a_page_boundary_inside_one_second_drops_nothing(): void
    {
        $user = $this->user();
        $stamp = now()->startOfSecond();
        $first = $this->file($user);
        $second = $this->file($user);
        $first->forceFill(['updated_at' => $stamp])->saveQuietly();
        $second->forceFill(['updated_at' => $stamp])->saveQuietly();

        $res = $this->sync($user, [
            'filesSince' => $stamp->toIso8601String(),
            'filesAfter' => $first->id,
        ]);

        // The boundary row itself is re-delivered — the inclusive tie-break
        // that keeps a same-instant second change (delete then restore) from
        // being skipped for ever. An upsert absorbs the repeat; what matters
        // is that `second` cannot be lost.
        $this->assertSame([$first->uuid, $second->uuid], $this->ids($res->json('files')));
    }

    /** The SharePoint-bin lesson: a deletion is a row, never an absence. */
    public function test_a_deletion_arrives_as_a_tombstone(): void
    {
        $user = $this->user();
        $file = $this->file($user);
        $cursor = now()->subHour()->toIso8601String();

        $file->delete();

        $record = collect($this->sync($user, ['filesSince' => $cursor])->json('files'))
            ->firstWhere('id', $file->uuid);

        $this->assertNotNull($record);
        $this->assertTrue($record['deleted']);
        $this->assertArrayNotHasKey('name', $record);
    }

    public function test_a_restore_arrives_as_a_live_row_again(): void
    {
        $user = $this->user();
        $file = $this->file($user);
        $file->delete();

        $cursor = $this->sync($user)->json('cursor.files');
        $file->restore();

        $record = collect($this->sync($user, [
            'filesSince' => $cursor['since'], 'filesAfter' => $cursor['after'],
        ])->json('files'))->firstWhere('id', $file->uuid);

        $this->assertNotNull($record);
        $this->assertArrayNotHasKey('deleted', $record);
        $this->assertSame($file->name, $record['name']);
    }

    public function test_folders_and_files_page_independently(): void
    {
        $user = $this->user();
        $folder = $this->folder($user);
        $file = $this->file($user);

        // A cursor that has consumed the files but not the folders.
        $res = $this->sync($user, [
            'filesSince' => now()->addMinute()->toIso8601String(),
        ]);

        $this->assertSame([$folder->uuid], $this->ids($res->json('folders')));
        $this->assertSame([], $res->json('files'));
        $this->assertSame($file->id, $this->sync($user)->json('cursor.files.after'));
    }

    public function test_a_nonsense_cursor_is_treated_as_no_cursor(): void
    {
        $user = $this->user();
        $this->file($user);

        $res = $this->sync($user, ['filesSince' => 'a while ago, ish']);

        $res->assertOk();
        $this->assertCount(1, $res->json('files'));
    }

    public function test_an_administrator_sees_the_library_whole(): void
    {
        $admin = $this->user('Administrator');
        $someone = $this->user();
        $theirs = $this->folder($someone);
        $theirFile = $this->file($someone, ['folder_id' => $theirs->id]);

        $res = $this->sync($admin);

        $this->assertContains($theirs->uuid, $this->ids($res->json('folders')));
        $this->assertContains($theirFile->uuid, $this->ids($res->json('files')));
    }
}
