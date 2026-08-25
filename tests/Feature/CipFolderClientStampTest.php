<?php

namespace Tests\Feature;

use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\Attention;
use App\Support\Cip\Tree;
use App\Support\Files\Comments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A folder that does not name its client hides every conversation inside it.
 *
 * `folders.client_id` is written at creation from whatever the parent holds,
 * and a CIP tree built before its client row existed kept a NULL nobody went
 * back for. Nothing shows that until something reads it, and the attention dot
 * does: it finds a client's documents by joining that column, so an unstamped
 * folder is a folder whose unread comments no indicator can see.
 */
class CipFolderClientStampTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        return $u;
    }

    /**
     * A filing shaped the way the broken ones on disk are: the client's own
     * folder names them, the person's folder underneath does not.
     *
     * @return array{0: User, 1: User, 2: object, 3: Client, 4: Folder, 5: Folder, 6: FileItem}
     */
    private function filing(): array
    {
        $staff = $this->user('a@example.com', 'Ada Admin');
        $mate = $this->user('b@example.com', 'Bo Colleague');

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $client = Client::create(['uid' => 'chen-wei', 'name' => 'Chen Wei', 'created_by' => $staff->id, 'data' => []]);

        $root = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Chen Wei',
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);
        $sub = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Main Applicant',
            'parent_id' => $root->id, 'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => null,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);

        $client->forceFill(['folder_id' => $root->id])->save();

        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $application->forceFill(['folder_id' => $root->id])->save();

        CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
            'folder_id' => $sub->id,
        ]);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $sub->id,
            'name' => 'Passport bio page.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 1024, 'disk' => 'local', 'storage_path' => 'vault/passport.pdf',
            'owner_id' => $staff->id, 'uploaded_by' => $staff->id,
        ]);

        return [$staff, $mate, $application, $client, $root, $sub, $file];
    }

    public function test_an_unstamped_folder_hides_the_conversation_inside_it(): void
    {
        [$staff, $mate, , $client, , , $file] = $this->filing();

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);

        // Bo is named in an open thread on this client's file and cannot see it.
        $this->assertSame([], Attention::forClients($mate, [$client->id]));
    }

    public function test_provisioning_gives_the_whole_tree_its_client(): void
    {
        [$staff, $mate, $application, $client, , $sub, $file] = $this->filing();

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);

        Tree::provision($application->fresh(), $staff);

        $this->assertSame($client->id, $sub->fresh()->client_id);

        $flag = Attention::forClients($mate, [$client->id])[$client->id] ?? null;
        $this->assertNotNull($flag, 'the dot should reach a thread naming this reader');
        $this->assertSame(1, $flag['comments']);
        $this->assertTrue($flag['mentionsMe']);

        // The author has read their own writing, so nothing is waiting on them.
        $this->assertSame([], Attention::forClients($staff, [$client->id]));
    }

    public function test_a_folder_naming_another_client_is_left_alone(): void
    {
        [$staff, , $application, , $root] = $this->filing();

        $other = Client::create(['uid' => 'someone-else', 'name' => 'Someone Else', 'created_by' => $staff->id, 'data' => []]);
        $stray = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Moved here by hand',
            'parent_id' => $root->id, 'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $other->id, 'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);

        Tree::provision($application->fresh(), $staff);

        // Filling a blank is a repair; reassigning documents between clients is not.
        $this->assertSame($other->id, $stray->fresh()->client_id);
    }

    public function test_the_backfill_repairs_trees_already_standing(): void
    {
        [, , , $client, $root, $sub] = $this->filing();

        // Deeper than one level, and trashed, so the walk has to reach both.
        $deep = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Scans',
            'parent_id' => $sub->id, 'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => null, 'owner_id' => $root->owner_id, 'created_by' => $root->created_by,
        ]);
        $deep->delete();

        $this->assertNull($sub->fresh()->client_id);

        (require base_path('database/migrations/2026_08_25_140000_backfill_folder_client_ids.php'))->up();

        $this->assertSame($client->id, $sub->fresh()->client_id);
        $this->assertSame($client->id, (int) DB::table('folders')->where('id', $deep->id)->value('client_id'));
    }
}
