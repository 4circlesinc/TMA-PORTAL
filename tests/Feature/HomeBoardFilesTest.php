<?php

namespace Tests\Feature;

use App\Models\Favorite;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Dashboard\HomeBoard;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The `files` part of the home board, and the request the shell starts for
 * the board before the bundle has downloaded.
 *
 * Recent Files and Favorites are the rows the File Library lists for the
 * same sections, read through its own controller. What is pinned here is
 * that the board carries them at all, in that shape, and that the URL the
 * shell writes into the document is the URL the dashboard would have built
 * for itself: if the two ever disagree the head start is silently wasted,
 * which no browser test would notice.
 */
class HomeBoardFilesTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::create([
            'name' => 'Ada Admin',
            'email' => 'ada@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => Role::ADMINISTRATOR,
        ])->save();

        return $user;
    }

    private function file(User $owner, string $name, ?Folder $folder = null): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/'.uniqid().'.pdf',
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
            'folder_id' => $folder?->id,
        ]);
    }

    public function test_the_board_carries_recent_and_favorite_rows_in_the_listing_shape(): void
    {
        $admin = $this->admin();
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Engagements',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
        ]);
        $recent = $this->file($admin, 'Engagement letter.pdf', $folder);
        $starred = $this->file($admin, 'Starred.pdf');
        Favorite::create(['user_id' => $admin->id, 'item_type' => 'file', 'item_id' => $starred->id]);

        $json = $this->actingAs($admin)
            ->getJson('/portal/dashboard/home?parts=files')
            ->assertOk()
            ->json();

        $this->assertSame(['files'], array_keys($json));

        $recentIds = array_column($json['files']['recent']['files'], 'id');
        $this->assertContains($recent->uuid, $recentIds);
        $this->assertContains($starred->uuid, $recentIds);

        $favorites = $json['files']['favorites'];
        $this->assertSame([$starred->uuid], array_column($favorites['files'], 'id'));
        $this->assertSame([], $favorites['folders']);

        // The File Library's row, not a second shape: the tile reads these
        // keys and the viewer is handed the whole row.
        $row = collect($json['files']['recent']['files'])->firstWhere('id', $recent->uuid);
        foreach (['type', 'name', 'extension', 'icon', 'thumbUrl', 'path', 'folder', 'permissions', 'updatedAt'] as $key) {
            $this->assertArrayHasKey($key, $row);
        }
        $this->assertSame('file', $row['type']);
        $this->assertSame($folder->uuid, $row['folder']['id']);
    }

    public function test_the_files_part_is_one_page_per_section_not_a_row_per_query(): void
    {
        $admin = $this->admin();
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Engagements',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
        ]);

        $measure = function () use ($admin): int {
            FileAccess::forgetFolders();
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->actingAs($admin)->getJson('/portal/dashboard/home?parts=files')->assertOk();
            $n = count(DB::getQueryLog());
            if (getenv('HOMEBOARD_SQL')) {
                foreach (DB::getQueryLog() as $q) {
                    fwrite(STDERR, substr($q['query'], 0, 160)."\n");
                }
            }
            DB::disableQueryLog();
            DB::flushQueryLog();

            return $n;
        };

        $this->file($admin, 'One.pdf', $folder);
        $small = $measure();

        for ($i = 0; $i < 12; $i++) {
            $this->file($admin, "More {$i}.pdf", $folder);
        }
        $large = $measure();

        $this->assertLessThanOrEqual($small + 2, $large,
            "the files part grew from {$small} to {$large} queries with a fuller library");
    }

    public function test_the_shell_for_the_dashboard_starts_the_board_request(): void
    {
        $admin = $this->admin();
        $admin->forceFill(['preferences' => [
            'dashboardWorkflowStrip' => false,
            'dashboardTiles' => ['requests' => true, 'comments' => false],
        ]])->save();

        $expected = '/portal/dashboard/home?period=month&want=requests'
            .'&parts=metrics,staff,work,cip,mail,chats,pending';
        $this->assertSame($expected, HomeBoard::bootUrl($admin));

        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
        $encoded = json_encode($expected, $flags);
        $files = json_encode('/portal/dashboard/home?parts=files', $flags);

        $this->actingAs($admin)
            ->get('/')
            ->assertOk()
            ->assertHeader('Cache-Control', 'max-age=0, must-revalidate, no-cache, no-store, private')
            ->assertSee('window.TMABootHomeUrl='.$encoded, escape: false)
            ->assertSee('window.TMABootHome=fetch('.$encoded, escape: false)
            ->assertSee('window.TMABootHomeFilesUrl='.$files, escape: false)
            ->assertSee('window.TMABootHomeFiles=fetch('.$files, escape: false);
    }

    public function test_the_shell_for_another_page_does_not(): void
    {
        $this->actingAs($this->admin())
            ->get('/email')
            ->assertOk()
            ->assertSee('window.TMABootCapabilities=', escape: false)
            ->assertDontSee('TMABootHome', escape: false);
    }

    public function test_a_reader_without_the_workflows_section_is_not_asked_for_the_strip(): void
    {
        $client = User::create([
            'name' => 'Cal Client',
            'email' => 'cal@example.com',
            'password' => bcrypt('password12345'),
        ]);
        $client->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Client',
        ])->save();

        $this->assertSame(['requests', 'comments'], HomeBoard::wantedWork($client));
    }
}
