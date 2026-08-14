<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Files\FolderTemplates;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Account settings > Advanced Preferences > Folder Templates.
 *
 * A template that only ever saves a list of names is the mock this replaced.
 * What matters here is that applying one creates real folders, that applying
 * it twice does not duplicate them, and that it cannot be used to write into a
 * folder the caller has no business writing to.
 */
class FolderTemplateTest extends TestCase
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

    private function orgFolder(User $owner, string $name = 'Company Documents'): Folder
    {
        return Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
            'org_wide' => true,
            'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);
    }

    private function children(Folder $parent): array
    {
        return Folder::where('parent_id', $parent->id)->orderBy('name')->pluck('name')->all();
    }

    /* ── managing templates ──────────────────────────────────────────── */

    public function test_an_administrator_can_create_list_and_delete_templates(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->postJson('/portal/file-library/folder-templates', [
            'name' => 'New Client Setup',
            'subfolders' => ['Documents', 'Contracts', 'Invoices'],
        ])->assertCreated()->assertJsonPath('template.name', 'New Client Setup');

        $listed = $this->actingAs($admin)->getJson('/portal/file-library/folder-templates')
            ->assertOk()
            ->assertJsonPath('templates.0.name', 'New Client Setup')
            ->assertJsonPath('templates.0.subfolders', ['Documents', 'Contracts', 'Invoices'])
            ->json('templates.0');

        $this->actingAs($admin)
            ->deleteJson('/portal/file-library/folder-templates/'.$listed['id'])
            ->assertOk()
            ->assertJsonPath('templates', []);
    }

    public function test_a_template_can_be_renamed_and_its_subfolders_changed(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $template = FolderTemplates::create('Draft', ['One']);

        $this->actingAs($admin)->putJson('/portal/file-library/folder-templates/'.$template['id'], [
            'name' => 'Tax Year',
            'subfolders' => ['Returns', 'Correspondence'],
        ])->assertOk()->assertJsonPath('template.name', 'Tax Year');

        $this->assertSame(['Returns', 'Correspondence'], FolderTemplates::find($template['id'])['subfolders']);
    }

    public function test_blank_and_duplicate_subfolder_names_are_dropped(): void
    {
        // Two names differing only in case would collide when the folders are
        // created and silently produce one folder, which reads as a bug in the
        // template rather than in the input.
        $template = FolderTemplates::create('Messy', ['Documents', '  ', 'documents', 'Contracts', '']);

        $this->assertSame(['Documents', 'Contracts'], $template['subfolders']);
    }

    public function test_a_template_needs_a_name_and_at_least_one_subfolder(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->actingAs($admin)->postJson('/portal/file-library/folder-templates', [
            'name' => '',
            'subfolders' => ['Documents'],
        ])->assertStatus(422);

        $this->actingAs($admin)->postJson('/portal/file-library/folder-templates', [
            'name' => 'Empty',
            'subfolders' => [],
        ])->assertStatus(422);
    }

    public function test_only_administrators_can_manage_templates(): void
    {
        foreach ([Role::REVIEWING_OFFICER, Role::CLIENT] as $type) {
            $user = $this->user($type);

            $this->actingAs($user)->getJson('/portal/file-library/folder-templates')->assertForbidden();
            $this->actingAs($user)->postJson('/portal/file-library/folder-templates', [
                'name' => 'Mine',
                'subfolders' => ['Documents'],
            ])->assertForbidden();
        }
    }

    /* ── applying them ───────────────────────────────────────────────── */

    public function test_applying_a_template_creates_the_folders(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $target = $this->orgFolder($admin);
        $template = FolderTemplates::create('New Client Setup', ['Documents', 'Contracts']);

        $this->actingAs($admin)
            ->postJson('/portal/file-library/folder-templates/'.$template['id'].'/apply', ['folder' => $target->uuid])
            ->assertOk()
            ->assertJsonPath('created', ['Documents', 'Contracts'])
            ->assertJsonPath('skipped', [])
            ->assertJsonPath('folder.name', 'Company Documents');

        $this->assertSame(['Contracts', 'Documents'], $this->children($target));
    }

    public function test_applying_the_same_template_twice_does_not_duplicate_folders(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $target = $this->orgFolder($admin);
        $template = FolderTemplates::create('New Client Setup', ['Documents', 'Contracts']);

        $url = '/portal/file-library/folder-templates/'.$template['id'].'/apply';

        $this->actingAs($admin)->postJson($url, ['folder' => $target->uuid])->assertOk();

        // The second pass has nothing to do, and says so rather than making a
        // "Documents (2)" beside the first.
        $this->actingAs($admin)->postJson($url, ['folder' => $target->uuid])
            ->assertOk()
            ->assertJsonPath('created', [])
            ->assertJsonPath('skipped', ['Documents', 'Contracts']);

        $this->assertSame(['Contracts', 'Documents'], $this->children($target));
    }

    public function test_a_folder_that_already_holds_one_of_the_names_keeps_it(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $target = $this->orgFolder($admin);

        $existing = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Contracts',
            'parent_id' => $target->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        $template = FolderTemplates::create('Setup', ['Documents', 'Contracts']);

        $this->actingAs($admin)
            ->postJson('/portal/file-library/folder-templates/'.$template['id'].'/apply', ['folder' => $target->uuid])
            ->assertOk()
            ->assertJsonPath('created', ['Documents'])
            ->assertJsonPath('skipped', ['Contracts']);

        // The existing folder is the same row — its contents were not replaced.
        $this->assertDatabaseHas('folders', ['id' => $existing->id, 'name' => 'Contracts']);
        $this->assertSame(['Contracts', 'Documents'], $this->children($target));
    }

    public function test_deleting_a_template_leaves_the_folders_it_created(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $target = $this->orgFolder($admin);
        $template = FolderTemplates::create('Setup', ['Documents']);

        $this->actingAs($admin)
            ->postJson('/portal/file-library/folder-templates/'.$template['id'].'/apply', ['folder' => $target->uuid])
            ->assertOk();

        $this->actingAs($admin)
            ->deleteJson('/portal/file-library/folder-templates/'.$template['id'])
            ->assertOk();

        // A template is a shortcut, not an owner. Deleting one must never take
        // a firm's filing with it.
        $this->assertSame(['Documents'], $this->children($target));
    }

    public function test_applying_a_template_still_respects_the_target_folders_permissions(): void
    {
        // `files.settings` says who may manage templates. It does not say who
        // may write into a given folder, so a template must not become a way
        // around a folder nobody granted them.
        $admin = $this->user(Role::ADMINISTRATOR);
        $other = $this->user(Role::REVIEWING_OFFICER);

        $private = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Their private folder',
            'folder_type' => Folder::TYPE_STAFF,
            'subject_user_id' => $other->id,
            'owner_id' => $other->id,
            'created_by' => $other->id,
        ]);

        $template = FolderTemplates::create('Setup', ['Documents']);

        // The officer cannot manage templates at all.
        $this->actingAs($other)
            ->postJson('/portal/file-library/folder-templates/'.$template['id'].'/apply', ['folder' => $private->uuid])
            ->assertForbidden();

        $this->assertSame([], $this->children($private));
    }

    public function test_the_screen_is_offered_organization_and_client_folders_to_apply_to(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->orgFolder($admin, 'Templates');

        $client = Client::create([
            'uid' => 'acme-co',
            'name' => 'Acme Co',
            'email' => 'owner@acme.test',
            'initial' => 'A',
            'initial_color' => 'blue',
            'data' => [],
        ]);

        Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Acme Co',
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        $targets = $this->actingAs($admin)->getJson('/portal/file-library/folder-templates')
            ->assertOk()
            ->json('targets');

        $groups = array_values(array_unique(array_column($targets, 'group')));

        $this->assertContains('Organization folders', $groups);
        $this->assertContains('Client folders', $groups);
    }

    public function test_applying_a_template_that_was_deleted_is_a_clean_404(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $target = $this->orgFolder($admin);

        $this->actingAs($admin)
            ->postJson('/portal/file-library/folder-templates/does-not-exist/apply', ['folder' => $target->uuid])
            ->assertNotFound();
    }
}
