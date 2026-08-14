<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Access\PortalPermissions;
use App\Support\Access\Role;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Account settings > Advanced Preferences > Permissions.
 *
 * This page replaced a pair of radio buttons that saved to localStorage and
 * decided nothing. So the tests worth having are the ones that prove the
 * toggles *bite*: the directory one has to take the People API and the
 * browser's capability list with it, and the sharing one has to stop a real
 * POST to /portal/files/shares — not just grey out a button.
 */
class PortalPermissionsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // The settings memoize per request; a test process is one process.
        PortalPermissions::flush();
    }

    private function user(string $type): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** The payload the screen sends: every managed capability, every time. */
    private function payload(array $employee = [], array $rest = []): array
    {
        return array_merge([
            'employee' => array_merge(Role::baselineGrantsFor(PortalPermissions::MANAGED), $employee),
            'clientSharing' => false,
        ], $rest);
    }

    private function save(User $as, array $employee = [], array $rest = []): TestResponse
    {
        $response = $this->actingAs($as)->putJson('/admin/permissions', $this->payload($employee, $rest));

        PortalPermissions::flush();

        return $response;
    }

    private function fileOwnedBy(User $owner): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Their folder',
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);

        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder->id,
            'name' => 'Doc.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 10,
            'disk' => 'local',
            'storage_path' => 'vault/d.pdf',
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ]);
    }

    /* ── defaults ────────────────────────────────────────────────────── */

    public function test_a_firm_that_never_opens_the_screen_behaves_as_it_did_before(): void
    {
        // The whole risk of adding an overlay on the capability matrix is that
        // shipping it silently changes what people can reach. It must not.
        $this->assertSame(
            Role::baselineGrantsFor(PortalPermissions::MANAGED),
            PortalPermissions::all()['employee'],
        );

        // Clients could not re-share before this setting existed either.
        $this->assertFalse(PortalPermissions::allowsClientSharing());
    }

    /* ── who may read and write the screen ───────────────────────────── */

    public function test_only_administrators_can_change_the_permissions(): void
    {
        $officer = $this->user(Role::REVIEWING_OFFICER);
        $client = $this->user(Role::CLIENT);

        // An officer cannot even open it — `settings.advanced` is admin-only.
        $this->actingAs($officer)->getJson('/admin/permissions')->assertForbidden();
        $this->actingAs($client)->getJson('/admin/permissions')->assertForbidden();

        $this->save($officer)->assertForbidden();
        $this->save($client)->assertForbidden();

        $this->save($this->user(Role::ADMINISTRATOR))->assertOk();
    }

    /* ── the directory toggle ────────────────────────────────────────── */

    public function test_granting_the_directory_opens_the_people_section_to_employees(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE);

        $this->assertFalse(Role::can($employee, 'directory.view'));

        $this->save($admin, ['directory.view' => true])->assertOk();

        $this->assertTrue(Role::can($employee->fresh(), 'directory.view'));

        // The page gate moves with it, not just the capability — that split is
        // what let an employee reach a shell the API then refused.
        $this->assertTrue(Role::canViewPage($employee->fresh(), 'people/employees'));
    }

    public function test_revoking_the_directory_closes_it_again(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $employee = $this->user(Role::EMPLOYEE);

        $this->save($admin, ['directory.view' => true])->assertOk();
        $this->assertTrue(Role::can($employee->fresh(), 'directory.view'));

        $this->save($admin, ['directory.view' => false])->assertOk();

        $this->assertFalse(Role::can($employee->fresh(), 'directory.view'));
        $this->assertFalse(Role::canViewPage($employee->fresh(), 'people/employees'));
    }

    public function test_the_directory_toggle_never_reaches_clients(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = $this->user(Role::CLIENT);

        $this->save($admin, ['directory.view' => true])->assertOk();

        // The People section is the firm's own directory. "Show it to
        // non-administrators" is a question about employees; a client
        // enumerating the firm is never the answer.
        $this->assertFalse(Role::can($client->fresh(), 'directory.view'));
    }

    public function test_an_administrator_keeps_the_directory_whatever_is_saved(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);

        $this->save($admin, ['directory.view' => false])->assertOk();

        // Role::can short-circuits for administrators before it reaches the
        // overlay, so nobody can revoke their own way back in.
        $this->assertTrue(Role::can($admin->fresh(), 'directory.view'));
    }

    /* ── the client sharing toggle ───────────────────────────────────── */

    public function test_a_client_cannot_share_their_own_file_onward_by_default(): void
    {
        $client = $this->user(Role::CLIENT);
        $file = $this->fileOwnedBy($client);

        // They own it outright — ownership is what would otherwise grant this.
        $this->assertFalse(FileAccess::can($client, 'share', $file));

        // And everything else they hold over it is untouched: the setting is
        // about passing files on, not about reaching their own documents.
        $this->assertTrue(FileAccess::can($client, 'download', $file));
        $this->assertTrue(FileAccess::can($client, 'rename', $file));
    }

    public function test_the_share_endpoint_refuses_a_client_while_sharing_is_off(): void
    {
        $client = $this->user(Role::CLIENT);
        $file = $this->fileOwnedBy($client);

        // A hidden button is not enforcement — the POST has to fail.
        $this->actingAs($client)->postJson('/portal/files/shares', [
            'type' => 'file',
            'id' => $file->uuid,
            'mode' => 'link',
            'role' => 'viewer',
        ])->assertForbidden();
    }

    public function test_turning_client_sharing_on_lets_a_client_share(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $client = $this->user(Role::CLIENT);
        $file = $this->fileOwnedBy($client);

        $this->save($admin, [], ['clientSharing' => true])->assertOk();

        $this->assertTrue(FileAccess::can($client->fresh(), 'share', $file));

        $this->actingAs($client)->postJson('/portal/files/shares', [
            'type' => 'file',
            'id' => $file->uuid,
            'mode' => 'link',
            'role' => 'viewer',
        ])->assertCreated();
    }

    public function test_staff_sharing_is_never_affected_by_the_client_setting(): void
    {
        $employee = $this->user(Role::EMPLOYEE);
        $file = $this->fileOwnedBy($employee);

        // Sharing is off (the default) and stays off for clients — but the
        // rule asks about clients specifically, so staff must be untouched.
        $this->assertFalse(PortalPermissions::allowsClientSharing());
        $this->assertTrue(FileAccess::can($employee, 'share', $file));
    }

    /* ── the screen's own payload ────────────────────────────────────── */

    public function test_the_screen_is_told_what_it_needs_to_render_itself(): void
    {
        $admin = $this->user(Role::ADMINISTRATOR);
        $this->user(Role::EMPLOYEE);

        $this->actingAs($admin)->getJson('/admin/permissions')
            ->assertOk()
            ->assertJsonPath('canEdit', true)
            ->assertJsonPath('clientSharing', false)
            ->assertJsonPath('capabilities.0.id', 'directory.view')
            ->assertJsonPath('capabilities.0.granted', false)
            // Labels and help text come from the server so the toggle's effect
            // is auditable somewhere other than the JS.
            ->assertJsonPath('capabilities.0.label', 'Show the People directory to employees')
            ->assertJsonPath('counts.employees', 1);
    }

    public function test_a_stored_key_that_is_no_longer_managed_cannot_grant_anything(): void
    {
        // A capability dropped from MANAGED in a later release leaves its row
        // behind. The merge must not resurrect it as a grant.
        PortalPermissions::put([
            'employee' => ['directory.view' => false, 'users.manage' => true],
            'clientSharing' => false,
        ]);

        $this->assertSame(['directory.view'], array_keys(PortalPermissions::all()['employee']));
        $this->assertFalse(Role::can($this->user(Role::EMPLOYEE), 'users.manage'));
    }
}
