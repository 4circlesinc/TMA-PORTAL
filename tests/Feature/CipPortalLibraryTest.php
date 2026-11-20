<?php

namespace Tests\Feature;

use App\Jobs\MigrateCipApplicantFolder;
use App\Models\CipApplication;
use App\Models\CipPerson;
use App\Models\CipProvider;
use App\Models\Client;
use App\Models\Company;
use App\Models\CompanyMember;
use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\Folder;
use App\Models\SharePointConnection;
use App\Models\SharePointItem;
use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cip\Applications;
use App\Support\Cip\FolderAccess;
use App\Support\Files\FileAccess;
use App\Support\Cip\PortalLibrary;
use App\Support\Cip\Providers;
use App\Support\Cip\Tree;
use App\Support\Imports\ImportPause;
use App\Support\SharePoint\QuickXorHash;
use App\Support\SharePoint\RemoteContent;
use App\Support\SharePoint\Synchroniser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Moving portal applications into the TMA CIP Applications Portal.
 *
 * Graph is a small in-memory model of two drives: the old library the CIP
 * folders synced with, and the new site. Every portal write in the fixture
 * goes through the real observers and pushes, so the old drive is filled the
 * way production filled it, and the move is checked against what actually
 * lands in each drive.
 */
class CipPortalLibraryTest extends TestCase
{
    use RefreshDatabase;

    private const OLD = 'drive-old';

    private const SITE = 'drive-site';

    /** @var array<string, array<string, array>> drive id => item id => item */
    private array $store = [];

    /** @var array<string, string> drive id => root item id */
    private array $roots = [];

    private int $seq = 0;

    private string $vaultRoot;

    private User $staff;

    private Folder $legacyRoot;

    private SharePointConnection $old;

    private CipProvider $galaxy;

