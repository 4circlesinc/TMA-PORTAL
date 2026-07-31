<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\FilePresenceSession;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\Presence;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Active viewers.
 *
 * The property these defend is §13's: presence is a heartbeat, never an
 * inference. Somebody who looked at a file yesterday must not appear to be
 * looking at it now.
 */
class FilePresenceTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function orgFile(User $admin): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        return FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder->id,
            'name' => 'Brief.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 10, 'disk' => 'local', 'storage_path' => 'vault/b.pdf',
            'owner_id' => $admin->id, 'uploaded_by' => $admin->id,
        ]);
    }

    public function test_a_heartbeat_puts_someone_on_the_roster(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        $res = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-1'])
            ->assertOk();

        $this->assertSame(1, $res->json('total'));
        $this->assertSame('Ada Admin', $res->json('viewers.0.name'));
        $this->assertSame('Currently viewing', $res->json('viewers.0.label'));
        $this->assertTrue($res->json('viewers.0.isSelf'));
    }

    /** The whole point: no heartbeat, no presence. */
    public function test_a_session_that_stops_beating_drops_off(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->orgFile($admin);

        $this->actingAs($ben)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-b']);
        $this->assertSame(1, $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/presence")->json('total'));

        // Age the heartbeat past the staleness window.
        FilePresenceSession::query()->update([
            'last_heartbeat_at' => now()->subSeconds(FilePresenceSession::STALE_SECONDS + 5),
        ]);

        $this->assertSame(0, $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/presence")->json('total'),
            'a stale session must not be reported as an active viewer');
    }

    public function test_two_tabs_are_one_person(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-1']);
        $res = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-2'])
            ->assertOk();

        $this->assertSame(1, $res->json('total'), 'the same person twice is still one face');
        $this->assertSame(2, FilePresenceSession::count(), 'but both tabs are tracked');
    }

    public function test_the_more_engaged_action_wins_across_tabs(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/presence",
            ['session' => 'tab-1', 'action' => 'viewing']);
        $res = $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/presence",
            ['session' => 'tab-2', 'action' => 'commenting'])->assertOk();

        $this->assertSame('Commenting', $res->json('viewers.0.label'));
    }

    public function test_leaving_removes_the_session_at_once(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-1']);
        $this->actingAs($admin)->deleteJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'tab-1'])
            ->assertOk();

        $this->assertSame(0, $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/presence")->json('total'));
    }

    public function test_several_people_collapse_to_faces_plus_a_count(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        for ($i = 1; $i <= 8; $i++) {
            $person = $this->user('Employee', "p{$i}@example.com", "Person {$i}");
            $this->actingAs($person)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => "s{$i}"]);
        }

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/presence")->assertOk();

        $this->assertSame(8, $res->json('total'));
        $this->assertCount(Presence::FACES, $res->json('viewers'));
        $this->assertSame(8 - Presence::FACES, $res->json('extra'));
    }

    public function test_someone_without_access_can_neither_join_nor_read_the_roster(): void
    {
        $owner = $this->user('Employee', 'olive@example.com', 'Olive Owner');
        $stranger = $this->user('Employee', 'sam@example.com', 'Sam Stranger');

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Private.pdf', 'extension' => 'pdf',
            'mime_type' => 'application/pdf', 'size' => 5, 'disk' => 'local',
            'storage_path' => 'vault/p.pdf', 'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);

        $this->actingAs($stranger)->getJson("/portal/files/files/{$file->uuid}/presence")->assertForbidden();
        $this->actingAs($stranger)
            ->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'x'])->assertForbidden();
    }

    /** Losing access mid-session must remove you from everyone else's stack. */
    public function test_a_viewer_who_loses_access_leaves_the_roster(): void
    {
        $owner = $this->user('Employee', 'olive@example.com', 'Olive Owner');
        $guest = $this->user('Employee', 'gus@example.com', 'Gus Guest');

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Private.pdf', 'extension' => 'pdf',
            'mime_type' => 'application/pdf', 'size' => 5, 'disk' => 'local',
            'storage_path' => 'vault/p.pdf', 'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);

        $share = Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id, 'shared_by' => $owner->id,
            'kind' => 'user', 'target_user_id' => $guest->id, 'role' => 'viewer',
        ]);

        $this->actingAs($guest)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'g1']);
        $this->assertSame(1, $this->actingAs($owner)
            ->getJson("/portal/files/files/{$file->uuid}/presence")->json('total'));

        $share->update(['revoked_at' => now()]);

        $this->assertSame(0, $this->actingAs($owner)
            ->getJson("/portal/files/files/{$file->uuid}/presence")->json('total'));
    }

    public function test_pruning_clears_long_dead_sessions(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $file = $this->orgFile($admin);

        $this->actingAs($admin)->postJson("/portal/files/files/{$file->uuid}/presence", ['session' => 'old']);
        FilePresenceSession::query()->update(['last_heartbeat_at' => now()->subHour()]);

        $this->artisan('files:prune-presence')->assertSuccessful();
        $this->assertSame(0, FilePresenceSession::count());
    }
}
