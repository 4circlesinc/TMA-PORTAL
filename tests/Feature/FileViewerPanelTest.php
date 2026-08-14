<?php

namespace Tests\Feature;

use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\Share;
use App\Models\User;
use App\Support\Files\Activity;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The collaboration viewer's panel endpoints: activity, access and details.
 *
 * These are read-only, but they are the surface that reports *who can see a
 * file* — so the access checks matter as much as the payload shape.
 */
class FileViewerPanelTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $type = 'Administrator', string $email = 'a@example.com'): User
    {
        $u = User::create(['name' => 'Test '.$type, 'email' => $email, 'password' => bcrypt('password12345')]);
        $u->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved', 'account_type' => $type,
        ])->save();

        return $u;
    }

    private function file(User $owner, ?Folder $folder = null): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'folder_id' => $folder?->id,
            'name' => 'Brief.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => 2048, 'disk' => 'local', 'storage_path' => 'vault/brief.pdf',
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    public function test_activity_returns_real_logged_events_newest_first(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        Activity::forFile($user->id, $file, 'upload');
        Activity::forFile($user->id, $file, 'download');

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/activity")->assertOk();

        $res->assertJsonPath('entries.0.action', 'download')
            ->assertJsonPath('entries.1.action', 'upload')
            ->assertJsonPath('entries.0.text', 'downloaded this file')
            // The actor keeps their real name; `isSelf` is what makes the
            // client write "You", so the avatar can still use their initials.
            ->assertJsonPath('entries.0.actor.name', 'Test Administrator')
            ->assertJsonPath('entries.0.actor.isSelf', true)
            ->assertJsonPath('entries.0.group', 'Today');
    }

    public function test_activity_filter_narrows_to_one_kind(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        Activity::forFile($user->id, $file, 'upload');
        Activity::forFile($user->id, $file, 'download');
        Activity::forFile($user->id, $file, 'share', ['to' => 'Ben']);

        $res = $this->actingAs($user)
            ->getJson("/portal/files/files/{$file->uuid}/activity?filter=downloads")
            ->assertOk();

        $this->assertCount(1, $res->json('entries'));
        $res->assertJsonPath('entries.0.action', 'download')
            ->assertJsonPath('filter', 'downloads');
    }

    public function test_activity_is_empty_rather_than_invented_for_a_file_with_no_history(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/activity")
            ->assertOk()
            ->assertJsonPath('entries', [])
            ->assertJsonPath('nextCursor', null);
    }

    public function test_activity_pages_with_a_cursor_and_never_repeats_a_row(): void
    {
        $user = $this->user();
        $file = $this->file($user);

        for ($i = 0; $i < 25; $i++) {
            Activity::forFile($user->id, $file, 'download');
        }

        $first = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/activity")->assertOk();
        $this->assertCount(20, $first->json('entries'));
        $cursor = $first->json('nextCursor');
        $this->assertNotNull($cursor);

        $second = $this->actingAs($user)
            ->getJson("/portal/files/files/{$file->uuid}/activity?before={$cursor}")
            ->assertOk();

        $this->assertCount(5, $second->json('entries'));
        $this->assertNull($second->json('nextCursor'));

        $firstIds = array_column($first->json('entries'), 'id');
        $secondIds = array_column($second->json('entries'), 'id');
        $this->assertSame([], array_intersect($firstIds, $secondIds), 'a row appeared on both pages');
    }

    /**
     * Files are firm-wide by default now, so a colleague CAN read these — that
     * is the intended behaviour. A client account still cannot, and that is the
     * boundary worth guarding.
     */
    public function test_a_client_cannot_read_activity_or_access(): void
    {
        $owner = $this->user('Employee', 'owner@example.com');
        $client = $this->user('Client', 'client@example.com');
        $file = $this->file($owner);

        $this->actingAs($client)->getJson("/portal/files/files/{$file->uuid}/activity")->assertForbidden();
        $this->actingAs($client)->getJson("/portal/files/files/{$file->uuid}/access")->assertForbidden();
        $this->actingAs($client)->getJson("/portal/files/files/{$file->uuid}/details")->assertForbidden();
    }

    public function test_a_colleague_can_read_a_firm_wide_file(): void
    {
        $owner = $this->user('Employee', 'owner@example.com');
        $colleague = $this->user('Reviewing Officer', 'colleague@example.com');
        $file = $this->file($owner);

        $this->actingAs($colleague)->getJson("/portal/files/files/{$file->uuid}/details")->assertOk();
    }

    public function test_access_reports_an_organization_folder_as_one_source_not_many_users(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com');
        $this->user('Employee', 'staff1@example.com');
        $this->user('Employee', 'staff2@example.com');

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Policies',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'viewer',
        ]);
        $file = $this->file($admin, $folder);

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();

        $labels = array_column($res->json('sources'), 'label');
        $org = collect($res->json('sources'))->firstWhere('key', 'organization:'.$folder->id);

        $this->assertNotNull($org, 'organization source missing: '.json_encode($labels));
        $this->assertSame('Can view', $org['role']);
        // 3 staff (1 admin + 2 employees) as ONE row, not three top-level rows.
        $this->assertSame(3, $org['total']);
        $this->assertStringContainsString('Organization folder', $org['origin']);
    }

    public function test_access_lists_the_assigned_client_team_for_a_client_folder(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com');
        $staff = $this->user('Employee', 'assigned@example.com');

        $client = \App\Models\Client::create([
            'uid' => 'acme', 'name' => 'Acme', 'data' => [], 'created_by' => $admin->id,
        ]);
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Acme',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
        ]);
        ClientAssignment::create([
            'client_id' => $client->id, 'user_id' => $staff->id,
            'permission_level' => 'view_only', 'is_primary' => true,
        ]);

        $file = $this->file($admin, $folder);
        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();

        $team = collect($res->json('sources'))->firstWhere('key', 'client:'.$folder->id);
        $this->assertNotNull($team);
        $this->assertSame('Assigned client team', $team['label']);
        $this->assertSame(['assigned@example.com'], array_column($team['members'], 'email'));
    }

    /**
     * The face stack: five real pictures then "+N", de-duplicated across
     * sources, with a head-count that reflects the widest source rather than
     * however many faces happened to be previewed.
     */
    public function test_the_shared_with_stack_shows_faces_and_a_plus_count(): void
    {
        $admin = $this->user('Administrator', 'admin@example.com');
        for ($i = 1; $i <= 9; $i++) {
            $this->user('Employee', "staff{$i}@example.com");
        }

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Policies',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'viewer',
        ]);
        $file = $this->file($admin, $folder);

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();

        $shared = $res->json('shared');
        $this->assertCount(5, $shared['faces'], 'exactly five faces before the +N');
        $this->assertSame(10, $shared['total'], '1 admin + 9 employees');
        $this->assertSame(5, $shared['extra'], 'the +N covers the rest');
        // By default an organization file is shared with the whole firm, and
        // the summary says so rather than listing ten names.
        $this->assertStringContainsString('Everyone in', $shared['summary']);
    }

    public function test_the_stack_does_not_show_the_same_person_twice(): void
    {
        // An administrator is both the owner AND in the Administrators source.
        $admin = $this->user('Administrator', 'admin@example.com');
        $file = $this->file($admin);

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();

        $emails = array_column($res->json('shared.all'), 'email');
        $this->assertSame(array_unique($emails), $emails, 'one face per person');
        // Firm-wide by default, so the summary names the firm rather than
        // claiming the file is private.
        $this->assertStringContainsString('Everyone in', $res->json('shared.summary'));
    }

    public function test_access_lists_specific_people_and_links_separately(): void
    {
        $owner = $this->user('Administrator', 'owner@example.com');
        $friend = $this->user('Employee', 'friend@example.com');
        $file = $this->file($owner);

        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id,
            'shared_by' => $owner->id, 'kind' => 'user', 'target_user_id' => $friend->id,
            'role' => 'editor',
        ]);
        Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id,
            'shared_by' => $owner->id, 'kind' => 'link', 'role' => 'viewer',
        ]);

        $res = $this->actingAs($owner)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();
        $sources = collect($res->json('sources'));

        $specific = $sources->firstWhere('key', 'specific');
        $this->assertSame('Can edit', $specific['members'][0]['role']);

        $links = $sources->firstWhere('key', 'links');
        $this->assertSame('Anyone with the link', $links['members'][0]['name']);
    }

    public function test_a_revoked_share_disappears_from_access(): void
    {
        $owner = $this->user('Administrator', 'owner@example.com');
        $friend = $this->user('Employee', 'friend@example.com');
        $file = $this->file($owner);

        $share = Share::create([
            'uuid' => (string) Str::uuid(), 'token' => Str::random(32),
            'item_type' => 'file', 'item_id' => $file->id,
            'shared_by' => $owner->id, 'kind' => 'user', 'target_user_id' => $friend->id,
            'role' => 'editor',
        ]);

        $share->update(['revoked_at' => now()]);

        $res = $this->actingAs($owner)->getJson("/portal/files/files/{$file->uuid}/access")->assertOk();
        $this->assertNull(collect($res->json('sources'))->firstWhere('key', 'specific'));
    }

    public function test_details_reports_real_metadata_and_omits_fields_that_do_not_apply(): void
    {
        $user = $this->user();
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Contracts',
            'owner_id' => $user->id, 'created_by' => $user->id,
        ]);
        $file = $this->file($user, $folder);

        $res = $this->actingAs($user)->getJson("/portal/files/files/{$file->uuid}/details")->assertOk();

        $rows = [];
        foreach ($res->json('groups') as $group) {
            foreach ($group['rows'] as $row) {
                $rows[$row['label']] = $row['value'];
            }
        }

        $this->assertSame('Brief.pdf', $rows['File name']);
        $this->assertSame('PDF document', $rows['File type']);
        $this->assertSame('application/pdf', $rows['MIME type']);
        $this->assertSame('2 KB', $rows['File size']);
        $this->assertSame('/Contracts', $rows['Portal path']);
        $this->assertSame($file->uuid, $rows['Record ID']);

        // Nothing is in SharePoint yet, so those rows must be absent rather
        // than rendered blank — a blank "Sync status" reads as a failure.
        $this->assertArrayNotHasKey('SharePoint item ID', $rows);
        $this->assertArrayNotHasKey('Sync status', $rows);
        $this->assertArrayNotHasKey('Document library', $rows);
    }

    public function test_details_names_the_related_client_for_a_file_in_a_client_folder(): void
    {
        $admin = $this->user();
        $client = \App\Models\Client::create([
            'uid' => 'acme', 'name' => 'Acme Corp', 'data' => [], 'created_by' => $admin->id,
        ]);
        $root = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Acme Corp',
            'owner_id' => $admin->id, 'created_by' => $admin->id,
            'folder_type' => Folder::TYPE_CLIENT, 'client_id' => $client->id,
        ]);
        // Nested, so the walk up the chain is what finds the client.
        $sub = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Invoices', 'parent_id' => $root->id,
            'owner_id' => $admin->id, 'created_by' => $admin->id,
        ]);
        $file = $this->file($admin, $sub);

        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/details")->assertOk();

        $rows = [];
        foreach ($res->json('groups') as $group) {
            foreach ($group['rows'] as $row) {
                $rows[$row['label']] = $row['value'];
            }
        }

        $this->assertSame('Acme Corp', $rows['Related client']);
        $this->assertSame('/Acme Corp/Invoices', $rows['Portal path']);
    }
}
