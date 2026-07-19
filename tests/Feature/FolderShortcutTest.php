<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\FolderShortcut;
use App\Models\Share;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Sidebar folder shortcuts. The rules that matter are all server-side: a
 * shortcut is private to one user, may only point at a folder that user can
 * see, and must stop resolving the moment either of those stops being true.
 */
class FolderShortcutTest extends TestCase
{
    use RefreshDatabase;

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

    private function folder(User $owner, string $name, ?Folder $parent = null): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'parent_id' => $parent?->id,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    private function shareTo(Folder $folder, User $from, User $to, string $role = 'viewer'): Share
    {
        return Share::create([
            'uuid' => (string) Str::uuid(),
            'token' => Str::random(40),
            'item_type' => 'folder',
            'item_id' => $folder->id,
            'shared_by' => $from->id,
            'kind' => 'user',
            'target_user_id' => $to->id,
            'role' => $role,
        ]);
    }

    public function test_admins_get_the_client_and_staff_file_libraries_auto_pinned(): void
    {
        $admin = $this->approvedUser(['account_type' => 'Administrator']);

        $libraries = collect(
            $this->actingAs($admin)->getJson('/portal/files/shortcuts')
                ->assertOk()->json('groups.libraries')
        )->pluck('name');

        $this->assertTrue($libraries->contains('Client Files'));
        $this->assertTrue($libraries->contains('Staff Files'));
    }

    public function test_staff_never_see_the_client_files_library_in_shortcuts(): void
    {
        // Ensure the roots exist (an admin visit provisions them)…
        $this->actingAs($this->approvedUser(['account_type' => 'Administrator']))
            ->getJson('/portal/files/shortcuts')->assertOk();

        // …a non-admin still gets none — it would list every client.
        foreach (['Employee', 'Client'] as $type) {
            $user = $this->approvedUser(['account_type' => $type]);
            $this->assertSame([], $this->actingAs($user)->getJson('/portal/files/shortcuts')->json('groups.libraries'));
        }
    }

