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
