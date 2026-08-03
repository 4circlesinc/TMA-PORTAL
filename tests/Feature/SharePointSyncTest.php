<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Models\User;
use App\Support\SharePoint\Pusher;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * SharePoint synchronisation, with Graph faked.
 *
 * The live tenant proved this works; these exist so it keeps working. Every
 * Graph call is stubbed, so the suite runs offline and deterministically —
 * a sync test that needs the network is a test that gets disabled.
 */
class SharePointSyncTest extends TestCase
{
    use RefreshDatabase;

    protected string $vaultRoot;

    protected User $owner;

    protected SharePointConnection $connection;

    /** State the single Graph stub reads on every call. */
    protected array $deltaItems = [];

    protected array $children = [];

    protected string $content = 'file bytes';

    protected bool $throttle = false;

    protected ?array $remoteItem = null;

    protected ?string $failContentFor = null;

    /** Pages of delta items, when a test exercises a multi-page walk. */
    protected ?array $deltaPages = null;

    /** Every delta URL the fake was asked for, in order. */
    protected array $deltaCalls = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->vaultRoot = sys_get_temp_dir().'/tma-sp-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
            'services.microsoft.client_id' => 'test-client',
            'services.microsoft.client_secret' => 'test-secret',
            'services.microsoft.graph_tenant_id' => 'test-tenant',
        ]);

        $this->owner = User::create(['name' => 'Ada Admin', 'email' => 'ada@example.com', 'password' => bcrypt('x')]);
        $this->owner->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => 'Administrator',
        ])->save();

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Documents',
            'owner_id' => $this->owner->id, 'created_by' => $this->owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor', 'origin' => 'sharepoint',
        ]);

        $this->connection = SharePointConnection::create([
            'uuid' => (string) Str::uuid(), 'site_id' => 'site-1', 'drive_id' => 'drive-1',
            'drive_name' => 'Documents', 'folder_id' => $folder->id, 'created_by' => $this->owner->id,
        ]);

        $this->registerGraphFake();
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

    /**
     * Point the fake at new data.
     *
     * The stub itself is registered ONCE, in setUp, and reads these properties
     * on every call. Calling Http::fake() a second time does NOT replace the
     * first stub — Laravel accumulates them and the earliest match wins — so
     * re-faking mid-test silently kept serving the original response, and every
     * "the second sync did nothing" failure traced back to exactly that.
     *
     * @param  array<int, array>  $deltaItems
     */
    protected function fakeGraph(array $deltaItems, array $children = [], string $content = 'file bytes'): void
    {
        $this->deltaItems = $deltaItems;
        $this->children = $children;
        $this->content = $content;
    }

    private function registerGraphFake(): void
    {
        Http::fake(function (\Illuminate\Http\Client\Request $request) {
            $url = $request->url();

            if (str_contains($url, 'login.microsoftonline.com')) {
                return Http::response(['access_token' => 'tok', 'expires_in' => 3600]);
            }
            if ($this->throttle) {
                return Http::response('slow down', 429, ['Retry-After' => '42']);
            }
            if (str_contains($url, '/root/delta')) {
                $this->deltaCalls[] = $url;

                if ($this->deltaPages !== null) {
                    return Http::response($this->pageFor($url));
                }

                return Http::response([
                    'value' => $this->deltaItems,
                    '@odata.deltaLink' => 'https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?token=NEXT',
                ]);
            }
            if (str_contains($url, '/children')) {
                return Http::response(['value' => $this->children]);
            }
            // Download and upload BOTH end in /content — only the GET returns
            // raw bytes. Answering a PUT with a string made json() null and
            // the upload look like a failure.
            if (str_contains($url, '/content') && $request->method() === 'GET') {
                return isset($this->failContentFor) && str_contains($url, '/items/'.$this->failContentFor.'/')
                    ? Http::response('nope', 500)
                    : Http::response($this->content);
            }
            if (preg_match('#/drives/[^/]+/root$#', $url)) {
                return Http::response(['id' => 'root-1']);
            }
            if ($this->remoteItem !== null && preg_match('#/items/[^/]+$#', $url)) {
                return Http::response($this->remoteItem);
            }

            return Http::response(['id' => 'i-1', 'cTag' => 'c:NEW', 'name' => 'Brief.txt', 'size' => 10]);
        });
    }

    protected function fileItem(string $id, string $name, string $ctag, ?string $parent = 'root-1'): array
    {
        return [
            'id' => $id, 'name' => $name,
            'file' => ['mimeType' => 'text/plain'],
            'eTag' => '"'.$id.',1"', 'cTag' => $ctag,
            'size' => 10, 'webUrl' => 'https://example.sharepoint.com/'.$name,
            'parentReference' => ['id' => $parent],
            'lastModifiedDateTime' => now()->toIso8601String(),
            'lastModifiedBy' => ['user' => ['displayName' => 'Someone']],
        ];
    }

    /**
     * Serve the page the URL's $skiptoken asks for.
     *
     * Deliberately keyed off the token and NOT off a call counter: a counter
     * would advance even when the token was stripped, which is the exact bug
     * this exists to catch.
     */
    private function pageFor(string $url): array
    {
        $index = preg_match('/[?&]\$skiptoken=p(\d+)/', $url, $m) ? (int) $m[1] : 0;
        $last = count($this->deltaPages) - 1;

        return array_filter([
            'value' => $this->deltaPages[$index] ?? [],
            '@odata.nextLink' => $index < $last
                ? 'https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?$skiptoken=p'.($index + 1)
                : null,
            '@odata.deltaLink' => $index >= $last
                ? 'https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?token=FINAL'
                : null,
        ]);
    }

    /**
     * A paged walk must follow the skiptoken, not re-read page one.
     *
     * This is the 24-hour bug. Http::get($url, []) REPLACES the URL's query
     * string, so passing an empty query array threw away the $skiptoken Graph
     * puts in @odata.nextLink and every "next page" fetch returned page one
     * again. Live, that meant three libraries walking the same 200 items fifty
     * times per run — 10,000 updates, 205 files, no cursor ever reached — and
     * because there was no cursor, the next run started from zero. Forever.
     *
     * The old fake handed back a deltaLink on page one, so no test ever asked
     * for a second page and nothing caught it.
     */
    public function test_a_paged_delta_walk_follows_the_skiptoken_to_the_end(): void
    {
        $this->deltaPages = [
            [$this->fileItem('i-1', 'One.txt', 'c:1')],
            [$this->fileItem('i-2', 'Two.txt', 'c:1')],
            [$this->fileItem('i-3', 'Three.txt', 'c:1')],
        ];
        $this->children = [['id' => 'i-1'], ['id' => 'i-2'], ['id' => 'i-3']];

        $stats = Synchroniser::sync($this->connection);

        // Every page landed exactly once.
        $this->assertSame(3, $stats['created']);
        $this->assertSame(0, $stats['failed']);
        $this->assertSame(3, $stats['pages']);
        $this->assertEqualsCanonicalizing(
            ['One.txt', 'Two.txt', 'Three.txt'],
            FileItem::pluck('name')->all()
        );

        // The tokens were actually sent — the proof the query string survived.
        $this->assertStringContainsString('$skiptoken=p1', $this->deltaCalls[1]);
        $this->assertStringContainsString('$skiptoken=p2', $this->deltaCalls[2]);

        // Reaching the end means holding a cursor, which is what makes the
        // NEXT run incremental instead of another walk from zero.
        $this->assertStringContainsString('token=FINAL', $this->connection->fresh()->delta_link);
        $this->assertNotNull($this->connection->fresh()->last_success_at);
    }

    /** A walk that never reaches the end must not claim success. */
    public function test_an_unfinished_walk_keeps_its_cursor_but_not_a_success_stamp(): void
    {
        $this->connection->update(['last_success_at' => null]);

        // Throttled on the very first page: no cursor, no success.
        $this->throttle = true;
        Synchroniser::sync($this->connection);

        $connection = $this->connection->fresh();
        $this->assertNull($connection->delta_link);
        $this->assertNull($connection->last_success_at);
        $this->assertSame(SharePointConnection::STATUS_IDLE, $connection->status);
    }

    /**
     * The panel's "780 of 1,240 items" needs a total Graph will not give us.
     *
     * `$count` is rejected on this API, the list facet has no item count, and
     * /root reports childCount for DIRECT children only. Every item has exactly
     * one parent though, so the sum of folder child counts is the library size.
     */
    public function test_folder_child_counts_are_stored_so_a_total_can_be_shown(): void
    {
        $this->fakeGraph([
            ['id' => 'root-1', 'name' => 'root', 'root' => new \stdClass, 'folder' => ['childCount' => 2]],
            ['id' => 'f-1', 'name' => 'Contracts', 'folder' => ['childCount' => 7],
                'parentReference' => ['id' => 'root-1'], 'eTag' => '"f1"'],
            ['id' => 'f-2', 'name' => 'Invoices', 'folder' => ['childCount' => 3],
                'parentReference' => ['id' => 'root-1'], 'eTag' => '"f2"'],
            $this->fileItem('i-1', 'Brief.txt', 'c:1', 'f-1'),
        ], [['id' => 'f-1'], ['id' => 'f-2'], ['id' => 'i-1']]);

        Synchroniser::sync($this->connection);

        // 7 + 3 from the mapped folders...
        $this->assertSame(10, (int) SharePointItem::where('connection_id', $this->connection->id)
            ->where('item_type', 'folder')->sum('child_count'));
        // ...plus the root's own 2, which has no mapping to hang off.
        $this->assertSame(2, (int) $this->connection->fresh()->root_child_count);

        // A file mapping must not carry one, or it would be counted twice.
        $this->assertNull(SharePointItem::where('graph_item_id', 'i-1')->first()->child_count);
    }

    /** Re-syncing a folder updates its count rather than adding to it. */
    public function test_a_re_synced_folder_does_not_double_count(): void
    {
        $folder = ['id' => 'f-1', 'name' => 'Contracts', 'folder' => ['childCount' => 4],
            'parentReference' => ['id' => 'root-1'], 'eTag' => '"f1"'];

        $this->fakeGraph([$folder], [['id' => 'f-1']]);
        Synchroniser::sync($this->connection);

        // The same folder comes back with two more children in it.
        $folder['folder']['childCount'] = 6;
        $folder['eTag'] = '"f1-changed"';
        $this->fakeGraph([$folder], [['id' => 'f-1']]);
        Synchroniser::sync($this->connection->fresh());

        $this->assertSame(6, (int) SharePointItem::where('connection_id', $this->connection->id)
            ->where('item_type', 'folder')->sum('child_count'));
    }

    public function test_delta_imports_folders_and_files(): void
    {
        $this->fakeGraph([
            ['id' => 'root-1', 'name' => 'root', 'root' => new \stdClass, 'folder' => ['childCount' => 1]],
            ['id' => 'f-1', 'name' => 'Contracts', 'folder' => ['childCount' => 1],
                'parentReference' => ['id' => 'root-1'], 'eTag' => '"f1"'],
            $this->fileItem('i-1', 'Brief.txt', 'c:1', 'f-1'),
        ], [['id' => 'f-1'], ['id' => 'i-1']]);

        $stats = Synchroniser::sync($this->connection);

        $this->assertSame(2, $stats['created']);
        $this->assertSame(0, $stats['failed']);

        $file = FileItem::where('name', 'Brief.txt')->first();
        $this->assertNotNull($file);
        $this->assertSame('sharepoint', $file->origin);
        $this->assertSame('Contracts', $file->folder->name);
        // Imported content is version 1, like any other file.
        $this->assertSame(1, FileVersion::where('file_id', $file->id)->count());
    }

    /** The anti-duplicate guarantee. */
    public function test_re_syncing_the_same_items_creates_nothing_new(): void
    {
        $items = [$this->fileItem('i-1', 'Brief.txt', 'c:1')];
        $this->fakeGraph($items, [['id' => 'i-1']]);

        Synchroniser::sync($this->connection);
        $first = FileItem::count();

        $stats = Synchroniser::sync($this->connection->fresh());

        $this->assertSame(0, $stats['created']);
        $this->assertSame($first, FileItem::count());
        $this->assertSame(1, SharePointItem::count());
    }

    public function test_changed_content_becomes_a_new_version_not_a_second_file(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']], 'first');
        Synchroniser::sync($this->connection);

        $file = FileItem::first();
        $this->assertSame(1, FileVersion::where('file_id', $file->id)->count());

        // Same item, new cTag = new content.
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:2')], [['id' => 'i-1']], 'second');
        Synchroniser::sync($this->connection->fresh());

        $this->assertSame(1, FileItem::count(), 'still one file');
        $this->assertSame(2, FileVersion::where('file_id', $file->id)->count(), 'now two versions');
    }

    /**
     * eTag changes on a rename too. Keying off it would file a version every
     * time somebody renamed a document.
     */
    public function test_a_rename_does_not_create_a_version(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection);
        $file = FileItem::first();

        $renamed = $this->fileItem('i-1', 'Renamed.txt', 'c:1');   // cTag unchanged
        $renamed['eTag'] = '"i-1,99"';                             // eTag moved
        $this->fakeGraph([$renamed], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection->fresh());

        $this->assertSame('Renamed.txt', $file->fresh()->name);
        $this->assertSame(1, FileVersion::where('file_id', $file->id)->count());
    }

    /**
     * Deletions are found by difference, because a real library was observed
     * not to emit tombstones at all.
     */
    public function test_an_item_missing_from_its_parent_is_recycled(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection);
        $file = FileItem::first();

        // Delta reports the parent folder changed; the child is simply absent.
        $this->fakeGraph(
            [['id' => 'root-1', 'name' => 'root', 'root' => new \stdClass, 'folder' => ['childCount' => 0]]],
            []   // no children at all
        );
        $stats = Synchroniser::sync($this->connection->fresh());

        $this->assertSame(1, $stats['deleted']);
        $this->assertTrue(FileItem::withTrashed()->find($file->id)->trashed(), 'recycled, not purged');
        // The bytes survive so a wrong delete on either side is recoverable.
        $this->assertFileExists($this->vaultRoot.'/'.$file->storage_path);
    }

    public function test_one_bad_item_does_not_stop_the_rest(): void
    {
        // Only the first item's download fails.
        $this->failContentFor = 'bad';
        $this->fakeGraph(
            [$this->fileItem('bad', 'Bad.txt', 'c:1'), $this->fileItem('good', 'Good.txt', 'c:1')],
            [['id' => 'bad'], ['id' => 'good']],
        );

        $stats = Synchroniser::sync($this->connection);

        $this->assertSame(1, $stats['failed']);
        $this->assertSame(1, $stats['created']);
        $this->assertNotNull(FileItem::where('name', 'Good.txt')->first(), 'the healthy file still imported');
    }

    public function test_throttling_leaves_the_cursor_alone_so_the_next_run_resumes(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection);
        $cursor = $this->connection->fresh()->delta_link;

        $this->throttle = true;

        $stats = Synchroniser::sync($this->connection->fresh());

        $this->assertTrue($stats['throttled']);
        $this->assertSame(42, $stats['retryAfter']);
        $this->assertSame($cursor, $this->connection->fresh()->delta_link, 'the cursor must not move');
        $this->assertSame(SharePointConnection::STATUS_IDLE, $this->connection->fresh()->status);
    }

    /** Inbound writes must not bounce straight back out. */
    public function test_pushes_are_suspended_while_inbound_sync_runs(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);

        $this->assertFalse(Pusher::isSuspended());
        Synchroniser::sync($this->connection);
        $this->assertFalse(Pusher::isSuspended(), 'the guard must be released afterwards');

        // The imported file kept SharePoint's own mapping — it was not
        // re-uploaded under a new item id by an echoed push.
        $this->assertSame(1, SharePointItem::count());
        $this->assertSame('i-1', SharePointItem::first()->graph_item_id);
    }

    /**
     * The firm's conflict rule: portal wins for what the portal authored,
     * SharePoint-authored files are never silently overwritten.
     */
    public function test_a_sharepoint_originated_file_changed_on_both_sides_is_flagged_not_overwritten(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection);

        $file = FileItem::first();
        $this->assertSame('sharepoint', $file->origin);

        // SharePoint has moved on since we last saw it.
        $this->remoteItem = ['id' => 'i-1', 'cTag' => 'c:CHANGED'];

        $result = Pusher::pushFile($file);

        $this->assertSame('conflict', $result['status']);
        $mapping = SharePointItem::first();
        $this->assertSame(SharePointItem::CONFLICT, $mapping->sync_status);
        $this->assertStringContainsString('did not overwrite', $mapping->conflict_reason);
    }

    public function test_a_portal_originated_file_wins_the_same_conflict(): void
    {
        $this->fakeGraph([$this->fileItem('i-1', 'Brief.txt', 'c:1')], [['id' => 'i-1']]);
        Synchroniser::sync($this->connection);

        $file = FileItem::first();
        // The same collision, but this file was authored in the portal.
        $file->update(['origin' => 'portal']);

        $this->remoteItem = ['id' => 'i-1', 'cTag' => 'c:CHANGED'];

        $result = Pusher::pushFile($file->fresh());

        $this->assertSame('pushed', $result['status'], $result['reason'] ?? '');
        $this->assertSame(SharePointItem::SYNCED, SharePointItem::first()->sync_status);
    }

    public function test_a_file_outside_any_linked_library_is_not_pushed(): void
    {
        $loose = FileItem::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Loose.txt', 'extension' => 'txt',
            'mime_type' => 'text/plain', 'size' => 3, 'disk' => 'local',
            'storage_path' => 'vault/loose.txt', 'owner_id' => $this->owner->id,
            'uploaded_by' => $this->owner->id, 'origin' => 'portal',
        ]);

        $this->assertSame('not-linked', Pusher::pushFile($loose)['status']);
    }

    public function test_a_one_way_connection_never_pushes_back(): void
    {
        $this->connection->update(['direction' => 'in']);

        $file = FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $this->connection->folder_id,
            'name' => 'ReadOnly.txt', 'extension' => 'txt', 'mime_type' => 'text/plain',
            'size' => 3, 'disk' => 'local', 'storage_path' => 'vault/ro.txt',
            'owner_id' => $this->owner->id, 'uploaded_by' => $this->owner->id, 'origin' => 'portal',
        ]);

        $this->assertSame('not-linked', Pusher::pushFile($file)['status']);
    }
}