    public function test_pinning_a_folder_lists_it_with_its_parent(): void
    {
        $user = $this->approvedUser();
        $parent = $this->folder($user, 'Contracts');
        $child = $this->folder($user, 'Signed 2026', $parent);

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $child->uuid])
            ->assertCreated()
            ->assertJsonPath('shortcuts.0.name', 'Signed 2026')
            ->assertJsonPath('shortcuts.0.parent', 'Contracts')
            ->assertJsonPath('shortcuts.0.id', $child->uuid);

        $this->actingAs($user)->getJson('/portal/files/shortcuts')
            ->assertOk()
            ->assertJsonCount(1, 'shortcuts');
    }

    public function test_pinning_the_same_folder_twice_does_not_duplicate(): void
    {
        $user = $this->approvedUser();
        $folder = $this->folder($user, 'Contracts');

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])
            ->assertOk()
            ->assertJsonCount(1, 'shortcuts');

        $this->assertSame(1, FolderShortcut::where('user_id', $user->id)->count());
    }

    public function test_shortcuts_are_private_to_each_user(): void
    {
        $alice = $this->approvedUser();
        $bob = $this->approvedUser();
        $folder = $this->folder($alice, 'Contracts');

        $this->actingAs($alice)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();

        $this->assertSame([], $this->actingAs($bob)->getJson('/portal/files/shortcuts')->json('shortcuts'));
    }

    public function test_a_folder_the_user_cannot_view_cannot_be_pinned(): void
    {
        $alice = $this->approvedUser();
        $bob = $this->approvedUser();
        $folder = $this->folder($alice, 'Private');

        $this->actingAs($bob)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])
            ->assertForbidden();

        $this->assertSame(0, FolderShortcut::count());
    }

    public function test_a_shared_folder_can_be_pinned_by_the_recipient(): void
    {
        $owner = $this->approvedUser();
        $viewer = $this->approvedUser();
        $folder = $this->folder($owner, 'Shared Docs');
        $this->shareTo($folder, $owner, $viewer);

        $this->actingAs($viewer)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])
            ->assertCreated()
            ->assertJsonPath('shortcuts.0.name', 'Shared Docs');
    }

    public function test_revoking_the_share_drops_the_shortcut_from_the_listing(): void
    {
        $owner = $this->approvedUser();
        $viewer = $this->approvedUser();
        $folder = $this->folder($owner, 'Shared Docs');
        $share = $this->shareTo($folder, $owner, $viewer);

        $this->actingAs($viewer)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();

        $share->forceFill(['revoked_at' => now()])->save();

        $this->assertSame([], $this->actingAs($viewer)->getJson('/portal/files/shortcuts')->json('shortcuts'));
    }

    public function test_deleting_the_folder_drops_the_shortcut_from_the_listing(): void
    {
        $user = $this->approvedUser();
        $folder = $this->folder($user, 'Contracts');

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        $this->actingAs($user)->deleteJson("/portal/files/folders/{$folder->uuid}")->assertOk();

        $this->assertSame([], $this->actingAs($user)->getJson('/portal/files/shortcuts')->json('shortcuts'));
    }

    public function test_a_restored_folder_comes_back_to_the_sidebar(): void
    {
        $user = $this->approvedUser();
        $folder = $this->folder($user, 'Contracts');

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        $this->actingAs($user)->deleteJson("/portal/files/folders/{$folder->uuid}")->assertOk();
        $this->actingAs($user)->postJson("/portal/files/folders/{$folder->uuid}/restore")->assertOk();

        $this->actingAs($user)->getJson('/portal/files/shortcuts')
            ->assertJsonCount(1, 'shortcuts')
            ->assertJsonPath('shortcuts.0.name', 'Contracts');
    }

    public function test_a_shortcut_to_a_deleted_folder_can_still_be_removed(): void
    {
        $user = $this->approvedUser();
        $folder = $this->folder($user, 'Contracts');

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        $this->actingAs($user)->deleteJson("/portal/files/folders/{$folder->uuid}")->assertOk();

        $this->actingAs($user)->deleteJson("/portal/files/shortcuts/{$folder->uuid}")->assertOk();
        $this->assertSame(0, FolderShortcut::where('user_id', $user->id)->count());
    }

    public function test_removing_a_shortcut_leaves_the_folder_alone(): void
    {
        $user = $this->approvedUser();
        $folder = $this->folder($user, 'Contracts');

        $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        $this->actingAs($user)->deleteJson("/portal/files/shortcuts/{$folder->uuid}")
            ->assertOk()
            ->assertJsonCount(0, 'shortcuts');

        $this->assertNotNull(Folder::find($folder->id));
    }

    public function test_one_user_cannot_remove_another_users_shortcut(): void
    {
        $alice = $this->approvedUser();
        $bob = $this->approvedUser();
        $folder = $this->folder($alice, 'Contracts');
        $this->shareTo($folder, $alice, $bob);

        $this->actingAs($alice)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();

        // Bob may see the folder, so this call is allowed — it just must not
        // touch Alice's row.
        $this->actingAs($bob)->deleteJson("/portal/files/shortcuts/{$folder->uuid}")->assertOk();

        $this->actingAs($alice)->getJson('/portal/files/shortcuts')->assertJsonCount(1, 'shortcuts');
    }

    public function test_reorder_persists_the_new_order(): void
    {
        $user = $this->approvedUser();
        $a = $this->folder($user, 'Alpha');
        $b = $this->folder($user, 'Beta');
        $c = $this->folder($user, 'Gamma');

        foreach ([$a, $b, $c] as $folder) {
            $this->actingAs($user)->postJson('/portal/files/shortcuts', ['folder' => $folder->uuid])->assertCreated();
        }

        $this->actingAs($user)->putJson('/portal/files/shortcuts/reorder', [
            'order' => [$c->uuid, $a->uuid, $b->uuid],
        ])->assertOk()->assertJsonPath('shortcuts.0.name', 'Gamma')
            ->assertJsonPath('shortcuts.1.name', 'Alpha')
            ->assertJsonPath('shortcuts.2.name', 'Beta');

        // And it sticks for the next read.
        $this->assertSame(
            ['Gamma', 'Alpha', 'Beta'],
            array_column($this->actingAs($user)->getJson('/portal/files/shortcuts')->json('shortcuts'), 'name')
        );
    }

    public function test_reorder_ignores_folders_the_user_has_not_pinned(): void
    {
        $alice = $this->approvedUser();
        $bob = $this->approvedUser();
        $mine = $this->folder($alice, 'Mine');
        $theirs = $this->folder($bob, 'Theirs');

        $this->actingAs($alice)->postJson('/portal/files/shortcuts', ['folder' => $mine->uuid])->assertCreated();
        $this->actingAs($bob)->postJson('/portal/files/shortcuts', ['folder' => $theirs->uuid])->assertCreated();

        $this->actingAs($alice)->putJson('/portal/files/shortcuts/reorder', [
            'order' => [$theirs->uuid, $mine->uuid],
        ])->assertOk()->assertJsonCount(1, 'shortcuts');

        // Bob's own shortcut kept its position.
        $this->actingAs($bob)->getJson('/portal/files/shortcuts')->assertJsonPath('shortcuts.0.name', 'Theirs');
    }

    public function test_shortcuts_require_a_signed_in_user(): void
    {
        $this->getJson('/portal/files/shortcuts')->assertUnauthorized();
    }
}
