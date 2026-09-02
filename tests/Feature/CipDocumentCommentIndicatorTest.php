<?php

namespace Tests\Feature;

use App\Models\CipDocument;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\DocumentTypes;
use App\Support\Files\Comments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The comment indicator, everywhere a document is listed.
 *
 * A conversation on a passport should be visible from the checklist line that
 * names it and from the folder it is filed in, not only from inside the file's
 * own viewer. All three read the same numbers, so a line and the file behind it
 * can never disagree about whether something is waiting.
 */
class CipDocumentCommentIndicatorTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.cip.enabled' => true]);
    }

    private function user(string $type, string $email, string $name): User
    {
        $u = User::create(['name' => $name, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    /** @return array{0: User, 1: User, 2: object, 3: Folder, 4: Folder, 5: FileItem} */
    private function filing(): array
    {
        $staff = $this->user(Role::ADMINISTRATOR, 'a@example.com', 'Ada Admin');
        $mate = $this->user(Role::ADMINISTRATOR, 'b@example.com', 'Bo Colleague');

        $provider = CipProvider::create(['name' => 'Galaxy', 'code' => 'GAL']);
        $client = Client::create(['uid' => 'chen-wei', 'name' => 'Chen Wei', 'created_by' => $staff->id, 'data' => []]);

        $root = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Chen Wei',
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);
        // A subfolder, so the folder row has to look further than its own level.
        $sub = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Main Applicant',
            'parent_id' => $root->id, 'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
            'owner_id' => $staff->id, 'created_by' => $staff->id,
        ]);

        $application = Applications::create($provider, $staff, ['client_id' => $client->id]);
        $person = CipPerson::create([
            'application_id' => $application->id,
            'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => 'Chen', 'last_name' => 'Wei',
            'folder_id' => $sub->id,
        ]);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $sub->id,
            'name' => 'Birth certificate.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 1024, 'disk' => 'local', 'storage_path' => 'vault/birth.pdf',
            'owner_id' => $staff->id, 'uploaded_by' => $staff->id,
        ]);
        CipDocument::create([
            'application_id' => $application->id,
            'person_id' => $person->id,
            'type' => DocumentTypes::BIRTH_CERTIFICATE,
            'label' => 'Birth certificate',
            'file_id' => $file->id,
        ]);

        return [$staff, $mate, $application, $root, $sub, $file];
    }

    public function test_a_checklist_line_carries_the_comment_indicator(): void
    {
        [$staff, $mate, $application, , , $file] = $this->filing();

        $slotComments = fn (User $viewer) => collect(
            $this->actingAs($viewer)->getJson('/portal/cip/applications/'.$application->uuid)
                ->assertOk()->json('application.applicant.documents')
        )->firstWhere('label', 'Birth certificate')['comments'] ?? null;

        // Nothing said about it yet, so the line has nothing to draw.
        $this->assertNull($slotComments($mate));

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);

        $flag = $slotComments($mate);
        $this->assertSame(1, $flag['open']);
        $this->assertSame(1, $flag['unread']);
        $this->assertTrue($flag['mentionsMe']);

        // The author has read their own writing.
        $this->assertSame(0, $slotComments($staff)['unread']);

        // And reading it clears the unread half without closing the thread.
        $this->actingAs($mate)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $after = $slotComments($mate);
        $this->assertSame(0, $after['unread']);
        $this->assertSame(1, $after['open'], 'the conversation is still open, just read');
    }

    public function test_a_folder_row_reports_what_is_unread_anywhere_beneath_it(): void
    {
        [$staff, $mate, , $root, $sub, $file] = $this->filing();

        $folderRow = fn (User $viewer, Folder $parent) => collect(
            $this->actingAs($viewer)->getJson('/portal/files/?section=all&folder='.$parent->uuid)
                ->assertOk()->json('folders')
        )->firstWhere('name', 'Main Applicant');

        $this->assertNull($folderRow($mate, $root)['comments']);

        Comments::create($file, $staff, 'Needs a re-scan @Bo Colleague', null, [$mate->id]);

        // The file is a level down from the row being drawn, which is the
        // whole point: a closed folder has to say what it is hiding.
        $this->assertSame(1, $folderRow($mate, $root)['comments']['unread']);

        // Whoever wrote it has nothing to catch up on.
        $this->assertNull($folderRow($staff, $root)['comments']);

        $this->actingAs($mate)->getJson("/portal/files/files/{$file->uuid}/comments")->assertOk();
        $this->assertNull($folderRow($mate, $root)['comments'], 'reading it empties the folder row too');
    }

    public function test_a_library_root_reports_unread_without_walking_the_tree(): void
    {
        [$staff, $mate, , $root, , $file] = $this->filing();

        $library = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Citizenship Applications Portal',
            'folder_type' => Folder::TYPE_ROOT,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);
        $root->forceFill(['parent_id' => $library->id])->save();

        Comments::create($file, $staff, 'Needs a re-scan @Bo Colleague', null, [$mate->id]);

        $recursive = 0;
        DB::listen(function ($q) use (&$recursive) {
            if (str_contains(strtolower($q->sql), 'recursive')) {
                $recursive++;
            }
        });

        $row = collect(
            $this->actingAs($mate)->getJson('/portal/files/?section=all')->assertOk()->json('folders')
        )->firstWhere('name', 'Citizenship Applications Portal');

        $this->assertSame(0, $recursive, 'unread chips must not recurse the library');
        $this->assertSame(1, $row['comments']['unread']);
    }
}
