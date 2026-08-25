<?php

namespace Tests\Feature;

use App\Events\PortalDataChanged;
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
use App\Support\Files\CommentReads;
use App\Support\Realtime\Live;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Reading clears the count, and every indicator hears about it.
 *
 * The chip and the dot are drawn from four different endpoints, so "I read it"
 * and "somebody wrote to me" both have to reach surfaces the reader is not
 * looking at. Without that, a count is only ever as current as your last
 * navigation.
 */
class CommentReadLiveTest extends TestCase
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

    /** @return array{0: User, 1: User, 2: FileItem} */
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
            'client_id' => $client->id, 'owner_id' => $staff->id, 'created_by' => $staff->id,
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
            'name' => 'Passport bio page.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 1024, 'disk' => 'local', 'storage_path' => 'vault/passport.pdf',
            'owner_id' => $staff->id, 'uploaded_by' => $staff->id,
        ]);
        CipDocument::create([
            'application_id' => $application->id, 'person_id' => $person->id,
            'type' => DocumentTypes::PASSPORT_BIO_PAGE, 'label' => 'Passport bio page',
            'file_id' => $file->id,
        ]);

        return [$staff, $mate, $file];
    }

    /** @return array<string, list<string>> resource => channel names */
    private function signals(callable $work): array
    {
        // Setting the scene queues signals of its own. Drain them first, or
        // they arrive inside the window this is watching and read as the
        // work's doing.
        Live::flush();

        Event::fake([PortalDataChanged::class]);
        $work();
        Live::flush();

        $out = [];
        foreach (Event::dispatched(PortalDataChanged::class) as $dispatched) {
            foreach ($dispatched[0]->broadcastOn() as $channel) {
                $out[$dispatched[0]->resource][] = (string) $channel->name;
            }
        }

        return $out;
    }

    private function unread(User $viewer, FileItem $file): int
    {
        return CommentReads::flagsForFiles($viewer, [$file->id])[$file->id]['unread'] ?? 0;
    }

    public function test_opening_the_conversation_clears_the_count(): void
    {
        [$staff, $mate, $file] = $this->filing();

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);
        $this->assertSame(1, $this->unread($mate, $file));

        $this->actingAs($mate)
            ->getJson('/portal/files/files/'.$file->uuid.'/comments')
            ->assertOk()
            ->assertJsonPath('readCleared', true);

        $this->assertSame(0, $this->unread($mate, $file));
    }

    public function test_a_count_refresh_does_not_claim_the_reader_read_it(): void
    {
        [$staff, $mate, $file] = $this->filing();

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);

        $this->actingAs($mate)
            ->getJson('/portal/files/files/'.$file->uuid.'/comments?peek=1')
            ->assertOk()
            ->assertJsonPath('readCleared', false);

        // Still waiting on them: counting is not reading.
        $this->assertSame(1, $this->unread($mate, $file));
    }

    public function test_reading_an_already_read_conversation_says_nothing(): void
    {
        [$staff, $mate, $file] = $this->filing();

        Comments::create($file, $staff, 'Have a look @Bo Colleague', null, [$mate->id]);
        $this->actingAs($mate)->getJson('/portal/files/files/'.$file->uuid.'/comments')->assertOk();

        // Nothing moved the second time, so no surface is asked to refetch.
        $this->actingAs($mate)
            ->getJson('/portal/files/files/'.$file->uuid.'/comments')
            ->assertOk()
            ->assertJsonPath('readCleared', false);
    }

    public function test_a_new_comment_reaches_the_cip_table_and_the_file_lists(): void
    {
        [$staff, $mate, $file] = $this->filing();

        $signals = $this->signals(fn () => Comments::create(
            $file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]
        ));

        // The dot on the applications table is for readers who are not in the
        // thread and do not know it exists, so it goes to the staff room.
        $this->assertContains('private-portal.staff', $signals[Live::CIP] ?? []);

        // The file listing's chip goes to the people the conversation concerns.
        $this->assertContains('private-App.Models.User.'.$mate->id, $signals[Live::FILES] ?? []);
        $this->assertNotContains('private-portal.staff', $signals[Live::FILES] ?? []);
    }

    public function test_reading_tells_only_the_reader(): void
    {
        [$staff, $mate, $file] = $this->filing();

        Comments::create($file, $staff, 'This scan is cut off @Bo Colleague', null, [$mate->id]);

        $signals = $this->signals(fn () => CommentReads::markFileRead($mate->fresh(), $file));

        // Unread is per-reader, so this is one person's screens and nobody else's.
        $this->assertSame(['private-App.Models.User.'.$mate->id], $signals[Live::CIP] ?? []);
        $this->assertSame(['private-App.Models.User.'.$mate->id], $signals[Live::FILES] ?? []);
        $this->assertNotContains('private-portal.staff', $signals[Live::WORKFLOWS] ?? []);
    }

    public function test_nothing_to_clear_signals_nothing(): void
    {
        [$staff, , $file] = $this->filing();

        // The author has read their own writing, so this marks nothing.
        Comments::create($file, $staff, 'Noting this for later', null, []);
        CommentReads::markFileRead($staff->fresh(), $file);

        $signals = $this->signals(fn () => CommentReads::markFileRead($staff->fresh(), $file));

        $this->assertSame([], $signals);
    }
}
