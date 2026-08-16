<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Who the row menu's "Assign to people" flyout may list.
 *
 * The picker hands out access — clicking a name creates a share — so the
 * question this endpoint answers is not "who exists" but "who may this reader
 * admit". Staff who can share see everybody; anybody else sees only people who
 * can already open the item, because a client holding `full` over their own
 * upload must not be handed a directory of the firm's other clients.
 */
class ShareAssignablePeopleTest extends TestCase
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

    private function file(User $owner, ?Folder $folder = null): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder?->id,
            'name' => 'Brief.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 2048, 'disk' => 'local', 'storage_path' => 'vault/brief.pdf',
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    private function names(array $people): array
    {
        return array_column($people, 'name');
    }

    public function test_staff_who_can_share_see_everybody(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $colleague = $this->user('Employee', 'emp@example.com', 'Ed Employee');
        $client = $this->user('Client', 'client@example.com', 'Cleo Client');
        $file = $this->file($admin);

        $res = $this->actingAs($admin)
            ->getJson('/portal/files/shares/people?type=file&id='.$file->uuid)
            ->assertOk();

        $names = $this->names($res->json('people'));

        $this->assertContains($colleague->name, $names);
        $this->assertContains($client->name, $names, 'A sharer may admit anyone, so anyone may be listed.');
        $this->assertNotContains($admin->name, $names, 'You are not somebody to assign it to.');
    }

    public function test_the_list_says_who_already_has_access(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $colleague = $this->user('Employee', 'emp@example.com', 'Ed Employee');

        // An all-staff folder: the colleague can already open what is in it.
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'viewer',
        ]);
        $file = $this->file($admin, $folder);

        $people = $this->actingAs($admin)
            ->getJson('/portal/files/shares/people?type=file&id='.$file->uuid)
            ->assertOk()
            ->json('people');

        $row = collect($people)->firstWhere('email', $colleague->email);

        $this->assertNotNull($row);
        $this->assertTrue($row['hasAccess'], 'Somebody the folder already lets in is marked, not hidden.');
    }

    public function test_a_client_is_not_handed_a_directory_of_other_clients(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $client = $this->user('Client', 'client@example.com', 'Cleo Client');
        $stranger = $this->user('Client', 'other@example.com', 'Otto Other');

        // The client's own upload: they hold it outright, which is exactly the
        // case that would otherwise turn this into a staff directory.
        $file = $this->file($client);

        $names = $this->names(
            $this->actingAs($client)
                ->getJson('/portal/files/shares/people?type=file&id='.$file->uuid)
                ->assertOk()
                ->json('people')
        );

        $this->assertNotContains($stranger->name, $names, 'Another client is not theirs to browse.');
        // The administrator is on the list, and correctly: they hold every file
        // from the role, so they can already open this one. The rule is "people
        // who can already see it", not "people I like the look of".
        $this->assertContains($admin->name, $names);
    }

    public function test_a_reader_who_cannot_assign_is_refused(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $client = $this->user('Client', 'client@example.com', 'Cleo Client');
        $file = $this->file($admin);

        $this->actingAs($client)
            ->getJson('/portal/files/shares/people?type=file&id='.$file->uuid)
            ->assertForbidden();
    }

    public function test_a_folder_is_asked_the_same_question(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $colleague = $this->user('Employee', 'emp@example.com', 'Ed Employee');

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Contracts',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
        ]);

        $names = $this->names(
            $this->actingAs($admin)
                ->getJson('/portal/files/shares/people?type=folder&id='.$folder->uuid)
                ->assertOk()
                ->json('people')
        );

        $this->assertContains($colleague->name, $names);
    }

    public function test_the_search_narrows_the_list(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com', 'Ada Admin');
        $this->user('Employee', 'emp@example.com', 'Ed Employee');
        $this->user('Employee', 'zoe@example.com', 'Zoe Zebra');
        $file = $this->file($admin);

        $names = $this->names(
            $this->actingAs($admin)
                ->getJson('/portal/files/shares/people?type=file&id='.$file->uuid.'&q=zeb')
                ->assertOk()
                ->json('people')
        );

        $this->assertSame(['Zoe Zebra'], $names);
    }
}
