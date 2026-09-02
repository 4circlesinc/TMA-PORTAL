<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\FileItem;
use App\Models\FileLibrarySetting;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Files are shared with the whole firm by default.
 *
 * Most of these tests exist for the exclusions rather than the rule. Getting
 * the rule wrong shows a colleague a document early; getting the exclusions
 * wrong publishes a client's contracts to everyone, which is the failure that
 * actually matters.
 */
class FileOrgDefaultAccessTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type, string $email): User
    {
        $u = User::create(['name' => ucfirst(explode('@', $email)[0]), 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function folder(User $owner, string $name, array $attrs = []): Folder
    {
        return Folder::create(array_merge([
            'uuid' => (string) Str::uuid(), 'name' => $name,
            'owner_id' => $owner->id, 'created_by' => $owner->id,
        ], $attrs));
    }

    private function file(User $owner, ?Folder $folder): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(), 'folder_id' => $folder?->id,
            'name' => 'Doc.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 10, 'disk' => 'local', 'storage_path' => 'vault/d.pdf',
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    /**
     * A synced personal OneDrive is NOT firm property.
     *
     * A SharePoint library is shared by intent; somebody's OneDrive holds
     * meeting recordings, auto-saved chat attachments and drafts they never
     * chose to publish. The firm-wide default covers staff folders and the File
     * Box, but it must stop at the edge of a personal drive — the owner decides
     * who sees their own files, one at a time.
     */
    public function test_a_synced_personal_onedrive_is_not_shared_with_the_firm(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        // Typed the way the connect flow used to make it: an all-staff
        // organization folder. That grant is what actually leaked, and it is
        // not something organizationDefaultRole can take back.
        $drive = $this->folder($olive, "Olive's OneDrive", [
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff', 'audience_role' => 'editor',
        ]);
        $file = $this->file($olive, $drive);

        // Before it is linked to a personal drive it is ordinary firm content.
        $this->assertNotNull(FileAccess::fileRole($ben, $file), 'baseline: normally firm-wide');

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $olive->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        // Now it is Olive's, and only Olive's.
        $this->assertNull(FileAccess::fileRole($ben, $file->fresh()),
            'a colleague must not reach into a personal drive');
        $this->assertNotNull(FileAccess::fileRole($olive, $file->fresh()),
            'the owner still has their own files');
    }

    /**
     * The listing must not ADVERTISE access that does not exist.
     *
     * The Owner column draws "everyone on this item" as faces, and it used to
     * merge every administrator onto every row — right on files inside a
     * personal drive, where administrators hold nothing. The owner read it as
     * "the admins can open my OneDrive". Faces and the +N count must both
     * stop at the owner plus explicit shares.
     */
    public function test_the_listing_does_not_advertise_admins_on_personal_drive_rows(): void
    {
        $olive = User::factory()->create([
            'email' => 'olive@example.com', 'account_type' => 'Reviewing Officer',
            'status' => 'approved', 'email_verified_at' => now(),
            'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
        $this->user('Administrator', 'root@example.com');
        $this->user('Administrator', 'boss@example.com');

        $drive = $this->folder($olive, "Olive's OneDrive");
        $this->file($olive, $drive);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $olive->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $rows = $this->actingAs($olive)
            ->getJson('/portal/files/?folder='.$drive->uuid)
            ->assertOk();

        foreach ($rows->json('files') as $row) {
            $this->assertSame([$olive->id], array_column($row['people'], 'userId'),
                'only the owner may be drawn on a personal-drive row');
            $this->assertSame(1, $row['peopleTotal']);
        }
    }

    /**
     * A colleague must not even see the FOLDER, let alone its files.
     *
     * fileRole and folderRole are separate doors. Closing only the first leaves
     * a personal drive browsable — and with `audience_role = editor`, editable.
     */
    public function test_a_colleague_cannot_open_the_personal_drive_folder_itself(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $drive = $this->folder($olive, "Olive's OneDrive", [
            'folder_type' => Folder::TYPE_ORGANIZATION,
            'audience' => 'all_staff', 'audience_role' => 'editor',
        ]);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $olive->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $this->assertNull(FileAccess::folderRole($ben, $drive),
            'a personal drive folder is not browsable by colleagues');
        $this->assertSame('full', FileAccess::folderRole($olive, $drive),
            'the owner still has their own drive');
    }

    /**
     * Everyone reaches their OWN drive, in full.
     *
     * The privacy rule cuts both ways: locking colleagues out is only correct
     * if it does not also lock the owner out of their own files. The drive
     * belongs to whoever it belongs to, matched on the address it was synced
     * from — not to the administrator who happened to run the connect command.
     */
    public function test_each_person_has_full_access_to_their_own_drive(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $oliveDrive = $this->folder($olive, "OneDrive — olive");
        $benDrive = $this->folder($ben, "OneDrive — ben");
        $oliveFile = $this->file($olive, $oliveDrive);
        $benFile = $this->file($ben, $benDrive);

        foreach ([[$oliveDrive, $olive], [$benDrive, $ben]] as [$folder, $owner]) {
            \App\Models\SharePointConnection::create([
                'uuid' => (string) Str::uuid(),
                'site_id' => 'personal', 'drive_id' => 'drive-'.$owner->id,
                'drive_kind' => 'onedrive', 'owner_upn' => $owner->email,
                'folder_id' => $folder->id, 'created_by' => $owner->id,
                'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
            ]);
        }

        // Each person, their own drive: everything.
        $this->assertSame('full', FileAccess::folderRole($olive, $oliveDrive));
        $this->assertSame('full', FileAccess::fileRole($olive, $oliveFile));
        $this->assertSame('full', FileAccess::folderRole($ben, $benDrive));
        $this->assertSame('full', FileAccess::fileRole($ben, $benFile));

        // Each person, the other's drive: nothing.
        $this->assertNull(FileAccess::folderRole($olive, $benDrive));
        $this->assertNull(FileAccess::fileRole($olive, $benFile));
        $this->assertNull(FileAccess::folderRole($ben, $oliveDrive));
        $this->assertNull(FileAccess::fileRole($ben, $oliveFile));
    }

    /**
     * Not even an administrator.
     *
     * `isAdmin` grants 'full' over the whole library and runs before every
     * other rule, so an administrator could read every colleague's drafts and
     * meeting recordings. "Nobody accesses anyone else's OneDrive" has to
     * include the person with the keys, or it does not mean anything.
     *
     * Their files remain reachable in Microsoft 365 by a tenant admin — that
     * is where the decision to open someone's drive belongs.
     */
    public function test_an_administrator_cannot_read_someone_elses_drive(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $boss = $this->user('Administrator', 'boss@example.com');

        $drive = $this->folder($olive, "OneDrive — olive");
        $file = $this->file($olive, $drive);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $boss->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $this->assertNull(FileAccess::fileRole($boss, $file),
            'an administrator must not read a personal drive');
        $this->assertNull(FileAccess::folderRole($boss, $drive),
            'nor browse it');

        // The admin keeps full reach over ordinary firm content.
        $ordinary = $this->file($olive, null);
        $this->assertSame('full', FileAccess::fileRole($boss, $ordinary));
    }

    /** Even the admin who ran the connect command owns nothing by doing so. */
    public function test_connecting_someone_elses_drive_does_not_grant_the_connector_access(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $boss = $this->user('Administrator', 'boss@example.com');

        // owner_id is the drive's real owner, created_by the admin who linked it.
        $drive = $this->folder($olive, "OneDrive — olive");
        $drive->forceFill(['created_by' => $boss->id])->save();
        $file = $this->file($olive, $drive);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $boss->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $this->assertNull(FileAccess::fileRole($boss, $file));
        $this->assertSame('full', FileAccess::fileRole($olive, $file));
    }

    /** Nested just as private as the root — the whole tree is personal. */
    public function test_a_subfolder_of_a_personal_onedrive_is_private_too(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $drive = $this->folder($olive, "Olive's OneDrive");
        $nested = $this->folder($olive, 'Recordings', ['parent_id' => $drive->id]);
        $file = $this->file($olive, $nested);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $olive->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $this->assertNull(FileAccess::fileRole($ben, $file),
            'depth must not restore the firm-wide default');
    }

    /** A shared SITE library is unaffected — that IS shared by intent. */
    public function test_a_synced_sharepoint_library_stays_firm_wide(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $library = $this->folder($olive, 'Citizenship Applications');
        $file = $this->file($olive, $library);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'site-1', 'drive_id' => 'drive-1',
            'drive_kind' => 'site', 'folder_id' => $library->id,
            'created_by' => $olive->id, 'status' => 'idle',
            'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        $this->assertNotNull(FileAccess::fileRole($ben, $file),
            'a site library is shared by intent and stays firm-wide');
    }

    /** An explicit share still works — the owner chooses, per person. */
    public function test_the_owner_can_still_share_a_personal_file_with_one_person(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');
        $cara = $this->user('Employee', 'cara@example.com');

        $drive = $this->folder($olive, "Olive's OneDrive");
        $file = $this->file($olive, $drive);

        \App\Models\SharePointConnection::create([
            'uuid' => (string) Str::uuid(),
            'site_id' => 'personal', 'drive_id' => 'drive-olive',
            'drive_kind' => 'onedrive', 'owner_upn' => 'olive@example.com',
            'folder_id' => $drive->id, 'created_by' => $olive->id,
            'status' => 'idle', 'sync_enabled' => true, 'direction' => 'two-way',
        ]);

        \App\Models\Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id, 'shared_by' => $olive->id,
            'kind' => 'user', 'target_user_id' => $ben->id, 'role' => 'viewer',
        ]);

        $this->assertNotNull(FileAccess::fileRole($ben, $file), 'the chosen person sees it');
        $this->assertNull(FileAccess::fileRole($cara, $file), 'nobody else does');
    }

    public function test_an_ordinary_file_is_visible_to_the_whole_firm(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $file = $this->file($olive, $this->folder($olive, 'Templates'));

        $this->assertSame('downloader', FileAccess::fileRole($ben, $file));
        $this->assertTrue(FileAccess::can($ben, 'view', $file));
        $this->assertTrue(FileAccess::can($ben, 'download', $file));
        // The default is deliberately not editor: everyone can read the firm's
        // documents, not rewrite them.
        $this->assertFalse(FileAccess::can($ben, 'delete', $file));
    }

    /** The exclusion that matters most. */
    public function test_a_client_folder_is_never_opened_up_by_the_default(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');
        $unassigned = $this->user('Employee', 'nobody@example.com');

        $client = Client::create(['uid' => 'acme', 'name' => 'Acme', 'data' => [], 'created_by' => $admin->id]);
        $clientFolder = $this->folder($admin, 'Acme', [
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
        ]);
        $sub = $this->folder($admin, 'Contracts', ['parent_id' => $clientFolder->id]);

        $inFolder = $this->file($admin, $clientFolder);
        $nested = $this->file($admin, $sub);

        $this->assertNull(FileAccess::fileRole($unassigned, $inFolder),
            'a client file must not become firm-wide reading');
        $this->assertNull(FileAccess::fileRole($unassigned, $nested),
            'nor must one nested inside a client folder');
    }

    /**
     * Decided by the firm: staff folders are a filing convenience, not a
     * privacy boundary. They are firm-wide like everything else.
     */
    public function test_a_personal_staff_folder_is_also_firm_wide(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $personal = $this->folder($olive, 'Olive', [
            'folder_type' => Folder::TYPE_STAFF, 'subject_user_id' => $olive->id,
        ]);
        $file = $this->file($olive, $personal);

        $this->assertSame('downloader', FileAccess::fileRole($ben, $file));
    }

    public function test_an_unfiled_file_box_upload_is_also_firm_wide(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');

        $file = $this->file($olive, null);   // File Box

        $this->assertSame('downloader', FileAccess::fileRole($ben, $file));
    }

    /** Clients are staff-excluded, so this can never widen what they see. */
    public function test_a_client_account_gains_nothing_from_the_default(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $client = $this->user('Client', 'dora@example.com');

        $file = $this->file($olive, $this->folder($olive, 'Internal'));

        $this->assertNull(FileAccess::fileRole($client, $file),
            'the firm-wide default must never reach a client account');
    }

    public function test_an_administrator_can_turn_the_default_off(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');
        $file = $this->file($olive, $this->folder($olive, 'Templates'));

        $this->assertNotNull(FileAccess::fileRole($ben, $file));

        FileLibrarySetting::put(['defaultOrgAccess' => false]);

        $this->assertNull(FileAccess::fileRole($ben, $file),
            'turning it off must actually close access');
    }

    public function test_the_default_role_is_configurable(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');
        $file = $this->file($olive, $this->folder($olive, 'Templates'));

        FileLibrarySetting::put(['defaultOrgRole' => 'viewer']);

        $this->assertSame('viewer', FileAccess::fileRole($ben, $file));
        $this->assertFalse(FileAccess::can($ben, 'download', $file));
    }

    public function test_an_explicit_share_still_wins_when_it_grants_more(): void
    {
        $olive = $this->user('Employee', 'olive@example.com');
        $ben = $this->user('Employee', 'ben@example.com');
        $file = $this->file($olive, $this->folder($olive, 'Templates'));

        \App\Models\Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id, 'shared_by' => $olive->id,
            'kind' => 'user', 'target_user_id' => $ben->id, 'role' => 'editor',
        ]);

        $this->assertSame('editor', FileAccess::fileRole($ben, $file));
    }

    public function test_the_access_panel_reports_it_as_one_firm_wide_source(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com');
        for ($i = 1; $i <= 6; $i++) {
            $this->user('Employee', "staff{$i}@example.com");
        }
        $file = $this->file($admin, $this->folder($admin, 'Templates'));

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();

        $org = collect($res->json('sources'))->firstWhere('key', 'organization:default');
        $this->assertNotNull($org);
        $this->assertSame(7, $org['total'], '1 admin + 6 employees, as one row not seven');
        $this->assertStringContainsString('Everyone in', $org['label']);

        // And the face stack summarises it the same way.
        $this->assertStringContainsString('Everyone in', $res->json('shared.summary'));
        $this->assertCount(5, $res->json('shared.faces'));
        $this->assertSame(2, $res->json('shared.extra'));
    }
}
