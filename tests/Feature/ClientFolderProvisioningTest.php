<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\FileAccess;
use App\Support\Files\FolderProvisioner;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ClientFolderProvisioningTest extends TestCase
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

    /** @return array<string, mixed> */
    private function payload(string $uid, string $name): array
    {
        return [
            'uid' => $uid,
            'name' => $name,
            'profile' => ['firstName' => $name, 'work' => ['company' => 'Acme']],
        ];
    }

    public function test_creating_a_client_provisions_a_linked_folder_with_default_subfolders(): void
    {
        $admin = $this->user('Administrator');

        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))
            ->assertOk();

        $client = Client::where('uid', 'vernon-francis')->first();
        $this->assertNotNull($client->folder_id, 'client is linked to a folder by id');

        $folder = Folder::find($client->folder_id);
        $this->assertSame('client', $folder->folder_type);
        $this->assertSame($client->id, $folder->client_id);
        $this->assertSame('Vernon Francis', $folder->name);

        // Lives under the "Client Files" root.
        $this->assertSame(FolderProvisioner::ROOT_CLIENTS, $folder->parent->name);

        // Configured default subfolders were created.
        $subs = Folder::where('parent_id', $folder->id)->pluck('name')->all();
        foreach (['Documents', 'Contracts', 'Invoices', 'Signed Documents'] as $expected) {
            $this->assertContains($expected, $subs);
        }
    }

    public function test_configured_default_subfolders_are_honoured(): void
    {
        $admin = $this->user('Administrator');
        FileLibrarySetting::put(['clientSubfolders' => ['Matters', 'Billing']]);

        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('jane-roe', 'Jane Roe'))->assertOk();

        $folder = Folder::where('client_id', Client::where('uid', 'jane-roe')->value('id'))->first();
        $subs = Folder::where('parent_id', $folder->id)->pluck('name')->sort()->values()->all();
        $this->assertSame(['Billing', 'Matters'], $subs);
    }

    public function test_renaming_a_client_keeps_the_folder_and_files_but_updates_the_name(): void
    {
        $admin = $this->user('Administrator');
        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))->assertOk();

        $client = Client::where('uid', 'vernon-francis')->first();
        $folderId = $client->folder_id;

        $this->actingAs($admin)->patchJson('/portal/clients/vernon-francis', [
            'uid' => 'vernon-francis',
            'name' => 'Vernon A. Francis',
            'profile' => ['firstName' => 'Vernon', 'middleName' => 'A.', 'lastName' => 'Francis'],
        ])->assertOk();

        $client->refresh();
        $this->assertSame($folderId, $client->folder_id, 'folder relationship is unchanged');
        $this->assertSame('Vernon A. Francis', Folder::find($folderId)->name, 'visible name follows the client');
    }

    public function test_assigned_staff_get_folder_access_at_the_configured_level_and_others_do_not(): void
    {
        $admin = $this->user('Administrator');
        $assigned = $this->user('Employee');
        $other = $this->user('Employee');

        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))->assertOk();
        $client = Client::where('uid', 'vernon-francis')->first();
        $folder = Folder::find($client->folder_id);
        $sub = Folder::where('parent_id', $folder->id)->first();

        $this->actingAs($admin)->postJson('/portal/clients/vernon-francis/assignments', [
            'userId' => $assigned->id, 'level' => 'editor',
        ])->assertOk();

        // Assigned staff: editor on the folder and, by inheritance, its subfolders.
        $this->assertSame('editor', FileAccess::folderRole($assigned->fresh(), $folder));
        $this->assertTrue(FileAccess::can($assigned->fresh(), 'upload', $sub));

        // Unassigned staff: nothing.
        $this->assertNull(FileAccess::folderRole($other->fresh(), $folder));
        $this->assertFalse(FileAccess::can($other->fresh(), 'view', $sub));

        // Removing the assignment removes the access.
        $this->actingAs($admin)->deleteJson("/portal/clients/vernon-francis/assignments/{$assigned->id}")->assertOk();
        $this->assertNull(FileAccess::folderRole($assigned->fresh(), $folder));
    }

    public function test_a_client_only_sees_what_is_explicitly_shared_never_the_whole_folder(): void
    {
        $admin = $this->user('Administrator');
        $clientUser = $this->user('Client');

        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))->assertOk();
        $client = Client::where('uid', 'vernon-francis')->first();
        $client->forceFill(['user_id' => $clientUser->id])->save();

        $folder = Folder::find($client->folder_id);
        $subs = Folder::where('parent_id', $folder->id)->get();
        $shared = $subs->first();

        // No automatic access to their own client folder.
        $this->assertFalse(FileAccess::can($clientUser->fresh(), 'view', $folder));

        // Share exactly one subfolder with the client.
        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(64),
            'item_type' => 'folder', 'item_id' => $shared->id, 'shared_by' => $admin->id,
            'kind' => 'user', 'target_user_id' => $clientUser->id, 'role' => 'downloader',
        ]);

        $this->assertTrue(FileAccess::can($clientUser->fresh(), 'view', $shared));
        // Sibling folders stay invisible.
        $this->assertFalse(FileAccess::can($clientUser->fresh(), 'view', $subs->last()));
    }

    public function test_organization_folder_reaches_all_staff_but_never_clients(): void
    {
        $admin = $this->user('Administrator');
        $staff = $this->user('Employee');
        $clientUser = $this->user('Client');

        $this->actingAs($admin)->postJson('/portal/file-library/organization-folders', [
            'name' => 'Templates', 'audience' => 'all_staff', 'role' => 'viewer',
        ])->assertCreated();

        $folder = Folder::where('folder_type', 'organization')->where('name', 'Templates')->first();

        $this->assertTrue(FileAccess::can($staff->fresh(), 'view', $folder));
        $this->assertFalse(FileAccess::can($clientUser->fresh(), 'view', $folder));
    }

    public function test_staff_folder_is_private_to_its_subject_and_admins(): void
    {
        $admin = $this->user('Administrator');
        $owner = $this->user('Employee');
        $other = $this->user('Employee');

        $folder = FolderProvisioner::provisionStaffFolder($owner, $admin);

        $this->assertTrue(FileAccess::can($owner->fresh(), 'view', $folder));
        $this->assertTrue(FileAccess::can($admin->fresh(), 'view', $folder));
        $this->assertFalse(FileAccess::can($other->fresh(), 'view', $folder));
    }

    public function test_only_admins_manage_assignments_and_org_folders(): void
    {
        $staff = $this->user('Employee');
        $clientUser = $this->user('Client');
        $admin = $this->user('Administrator');
        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))->assertOk();

        $this->actingAs($staff)->postJson('/portal/clients/vernon-francis/assignments', [
            'userId' => $staff->id, 'level' => 'editor',
        ])->assertForbidden();

        $this->actingAs($clientUser)->getJson('/portal/clients/vernon-francis/assignments')->assertForbidden();
        $this->actingAs($staff)->postJson('/portal/file-library/organization-folders', [
            'name' => 'X', 'audience' => 'all_staff',
        ])->assertForbidden();
    }

    public function test_deleting_the_owning_admin_rehomes_system_folders_instead_of_destroying_them(): void
    {
        $admin = $this->user('Administrator');
        $keeper = $this->user('Administrator');

        $this->actingAs($admin)->postJson('/portal/clients', $this->payload('vernon-francis', 'Vernon Francis'))->assertOk();
        $client = Client::where('uid', 'vernon-francis')->first();
        $folderId = $client->folder_id;
        $this->assertSame($admin->id, Folder::find($folderId)->owner_id);

        $this->actingAs($keeper)->deleteJson("/admin/users/{$admin->id}")->assertOk();

        $folder = Folder::find($folderId);
        $this->assertNotNull($folder, 'client folder survives the admin deletion');
        $this->assertSame($keeper->id, $folder->owner_id, 'ownership handed to another admin');
    }
}