    protected function setUp(): void
    {
        parent::setUp();

        $this->vaultRoot = sys_get_temp_dir().'/tma-cip-lib-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config([
            'filesystems.disks.local.root' => $this->vaultRoot,
            'filesystems.files_disk' => 'local',
            'services.microsoft.client_id' => 'test-client',
            'services.microsoft.client_secret' => 'test-secret',
            'services.microsoft.graph_tenant_id' => 'test-tenant',
            'services.microsoft.graph_webhook_url' => '',
            'services.cip.enabled' => true,
            'app.url' => 'http://localhost',
        ]);
        Storage::forgetDisk('local');

        $this->newDrive(self::OLD, 'root-old');
        $this->newDrive(self::SITE, 'root-site');
        $this->fakeGraph();

        $this->staff = $this->user(Role::ADMINISTRATOR);

        // The old library the CIP folders have synced with until now.
        $this->legacyRoot = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Citizenship Applications',
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff', 'audience_role' => 'editor',
            'owner_id' => $this->staff->id, 'created_by' => $this->staff->id, 'origin' => 'sharepoint',
        ]);
        $this->old = SharePointConnection::create([
            'uuid' => (string) Str::uuid(), 'site_id' => 'site-old', 'drive_id' => self::OLD,
            'drive_name' => 'Citizenship Applications', 'folder_id' => $this->legacyRoot->id,
            'created_by' => $this->staff->id,
        ]);

        $company = Company::create(['uid' => 'gal-firm', 'name' => 'Galaxy Firm']);
        $this->galaxy = CipProvider::create(['name' => 'Galaxy Citizenship', 'code' => 'GAL', 'company_id' => $company->id]);
        Providers::ensureFolder($this->galaxy);
        $this->galaxy->refresh();
    }

    protected function tearDown(): void
    {
        $this->rrmdir($this->vaultRoot);
        parent::tearDown();
    }

    public function test_portal_applications_move_into_the_new_site_and_nothing_is_lost(): void
    {
        ['root' => $client, 'main' => $main] = $this->filing('Chen', 'Wei');
        $passport = $this->upload($main, 'Passport.pdf', 'passport bytes');
        $scan = $this->droppedInOldLibrary($main, 'Scan.pdf', 'scan bytes');
        $historic = $this->historicFolderWithAnApplication();
        $oldDrawer = $this->galaxy->folder;
        $oldDriveItems = count($this->store[self::OLD]);

        $this->artisan('cip:library:connect')->assertSuccessful();

        $root = PortalLibrary::root();
        $target = PortalLibrary::connection();
        $this->assertNotNull($root);
        $this->assertSame('TMA CIP Applications Portal', $root->name);
        $this->assertSame([$this->legacyRoot->audience, $this->legacyRoot->audience_role], [$root->audience, $root->audience_role]);
        $this->assertSame(self::SITE, $target->drive_id);
        $this->assertTrue(ImportPause::library($target->uuid), 'nothing is imported before the move');

        // Dry run: reports, changes nothing.
        $this->artisan('cip:library:migrate')->expectsOutputToContain($client->name)->assertSuccessful();
        $this->assertSame($oldDrawer->id, $client->fresh()->parent_id);
        $this->assertSame([], $this->itemsUnder(self::SITE, 'root-site'));

        $this->artisan('cip:library:migrate', ['--apply' => true])->assertSuccessful();

        // The provider files in the new folder and remembers the old drawer.
        $this->galaxy->refresh();
        $newDrawer = $this->galaxy->folder;
        $this->assertSame($root->id, $newDrawer->parent_id);
        $this->assertSame('Galaxy Citizenship', $newDrawer->name);
        $this->assertSame($oldDrawer->id, $this->galaxy->legacy_folder_id);

        // The portal application moved; the historical folder did not.
        $this->assertSame($newDrawer->id, $client->fresh()->parent_id);
        $this->assertSame($oldDrawer->id, $historic->fresh()->parent_id);

        // Both files are on the site, with the right bytes, in the right place.
        $mainName = $main->fresh()->name;
        $this->assertSame('passport bytes', $this->contentAt(self::SITE, ['Galaxy Citizenship', $client->name, $mainName, 'Passport.pdf']));
        $this->assertSame('scan bytes', $this->contentAt(self::SITE, ['Galaxy Citizenship', $client->name, $mainName, 'Scan.pdf']));
        $this->assertNull($scan->fresh()->content_state, 'the Microsoft-only file was brought down first');

        // Nothing was deleted from the old library; its copies are archived.
        $this->assertSame($oldDriveItems, count($this->store[self::OLD]));
        $archived = SharePointItem::where('connection_id', $this->old->id)->whereNotNull('archived_at')->get();
        $this->assertGreaterThanOrEqual(4, $archived->count());
        $this->assertTrue($archived->every(fn ($row) => $row->file_id === null && $row->folder_id === null));
        foreach ([$passport, $scan] as $file) {
            $this->assertSame(SharePointItem::SYNCED, SharePointItem::where('connection_id', $target->id)
                ->where('file_id', $file->id)->value('sync_status'));
        }

        // A second run finds nothing left to send.
        $before = $this->sitePuts();
        $this->artisan('cip:library:migrate', ['--apply' => true])->assertSuccessful();
        $this->assertSame($before, $this->sitePuts());
    }

    public function test_changes_to_the_archived_copy_never_reach_the_moved_application(): void
    {
        ['root' => $client, 'main' => $main] = $this->filing('Chen', 'Wei');
        $passport = $this->upload($main, 'Passport.pdf', 'passport bytes');
        $oldPassportId = SharePointItem::where('connection_id', $this->old->id)->where('file_id', $passport->id)->value('graph_item_id');
        $oldMainId = SharePointItem::where('connection_id', $this->old->id)->where('folder_id', $main->id)->value('graph_item_id');
        $this->artisan('cip:library:connect')->assertSuccessful();
        $this->artisan('cip:library:migrate', ['--apply' => true])->assertSuccessful();
        $newParent = $client->fresh()->parent_id;
        $versions = FileVersion::where('file_id', $passport->id)->count();

        // Someone keeps working in the old copy.
        $this->store[self::OLD][$oldPassportId]['content'] = 'edited in the archive';
        $this->store[self::OLD][$oldPassportId]['v']++;
        $this->addItem(self::OLD, $oldMainId, 'Late.pdf', false, 'late bytes');
        Synchroniser::sync($this->old->fresh());

        $this->assertSame($versions, FileVersion::where('file_id', $passport->id)->count());
        $this->assertSame($newParent, $client->fresh()->parent_id);
        $this->assertFalse(FileItem::where('name', 'Late.pdf')->exists());
    }

    public function test_after_the_move_new_applications_file_in_the_new_place_and_contacts_keep_access(): void
    {
        $contact = $this->user(Role::CLIENT);
        CompanyMember::create([
            'company_id' => $this->galaxy->company_id, 'user_id' => $contact->id, 'name' => $contact->name,
            'email' => $contact->email, 'role' => 'member', 'status' => CompanyMember::STATUS_ACTIVE,
        ]);
        ['root' => $moved] = $this->filing('Chen', 'Wei');
        FileAccess::forgetGrants();
        $this->assertSame(FolderAccess::ROLE, FileAccess::folderRole($contact, $moved->fresh()), 'has access before the move');
        $this->artisan('cip:library:connect')->assertSuccessful();
        $this->artisan('cip:library:migrate', ['--apply' => true])->assertSuccessful();

        ['root' => $fresh] = $this->filing('Ana', 'Lopez');

        $this->galaxy->refresh();
        $this->assertSame($this->galaxy->folder_id, $fresh->parent_id);
        $this->assertNotNull($this->childAt(self::SITE, ['Galaxy Citizenship', $fresh->name]), 'the new filing reached the site');

        FileAccess::forgetGrants();
        $this->assertSame(FolderAccess::ROLE, FileAccess::folderRole($contact, $moved->fresh()));
        $this->assertTrue(FileAccess::can($contact, 'upload', $moved->fresh()));
        $this->assertEqualsCanonicalizing(
            [$this->galaxy->folder_id, $this->galaxy->legacy_folder_id],
            FolderAccess::drawerIdsFor($contact),
        );
    }

    public function test_a_file_that_cannot_be_fetched_leaves_its_application_untouched(): void
    {
        ['root' => $client, 'main' => $main] = $this->filing('Chen', 'Wei');
        $scan = $this->droppedInOldLibrary($main, 'Scan.pdf', 'scan bytes');
        $oldScanId = SharePointItem::where('file_id', $scan->id)->value('graph_item_id');
        unset($this->store[self::OLD][$oldScanId]);   // Microsoft can no longer hand it over
        $oldParent = $client->parent_id;

        $this->artisan('cip:library:connect')->assertSuccessful();
        $this->artisan('cip:library:migrate', ['--apply' => true])
            ->expectsOutputToContain('could not fetch')
            ->assertFailed();

        $this->assertSame($oldParent, $client->fresh()->parent_id);
        $this->assertSame(0, SharePointItem::whereNotNull('archived_at')->count());
        $this->assertSame(RemoteContent::PENDING, $scan->fresh()->content_state);
    }

    public function test_a_real_queue_is_given_one_job_per_folder_and_the_console_does_not_upload(): void
    {
        ['root' => $client] = $this->filing('Chen', 'Wei');
        $this->artisan('cip:library:connect')->assertSuccessful();
        $parent = $client->parent_id;

        config(['queue.default' => 'database']);
        Queue::fake();

        $this->artisan('cip:library:migrate', ['--apply' => true])
            ->expectsOutputToContain('1 applicant folder(s) queued')
            ->assertSuccessful();

        Queue::assertPushed(MigrateCipApplicantFolder::class, fn ($job) => $job->folderId === $client->id);
        $this->assertSame($parent, $client->fresh()->parent_id, 'the console queued the folder instead of uploading it');
    }

    // ── fixture ────────────────────────────────────────────────────────

    private function user(string $accountType): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => $accountType,
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
    }

    /** @return array{root: Folder, main: Folder, application: CipApplication} */
    private function filing(string $first, string $last): array
    {
        $application = Applications::create($this->galaxy->fresh(), $this->staff);
        CipPerson::create([
            'application_id' => $application->id, 'role' => CipPerson::ROLE_MAIN_APPLICANT,
            'first_name' => $first, 'last_name' => $last,
        ]);
        $root = Tree::provision($application->fresh(), $this->staff);

        return [
            'root' => $root,
            'main' => Folder::findOrFail($application->people()->first()->fresh()->folder_id),
            'application' => $application->fresh(),
        ];
    }

    /** A portal upload: real bytes, pushed by the observer like production. */
    private function upload(Folder $folder, string $name, string $bytes): FileItem
    {
        $path = 'vault/'.Str::uuid().'.pdf';
        Storage::disk('local')->put($path, $bytes);

        return FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder->id, 'name' => $name,
            'extension' => 'pdf', 'mime_type' => 'application/pdf', 'size' => strlen($bytes),
            'disk' => 'local', 'storage_path' => $path, 'owner_id' => $this->staff->id,
            'uploaded_by' => $this->staff->id, 'origin' => 'portal',
        ]);
    }

    /** A file someone put straight into the old library: imported by reference, bytes still remote. */
    private function droppedInOldLibrary(Folder $folder, string $name, string $bytes): FileItem
    {
        $parent = SharePointItem::where('connection_id', $this->old->id)->where('folder_id', $folder->id)->value('graph_item_id');
        $this->addItem(self::OLD, $parent, $name, false, $bytes);
        Synchroniser::sync($this->old->fresh());

        $file = FileItem::where('name', $name)->firstOrFail();
        $this->assertSame(RemoteContent::PENDING, $file->content_state);

        return $file;
    }

    private function historicFolderWithAnApplication(): Folder
    {
        $client = Client::create([
            'uid' => 'old-applicant', 'name' => 'Old Applicant', 'created_by' => $this->staff->id, 'data' => [],
        ]);
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Old Applicant', 'parent_id' => $this->galaxy->folder_id,
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id, 'origin' => 'sharepoint',
            'owner_id' => $this->staff->id, 'created_by' => $this->staff->id,
        ]);
        $client->forceFill(['folder_id' => $folder->id])->save();
        Applications::create($this->galaxy->fresh(), $this->staff, ['client_id' => $client->id]);

        return $folder;
    }

    private function sitePuts(): int
    {
        return Http::recorded()->filter(fn ($pair) => $pair[0]->method() === 'PUT'
            && str_contains($pair[0]->url(), '/drives/'.self::SITE.'/'))->count();
    }

    // ── the fake drives ────────────────────────────────────────────────

    private function newDrive(string $driveId, string $rootId): void
    {
        $this->roots[$driveId] = $rootId;
        $this->store[$driveId] = [$rootId => [
            'id' => $rootId, 'name' => 'root', 'parent' => null, 'folder' => true,
            'content' => null, 'v' => 1, 'by' => 'user', 'root' => true,
        ]];
    }

    private function addItem(string $driveId, ?string $parent, string $name, bool $folder, ?string $content = null, string $by = 'user'): array
    {
        $id = $driveId.'-'.(++$this->seq);

        return $this->store[$driveId][$id] = [
            'id' => $id, 'name' => $name, 'parent' => $parent, 'folder' => $folder,
            'content' => $content, 'v' => 1, 'by' => $by,
        ];
    }

    private function childNamed(string $driveId, ?string $parent, string $name): ?array
    {
        foreach ($this->store[$driveId] as $item) {
            if ($item['parent'] === $parent && strcasecmp($item['name'], $name) === 0) {
                return $item;
            }
        }

        return null;
    }

    /** @return list<array> */
    private function itemsUnder(string $driveId, string $parent): array
    {
        return array_values(array_filter($this->store[$driveId], fn ($item) => $item['parent'] === $parent));
    }

    private function childAt(string $driveId, array $path): ?array
    {
        $node = $this->store[$driveId][$this->roots[$driveId]];
        foreach ($path as $name) {
            $node = $this->childNamed($driveId, $node['id'], $name);
            if (! $node) {
                return null;
            }
        }

        return $node;
    }

    private function contentAt(string $driveId, array $path): ?string
    {
        return $this->childAt($driveId, $path)['content'] ?? null;
    }

    private function uniqueName(string $driveId, string $parent, string $name): string
    {
        $candidate = $name;
        $ext = pathinfo($name, PATHINFO_EXTENSION);
        $base = $ext !== '' ? substr($name, 0, -strlen($ext) - 1) : $name;
        for ($i = 1; $this->childNamed($driveId, $parent, $candidate); $i++) {
            $candidate = $base.' '.$i.($ext !== '' ? '.'.$ext : '');
        }

        return $candidate;
    }

    private function graphItem(string $driveId, array $item): array
    {
        $out = [
            'id' => $item['id'], 'name' => $item['name'],
            'eTag' => '"'.$item['id'].','.$item['v'].'"', 'cTag' => 'c:'.$item['id'].':'.$item['v'],
            'parentReference' => ['id' => $item['parent'], 'driveId' => $driveId],
            'webUrl' => 'https://tmant.sharepoint.com/'.$driveId.'/'.rawurlencode($item['name']),
            'createdDateTime' => now()->toIso8601String(),
            'lastModifiedDateTime' => now()->toIso8601String(),
            'lastModifiedBy' => $item['by'] === 'app'
                ? ['application' => ['id' => 'test-client', 'displayName' => 'Portal']]
                : ['user' => ['displayName' => 'Someone']],
        ];
        if (! empty($item['root'])) {
            $out['root'] = new \stdClass;
        }
        if ($item['folder']) {
            return $out + ['folder' => ['childCount' => count($this->itemsUnder($driveId, $item['id']))]];
        }

        $stream = fopen('php://memory', 'r+');
        fwrite($stream, (string) $item['content']);
        rewind($stream);
        $hash = QuickXorHash::ofStream($stream);
        fclose($stream);

        return $out + ['size' => strlen((string) $item['content']),
            'file' => ['mimeType' => 'application/pdf', 'hashes' => ['quickXorHash' => $hash]]];
    }

    private function fakeGraph(): void
    {
        Http::fake(function (Request $request) {
            $url = $request->url();
            if (str_contains($url, 'login.microsoftonline.com')) {
                return Http::response(['access_token' => 'tok', 'expires_in' => 3600]);
            }

            $parts = parse_url($url);
            $path = rawurldecode((string) preg_replace('#^/v1\.0#', '', $parts['path'] ?? ''));
            $query = $parts['query'] ?? '';
            $method = $request->method();
            $notFound = Http::response(['error' => ['code' => 'itemNotFound', 'message' => 'Item not found']], 404);

            if ($method === 'POST' && $path === '/subscriptions') {
                return Http::response(['id' => 'sub-'.(++$this->seq), 'expirationDateTime' => now()->addDays(2)->toIso8601String()]);
            }
            if (preg_match('#^/sites/[^/]+/drives$#', $path)) {
                return Http::response(['value' => [['id' => self::SITE, 'name' => 'Documents']]]);
            }
            if (preg_match('#^/sites/.+$#', $path)) {
                return Http::response(['id' => 'site-cip', 'displayName' => 'TMA CIP Applications Portal',
                    'webUrl' => 'https://tmant.sharepoint.com/sites/tmacipapplicationsportal']);
            }

            if (preg_match('#^/drives/([^/]+)/items/([^/:]+):/(.+):/content$#', $path, $m) && $method === 'PUT') {
                [, $drive, $parent, $name] = $m;
                $existing = $this->childNamed($drive, $parent, $name);
                if ($existing && str_contains($query, 'conflictBehavior=replace')) {
                    $this->store[$drive][$existing['id']]['content'] = $request->body();
                    $this->store[$drive][$existing['id']]['v']++;
                    $this->store[$drive][$existing['id']]['by'] = 'app';

                    return Http::response($this->graphItem($drive, $this->store[$drive][$existing['id']]));
                }
                if ($existing && str_contains($query, 'conflictBehavior=fail')) {
                    return Http::response(['error' => ['code' => 'nameAlreadyExists']], 409);
                }

                return Http::response($this->graphItem($drive, $this->addItem($drive, $parent,
                    $this->uniqueName($drive, $parent, $name), false, $request->body(), 'app')), 201);
            }
            if (preg_match('#^/drives/([^/]+)/items/([^/:]+):/(.+)$#', $path, $m) && $method === 'GET') {
                $child = $this->childNamed($m[1], $m[2], $m[3]);

                return $child ? Http::response($this->graphItem($m[1], $child)) : $notFound;
            }
            if (preg_match('#^/drives/([^/]+)/items/([^/]+)/content$#', $path, $m)) {
                $item = $this->store[$m[1]][$m[2]] ?? null;
                if (! $item) {
                    return $notFound;
                }
                if ($method === 'PUT') {
                    $this->store[$m[1]][$m[2]]['content'] = $request->body();
                    $this->store[$m[1]][$m[2]]['v']++;
                    $this->store[$m[1]][$m[2]]['by'] = 'app';

                    return Http::response($this->graphItem($m[1], $this->store[$m[1]][$m[2]]));
                }

                return Http::response((string) $item['content']);
            }
            if (preg_match('#^/drives/([^/]+)/(?:items/([^/]+)|root)/children$#', $path, $m)) {
                $drive = $m[1];
                $parent = ($m[2] ?? '') !== '' ? $m[2] : $this->roots[$drive];
                if ($method === 'POST') {
                    $name = $this->uniqueName($drive, $parent, (string) ($request->data()['name'] ?? 'folder'));

                    return Http::response($this->graphItem($drive, $this->addItem($drive, $parent, $name, true, null, 'app')), 201);
                }

                return Http::response(['value' => array_map(fn ($item) => $this->graphItem($drive, $item), $this->itemsUnder($drive, $parent))]);
            }
            if (preg_match('#^/drives/([^/]+)/root/delta$#', $path, $m)) {
                return Http::response([
                    'value' => array_map(fn ($item) => $this->graphItem($m[1], $item), array_values($this->store[$m[1]])),
                    '@odata.deltaLink' => 'https://graph.microsoft.com/v1.0/drives/'.$m[1].'/root/delta?token=T'.(++$this->seq),
                ]);
            }
            if (preg_match('#^/drives/([^/]+)/root$#', $path, $m)) {
                return Http::response($this->graphItem($m[1], $this->store[$m[1]][$this->roots[$m[1]]]));
            }
            if (preg_match('#^/drives/([^/]+)/items/([^/]+)$#', $path, $m)) {
                [, $drive, $id] = $m;
                if (! isset($this->store[$drive][$id])) {
                    return $notFound;
                }
                if ($method === 'DELETE') {
                    unset($this->store[$drive][$id]);

                    return Http::response('', 204);
                }
                if ($method === 'PATCH') {
                    $data = $request->data();
                    $parent = $data['parentReference']['id'] ?? $this->store[$drive][$id]['parent'];
                    $name = $data['name'] ?? $this->store[$drive][$id]['name'];
                    $clash = $this->childNamed($drive, $parent, $name);
                    if ($clash && $clash['id'] !== $id) {
                        return Http::response(['error' => ['code' => 'nameAlreadyExists', 'message' => 'Name already exists']], 409);
                    }
                    $this->store[$drive][$id]['parent'] = $parent;
                    $this->store[$drive][$id]['name'] = $name;
                    $this->store[$drive][$id]['v']++;
                }

                return Http::response($this->graphItem($drive, $this->store[$drive][$id]));
            }

            return Http::response(['error' => ['code' => 'unhandled', 'message' => $method.' '.$path]], 500);
        });
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
}
