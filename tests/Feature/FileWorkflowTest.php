<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\FileVersion;
use App\Models\FileWorkflow;
use App\Models\FileWorkflowStep;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\Workflow\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;
use Tests\TestCase;

class FileWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-wf-'.uniqid();
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

    /** A file everyone on staff can reach, so approvers can actually open it. */
    private function sharedFile(User $owner, string $content = 'draft one'): FileItem
    {
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(), 'name' => 'Shared',
            'owner_id' => $owner->id, 'created_by' => $owner->id,
            'folder_type' => Folder::TYPE_ORGANIZATION, 'audience' => 'all_staff',
            'audience_role' => 'editor',
        ]);

        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('Contract.txt', $content),
            'folder' => $folder->uuid,
        ])->assertCreated();

        return FileItem::latest('id')->first();
    }

    private function send(User $sender, FileItem $file, array $payload = []): array
    {
        $res = $this->actingAs($sender)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", array_merge([
                'type' => 'approval',
                'recipients' => [],
            ], $payload))
            ->assertCreated();

        return $res->json();
    }

    public function test_a_file_can_be_sent_for_approval(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id]],
            'message' => 'Please approve before Friday',
        ]);

        $this->assertSame(Status::AWAITING_APPROVAL, $wf['status']);
        $this->assertSame('Awaiting approval', $wf['statusLabel']);
        $this->assertCount(1, $wf['steps']);
        $this->assertSame('Ben Staff', $wf['steps'][0]['name']);
        $this->assertSame(1, $wf['version'], 'the request must pin the version it was sent on');

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $ben->id, 'type' => 'file.approval_requested',
        ]);
    }

    /**
     * The Approvals tab is labelled from these, so they have to move as the
     * requests do — a tab still claiming an open request after the last one was
     * answered reads as the response having failed.
     */
    public function test_the_panel_counts_open_requests_and_what_is_waiting_on_you(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($ben)->getJson("/portal/files/files/{$file->uuid}/workflows")
            ->assertOk()
            ->assertJsonPath('openCount', 1)
            ->assertJsonPath('total', 1)
            ->assertJsonPath('mineCount', 1);

        // The sender has nothing to answer, even though the request is open.
        $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")
            ->assertJsonPath('openCount', 1)
            ->assertJsonPath('mineCount', 0);

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();

        $this->actingAs($ben)->getJson("/portal/files/files/{$file->uuid}/workflows")
            ->assertJsonPath('openCount', 0)
            ->assertJsonPath('total', 1, 'the request still happened')
            ->assertJsonPath('mineCount', 0);
    }

    public function test_approving_completes_the_request_and_stamps_the_version(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'approve', 'comment' => 'Looks right',
            ])->assertOk();

        $this->assertSame(Status::APPROVED, $res->json('status'));

        // The outcome is stamped on the exact version reviewed, so an old
        // version's badge keeps telling the truth after later uploads.
        $this->assertSame(Status::APPROVED, FileVersion::where('file_id', $file->id)
            ->where('version_number', 1)->value('approval_status'));

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $admin->id, 'type' => 'file.approval_decision',
        ]);
    }

    public function test_a_decline_halts_the_whole_flow(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id], ['userId' => $cara->id]],
        ]);

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'decline', 'comment' => 'Clause 4 is wrong',
            ])->assertOk();

        $this->assertSame(Status::DECLINED, $res->json('status'));

        // Cara is spared: continuing to ask after a refusal wastes her time and
        // produces a contradictory record.
        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'approve',
            ])->assertStatus(422);
    }

    public function test_a_refusal_must_carry_a_reason(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'decline'])
            ->assertStatus(422);
    }

    public function test_require_comment_is_enforced_on_the_server(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id]], 'requireComment' => true,
        ]);

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertStatus(422);

        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'approve', 'comment' => 'Fine by me',
            ])->assertOk();
    }

    public function test_all_approvers_must_respond_when_require_all_is_set(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id], ['userId' => $cara->id]],
            'requireAll' => true,
        ]);

        $after1 = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();
        $this->assertSame(Status::AWAITING_APPROVAL, $after1->json('status'), 'one approval must not finish it');

        $after2 = $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();
        $this->assertSame(Status::APPROVED, $after2->json('status'));
    }

    public function test_any_one_approver_can_settle_it_when_require_all_is_off(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id], ['userId' => $cara->id]],
            'requireAll' => false,
        ]);

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();

        $this->assertSame(Status::APPROVED, $res->json('status'));
    }

    public function test_an_ordered_flow_asks_one_person_at_a_time(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [
                ['userId' => $ben->id, 'position' => 1],
                ['userId' => $cara->id, 'position' => 2],
            ],
            'ordered' => true,
        ]);

        // Only the first person has been asked so far.
        $this->assertDatabaseHas('portal_notifications', ['user_id' => $ben->id, 'type' => 'file.approval_requested']);
        $this->assertDatabaseMissing('portal_notifications', ['user_id' => $cara->id, 'type' => 'file.approval_requested']);

        // Cara cannot jump the queue: her step exists but has not been reached.
        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertForbidden();

        // Now that Ben has gone, Cara is invited.
        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();

        $this->assertDatabaseHas('portal_notifications', ['user_id' => $cara->id, 'type' => 'file.approval_requested']);

        // And only now can she answer.
        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();
    }

    /**
     * The rule §6 is explicit about: a new version must not silently replace
     * the version under approval.
     */
    public function test_a_new_version_supersedes_but_never_moves_the_request(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin, 'draft one');

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($admin)->post("/portal/files/files/{$file->uuid}/versions", [
            'file' => UploadedFile::fake()->createWithContent('Contract.txt', 'draft two'),
        ])->assertCreated();

        $row = FileWorkflow::first();

        // Still pinned to v1, and flagged as no longer describing the file.
        $this->assertSame(1, $row->version->version_number);
        $this->assertSame(2, $row->supersededByVersion->version_number);
        $this->assertSame(Status::AWAITING_APPROVAL, $row->status, 'it must not auto-cancel either');

        // The sender is told rather than left to discover it.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $admin->id, 'type' => 'file.workflow_superseded',
        ]);

        // And the badge admits it is stale.
        $res = $this->actingAs($admin)->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();
        $this->assertTrue($res->json('badge.stale'));
        $this->assertSame(1, $res->json('badge.appliesToVersion'));
    }

    public function test_locking_refuses_new_versions_while_the_request_is_open(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, [
            'recipients' => [['userId' => $ben->id]], 'lockFile' => true,
        ]);

        $this->actingAs($admin)->post("/portal/files/files/{$file->uuid}/versions", [
            'file' => UploadedFile::fake()->createWithContent('Contract.txt', 'sneaky'),
        ])->assertForbidden();

        // Once the request closes, the file is writable again.
        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();

        $this->actingAs($admin)->post("/portal/files/files/{$file->uuid}/versions", [
            'file' => UploadedFile::fake()->createWithContent('Contract.txt', 'now allowed'),
        ])->assertCreated();
    }

    /**
     * Asking somebody who has never seen the file is the ordinary case, not an
     * error: the sender may share it, so the access arrives with the request.
     */
    public function test_a_request_may_be_sent_to_someone_who_cannot_open_the_file_yet(): void
    {
        $owner = $this->user('Employee', 'olive@example.com', 'Olive Owner');
        // A client cannot open an internal file until this brings them in.
        $stranger = $this->user('Client', 'sam@example.com', 'Sam Stranger');

        // A private file, not the org-shared one.
        $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('Private.txt', 'x'),
        ])->assertCreated();
        $file = FileItem::latest('id')->first();

        $this->actingAs($owner)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $stranger->id]],
            ])->assertCreated();

        $this->assertDatabaseHas('shares', [
            'item_type' => 'file', 'item_id' => $file->id, 'kind' => 'user',
            'target_user_id' => $stranger->id, 'role' => 'viewer', 'shared_by' => $owner->id,
        ]);

        // And it is a request they can actually answer.
        $this->actingAs($stranger)
            ->getJson("/portal/files/files/{$file->uuid}/workflows")->assertOk();
    }

    /** A sender who cannot share the file still cannot pull anybody into it. */
    public function test_a_sender_who_cannot_share_cannot_add_someone_without_access(): void
    {
        $owner = $this->user('Employee', 'olive@example.com', 'Olive Owner');
        $stranger = $this->user('Client', 'sam@example.com', 'Sam Stranger');
        $file = $this->sharedFile($owner);

        // The org folder is editor-for-all-staff: enough to send a request,
        // never enough to hand the file to somebody new.
        $editor = $this->user('Employee', 'eddie@example.com', 'Eddie Editor');

        $this->actingAs($editor)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval',
                'recipients' => [['userId' => $stranger->id]],
            ])->assertStatus(422);

        $this->assertDatabaseMissing('shares', ['target_user_id' => $stranger->id]);
    }

    public function test_only_the_sender_can_cancel(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/cancel")
            ->assertForbidden();

        $res = $this->actingAs($admin)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/cancel")
            ->assertOk();
        $this->assertSame(Status::CANCELLED, $res->json('status'));
    }

    public function test_a_step_can_be_delegated_and_the_trail_keeps_both_names(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);
        $stepId = $wf['steps'][0]['id'];

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/delegate", [
                'step' => $stepId, 'userId' => $cara->id,
            ])->assertOk();

        $this->assertSame('Cara Staff', $res->json('steps.0.name'));
        $this->assertTrue($res->json('steps.0.delegatedFrom'));

        // Cara can now act; Ben no longer can.
        $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertForbidden();
        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertOk();
    }

    public function test_someone_not_asked_cannot_respond(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $this->actingAs($cara)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", ['action' => 'approve'])
            ->assertForbidden();
    }

    public function test_feedback_completes_rather_than_claiming_approval(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['type' => 'feedback', 'recipients' => [['userId' => $ben->id]]]);
        $this->assertSame(Status::FEEDBACK_REQUESTED, $wf['status']);

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'submit_feedback', 'comment' => 'Two small notes',
            ])->assertOk();

        // "Completed", never "Approved" — nobody was asked to approve anything.
        $this->assertSame(Status::COMPLETED, $res->json('status'));
    }

    public function test_requesting_changes_halts_the_flow(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);

        $res = $this->actingAs($ben)
            ->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
                'action' => 'request_changes', 'comment' => 'Please revise clause 4',
            ])->assertOk();

        $this->assertSame(Status::CHANGES_REQUESTED, $res->json('status'));
    }

    public function test_overdue_requests_expire_and_reminders_are_sent(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $cara = $this->user('Employee', 'cara@example.com', 'Cara Staff');
        $overdue = $this->sharedFile($admin, 'overdue');
        $nagging = $this->sharedFile($admin, 'nagging');

        $a = $this->send($admin, $overdue, [
            'recipients' => [['userId' => $ben->id]], 'dueAt' => now()->addDay()->toIso8601String(),
        ]);
        $b = $this->send($admin, $nagging, [
            'recipients' => [['userId' => $cara->id]], 'reminderDays' => 2,
        ]);

        // Move both past their thresholds.
        FileWorkflow::where('uuid', $a['id'])->update(['due_at' => now()->subDay()]);
        FileWorkflowStep::whereHas('workflow', fn ($q) => $q->where('uuid', $b['id']))
            ->update(['invited_at' => now()->subDays(5)]);

        $this->artisan('files:workflow-maintenance')->assertSuccessful();

        $this->assertSame(Status::EXPIRED, FileWorkflow::where('uuid', $a['id'])->value('status'));
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $cara->id, 'type' => 'file.approval_reminder',
        ]);
        $this->assertSame(1, (int) FileWorkflowStep::whereHas('workflow',
            fn ($q) => $q->where('uuid', $b['id']))->value('reminder_count'));
    }

    public function test_the_workflow_history_records_the_whole_story(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);
        $this->actingAs($ben)->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
            'action' => 'approve', 'comment' => 'Agreed',
        ])->assertOk();

        $res = $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/history")->assertOk();

        $actions = array_column($res->json('events'), 'action');
        $this->assertSame(['sent', 'approve', 'closed'], $actions);
        $this->assertSame('Agreed', $res->json('events.1.detail'));
    }

    public function test_workflow_events_reach_the_file_activity_timeline(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $ben = $this->user('Employee', 'ben@example.com', 'Ben Staff');
        $file = $this->sharedFile($admin);

        $wf = $this->send($admin, $file, ['recipients' => [['userId' => $ben->id]]]);
        $this->actingAs($ben)->postJson("/portal/files/files/{$file->uuid}/workflows/{$wf['id']}/respond", [
            'action' => 'approve',
        ])->assertOk();

        $res = $this->actingAs($admin)
            ->getJson("/portal/files/files/{$file->uuid}/activity?filter=approvals")->assertOk();

        $actions = array_column($res->json('entries'), 'action');
        $this->assertContains('approval-sent', $actions);
        $this->assertContains('approved', $actions);
    }

    public function test_a_viewer_cannot_send_a_file_for_approval(): void
    {
        $admin = $this->user('Administrator', 'ada@example.com', 'Ada Admin');
        $client = $this->user('Client', 'client@example.com', 'Dora Client');
        $file = $this->sharedFile($admin);

        // A client is not staff, so the org folder grants them nothing.
        $this->actingAs($client)
            ->postJson("/portal/files/files/{$file->uuid}/workflows", [
                'type' => 'approval', 'recipients' => [['userId' => $admin->id]],
            ])->assertForbidden();
    }
}
