<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The Requests and Comments tiles on the portal home.
 *
 * The lists themselves are {@see WorkflowHubTest}'s subject — this is the same
 * code path, so what matters here is only what the board adds: that looking at
 * a tile is not the same as reading a thread, that a tile switched off costs
 * nothing, and that an account without the Workflows section is told so rather
 * than refused.
 */
class DashboardWorkTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-dashwork-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
        ]);
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    private function rrmdir(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
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

    private function sharedFile(User $owner, string $name = 'Contract.txt'): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $owner->id, 'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent($name, 'draft one'),
            'folder' => $folder->uuid,
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    public function test_the_board_lists_what_is_waiting_on_you_and_who_is_talking_to_you(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('enabled', true)
            ->assertJsonCount(1, 'requests')
            ->assertJsonPath('requests.0.file.name', 'Contract.txt')
            ->assertJsonPath('requests.0.headline.text', 'Your response is needed')
            ->assertJsonCount(1, 'comments')
            ->assertJsonPath('comments.0.author.name', 'Ada Admin')
            ->assertJsonPath('comments.0.mentionsMe', true)
            ->assertJsonPath('counts.waiting', 1);
    }

    /**
     * The one thing the board must not do.
     *
     * The tile shows a line of each thread and refreshes on a timer, so if
     * that counted as reading, a dashboard left open all day would empty the
     * Workflows badge for conversations nobody ever opened.
     */
    public function test_looking_at_the_tile_does_not_mark_the_threads_read(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben — thoughts?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 1);

        // Twice, because a poll is what this endpoint actually gets.
        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 1);

        // Opening the list that draws the threads in full still does.
        $this->actingAs($ben)->getJson('/portal/files/workflows/comments?scope=mine')->assertOk();

        $this->actingAs($ben)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('counts.unread', 0);
    }

    /** A tile the reader turned off is not built. */
    public function test_want_narrows_what_is_returned(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        $this->actingAs($ada)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $ben->id]],
            ])->assertCreated();

        $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
            'body' => 'Ben, can you check clause 4?',
            'mentions' => [$ben->id],
        ])->assertCreated();

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=comments')
            ->assertOk()
            ->assertJsonPath('want', ['comments'])
            ->assertJsonCount(0, 'requests')
            ->assertJsonCount(1, 'comments');

        // Nonsense falls back to the whole board rather than an empty one.
        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=nothing')
            ->assertOk()
            ->assertJsonPath('want', ['requests', 'comments'])
            ->assertJsonCount(1, 'requests');
    }

    /** Ten rows a tile, however much discussion there is. */
    public function test_each_tile_is_capped_at_ten_rows(): void
    {
        $ada = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Reviewing Officer', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($ada);

        for ($i = 0; $i < 12; $i++) {
            $this->actingAs($ada)->postJson("/portal/files/files/{$file->uuid}/comments", [
                'body' => "Point {$i}",
                'mentions' => [$ben->id],
            ])->assertCreated();
        }

        $this->actingAs($ben)->getJson('/portal/dashboard/work?want=comments')
            ->assertOk()
            ->assertJsonCount(10, 'comments')
            // Newest first, so the tile leads with what just happened.
            ->assertJsonPath('comments.0.body', 'Point 11');
    }

    /**
     * A client has no Workflows section, so the board is told to drop the
     * tiles rather than refused — a 403 would be indistinguishable from the
     * tiles being broken.
     */
    public function test_an_account_without_the_section_is_told_so_rather_than_refused(): void
    {
        $client = $this->user('Client', 'cliff@example.com', 'Cliff Client');

        $this->actingAs($client)->getJson('/portal/dashboard/work')
            ->assertOk()
            ->assertJsonPath('enabled', false)
            ->assertJsonCount(0, 'requests')
            ->assertJsonCount(0, 'comments');
    }
}
