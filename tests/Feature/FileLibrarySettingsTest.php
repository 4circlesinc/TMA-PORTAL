<?php

namespace Tests\Feature;

use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FileLibrarySettingsTest extends TestCase
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

    public function test_admin_sees_settings_with_default_subfolders_and_org_folders(): void
    {
        $admin = $this->user('Administrator');

        $this->actingAs($admin)->getJson('/portal/file-library/settings')
            ->assertOk()
            ->assertJsonPath('settings.clientSubfolders', ['Documents', 'Contracts', 'Invoices', 'Signed Documents'])
            ->assertJsonPath('settings.autoCreateStaffFolder', false)
            ->assertJsonPath('organizationFolders', []);
    }

    public function test_admin_can_create_rename_and_archive_an_organization_folder(): void
    {
        $admin = $this->user('Administrator');

        $id = $this->actingAs($admin)->postJson('/portal/file-library/organization-folders', [
            'name' => 'Company Documents', 'audience' => 'all_staff', 'role' => 'viewer',
        ])->assertCreated()
            ->assertJsonPath('folder.name', 'Company Documents')
            ->assertJsonPath('folder.audience', 'all_staff')
            ->json('folder.id');

        // It is a real organization folder, open to all staff.
        $folder = Folder::where('uuid', $id)->first();
        $this->assertSame('organization', $folder->folder_type);
        $this->assertSame('all_staff', $folder->audience);
        $this->assertTrue((bool) $folder->org_wide);

        // Rename.
        $this->actingAs($admin)->patchJson("/portal/file-library/organization-folders/{$id}", ['name' => 'Company Files'])
            ->assertOk()->assertJsonPath('folder.name', 'Company Files');

        // Archive.
        $this->actingAs($admin)->patchJson("/portal/file-library/organization-folders/{$id}", ['archived' => true])
            ->assertOk()->assertJsonPath('folder.archived', true);
    }

    public function test_admin_can_configure_default_client_subfolders(): void
    {
        $admin = $this->user('Administrator');

        $this->actingAs($admin)->putJson('/portal/file-library/settings', [
            'clientSubfolders' => ['Documents', '  Tax  ', '', 'Contracts'],
        ])->assertOk()
            // Names are cleaned and blanks dropped.
            ->assertJsonPath('settings.clientSubfolders', ['Documents', 'Tax', 'Contracts']);
    }

    public function test_admin_can_make_an_existing_folder_a_default_organization_folder(): void
    {
        $admin = $this->user('Administrator');

        // A plain top-level folder the admin created in the File Library.
        $uuid = $this->actingAs($admin)->postJson('/portal/files/folders', ['name' => 'Marketing'])
            ->assertCreated()->json('id');

        $this->actingAs($admin)->postJson('/portal/file-library/adopt-folder', [
            'folder' => $uuid, 'audience' => 'all_staff', 'role' => 'viewer',
        ])->assertOk()->assertJsonPath('folder.audience', 'all_staff');

        $folder = Folder::where('uuid', $uuid)->first();
        $this->assertSame('organization', $folder->folder_type);
        $this->assertSame('all_staff', $folder->audience);

        // It now auto-appears in staff Folder Shortcuts (the "organization" group).
        $names = collect($this->actingAs($admin)->getJson('/portal/files/shortcuts')->json('groups.organization'))
            ->pluck('name');
        $this->assertTrue($names->contains('Marketing'));
    }

    public function test_a_nested_folder_cannot_be_made_a_default_folder(): void
    {
        $admin = $this->user('Administrator');
        $parent = $this->actingAs($admin)->postJson('/portal/files/folders', ['name' => 'Parent'])->json('id');
        $child = $this->actingAs($admin)->postJson('/portal/files/folders', ['name' => 'Child', 'parent' => $parent])->json('id');

        $this->actingAs($admin)->postJson('/portal/file-library/adopt-folder', ['folder' => $child])
            ->assertStatus(422);
    }

    public function test_non_admins_cannot_manage_the_file_library(): void
    {
        foreach (['Employee', 'Client'] as $type) {
            $user = $this->user($type);
            $this->actingAs($user)->getJson('/portal/file-library/settings')->assertForbidden();
            $this->actingAs($user)->postJson('/portal/file-library/organization-folders', [
                'name' => 'X', 'audience' => 'all_staff',
            ])->assertForbidden();
        }
    }
}
