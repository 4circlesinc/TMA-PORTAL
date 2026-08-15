<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\Folder;
use App\Models\User;
use App\Support\Clients\Assignments;
use App\Support\Files\FileAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phases 8-10 — assignment roles, the notifications both sides get, and what
 * happens when an assignment changes, ends or is handed on.
 */
class ClientAssignmentRolesTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        return $this->staff('Administrator');
    }

    private function staff(string $type = 'Reviewing Officer', array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => $type,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    private function client(array $o = []): Client
    {
        return Client::create(array_merge([
            'uid' => 'acme-co',
            'name' => 'Acme Co',
            'email' => 'owner@acme.test',
            'initial' => 'A',
            'initial_color' => 'blue',
            'data' => [],
        ], $o));
    }

    // ------------------------------------------------------ roles (Phase 8)

    public function test_a_staff_member_is_assigned_with_a_named_role(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id,
            'role' => 'account_manager',
            'level' => 'editor',
            'primary' => true,
            'notes' => 'Main point of contact.',
        ])->assertOk()
            ->assertJsonPath('assignments.0.role', 'account_manager')
            ->assertJsonPath('assignments.0.roleLabel', 'Account manager')
            ->assertJsonPath('assignments.0.primary', true)
            ->assertJsonPath('assignments.0.notes', 'Main point of contact.')
            ->assertJsonPath('assignments.0.assignedBy', $admin->name);
    }

    public function test_a_client_can_have_several_staff_in_different_roles(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();

        foreach ([
            ['account_manager', 'editor'],
            ['booking_coordinator', 'contributor'],
            ['finance', 'view_files'],
            ['contract_manager', 'editor'],
        ] as [$role, $level]) {
            $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
                'userId' => $this->staff()->id, 'role' => $role, 'level' => $level,
            ])->assertOk();
        }

        $roles = collect(
            $this->actingAs($admin)->getJson("/portal/clients/{$client->uid}/assignments")->json('assignments')
        )->pluck('role')->all();

        $this->assertEqualsCanonicalizing(
            ['account_manager', 'booking_coordinator', 'finance', 'contract_manager'],
            $roles
        );
    }

    public function test_a_staff_member_can_be_assigned_to_several_clients(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff('Reviewing Officer');
        $a = $this->client();
        $b = $this->client(['uid' => 'wayne-co', 'name' => 'Wayne Co', 'email' => 'b@wayne.test']);

        foreach ([$a, $b] as $client) {
            $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
                'userId' => $emp->id, 'role' => 'general', 'level' => 'view_files',
            ])->assertOk();
        }

        $mine = $this->actingAs($emp)->getJson('/portal/clients/assigned-to-me')->json('clients');
        $this->assertCount(2, $mine);
    }

    public function test_only_one_assignment_can_be_primary(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $first = $this->staff();
        $second = $this->staff();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $first->id, 'role' => 'account_manager', 'level' => 'editor', 'primary' => true,
        ]);
        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $second->id, 'role' => 'account_manager', 'level' => 'editor', 'primary' => true,
        ]);

        $primaries = ClientAssignment::where('client_id', $client->id)->where('is_primary', true)->get();
        $this->assertCount(1, $primaries);
        $this->assertSame($second->id, $primaries->first()->user_id);
    }

    public function test_an_end_date_in_the_past_is_refused(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $this->staff()->id, 'level' => 'editor',
            'endsAt' => now()->subDay()->toDateTimeString(),
        ])->assertStatus(422);
    }

    // ---------------------------------------------- notifications (Phase 9)

    public function test_both_sides_are_told_when_staff_are_assigned(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff('Employee', ['name' => 'Dana Reed']);
        $account = $this->staff('Client', ['email' => 'owner@acme.test']);
        $client = $this->client(['user_id' => $account->id]);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'account_manager', 'level' => 'editor',
        ])->assertOk();

        // The staff member is told, in the portal and by email.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $emp->id, 'type' => 'client.assigned',
        ]);
        // And so is the client.
        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $account->id, 'type' => 'client.assigned',
        ]);

        $recipients = [];
        Mail::assertSent(Postcard::class, function (Postcard $mail) use (&$recipients) {
            $recipients[] = $mail->subjectLine;

            return true;
        });
        $this->assertTrue(
            collect($recipients)->contains(fn ($s) => str_contains($s, 'assigned to Acme Co')),
            'the staff member was not emailed'
        );
        $this->assertTrue(
            collect($recipients)->contains(fn ($s) => str_contains($s, 'is now your contact')),
            'the client was not emailed'
        );
    }

    public function test_a_client_with_no_account_is_not_emailed(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $client = $this->client(); // no user_id

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $this->staff()->id, 'level' => 'editor',
        ])->assertOk();

        // Only the staff member's email goes out.
        Mail::assertSent(Postcard::class, 1);
    }

    public function test_changing_a_role_notifies_without_re_welcoming(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'general', 'level' => 'view_files',
        ]);
        Mail::assertSent(Postcard::class, 1);

        $this->actingAs($admin)->patchJson("/portal/clients/{$client->uid}/assignments/{$emp->id}", [
            'role' => 'finance',
        ])->assertOk()->assertJsonPath('assignments.0.role', 'finance');

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $emp->id, 'type' => 'client.assignment_changed',
        ]);
        // No second "you've been assigned" email for someone already on it.
        Mail::assertSent(Postcard::class, 1);
    }

    // ------------------------------------ removal and reassignment (Phase 10)

    public function test_ending_an_assignment_keeps_the_record_and_removes_access(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();

        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Acme Co',
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'account_manager', 'level' => 'editor',
        ])->assertOk();

        $this->assertSame('editor', FileAccess::folderRole($emp->fresh(), $folder));

        $this->actingAs($admin)->deleteJson("/portal/clients/{$client->uid}/assignments/{$emp->id}")
            ->assertOk()
            ->assertJsonCount(0, 'assignments')
            ->assertJsonCount(1, 'history');

        // The row survives as history…
        $row = ClientAssignment::where('client_id', $client->id)->where('user_id', $emp->id)->first();
        $this->assertNotNull($row);
        $this->assertSame('ended', $row->status);
        $this->assertNotNull($row->ended_at);
        $this->assertSame($admin->id, $row->ended_by);

        // …but the access is gone.
        $this->assertNull(FileAccess::folderRole($emp->fresh(), $folder));
        $this->assertNotContains($folder->id, FileAccess::systemVisibleFolderIds($emp->fresh()));

        $this->assertDatabaseHas('portal_notifications', [
            'user_id' => $emp->id, 'type' => 'client.unassigned',
        ]);
        $this->assertDatabaseHas('activity_logs', ['activity_type' => 'client.unassigned']);
    }

    public function test_an_assignment_that_lapses_stops_granting_access_on_its_own(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();
        $folder = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Acme Co',
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $admin->id,
            'created_by' => $admin->id,
        ]);

        Assignments::assign($client, $emp, [
            'role' => 'event_coordinator', 'level' => 'editor',
            'endsAt' => now()->addDays(2),
        ], $admin);

        $this->assertSame('editor', FileAccess::folderRole($emp->fresh(), $folder));

        // Nothing runs; time simply passes.
        $this->travel(3)->days();

        $this->assertNull(FileAccess::folderRole($emp->fresh(), $folder));
        $this->assertFalse(
            ClientAssignment::where('client_id', $client->id)->first()->isLive()
        );
    }

    public function test_removing_one_staff_member_leaves_the_others_alone(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $keep = $this->staff();
        $drop = $this->staff();
        $client = $this->client();

        foreach ([[$keep, 'finance'], [$drop, 'booking_coordinator']] as [$who, $role]) {
            $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
                'userId' => $who->id, 'role' => $role, 'level' => 'editor',
            ]);
        }

        $left = $this->actingAs($admin)
            ->deleteJson("/portal/clients/{$client->uid}/assignments/{$drop->id}")
            ->assertOk()->json('assignments');

        $this->assertCount(1, $left);
        $this->assertSame($keep->id, $left[0]['userId']);
        $this->assertSame('finance', $left[0]['role']);
    }

    public function test_a_client_can_be_handed_to_another_staff_member(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $from = $this->staff();
        $to = $this->staff();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $from->id, 'role' => 'account_manager', 'level' => 'editor', 'primary' => true,
        ]);

        $this->actingAs($admin)
            ->postJson("/portal/clients/{$client->uid}/assignments/{$from->id}/reassign", [
                'toUserId' => $to->id,
            ])->assertOk();

        $live = ClientAssignment::live()->where('client_id', $client->id)->get();
        $this->assertCount(1, $live);
        $this->assertSame($to->id, $live->first()->user_id);
        // The role and primary flag travel with the client.
        $this->assertSame('account_manager', $live->first()->role);
        $this->assertTrue($live->first()->is_primary);

        // And the person who used to hold it is still on record.
        $this->assertDatabaseHas('client_assignments', [
            'user_id' => $from->id, 'status' => 'ended',
        ]);
    }

    public function test_re_assigning_someone_who_left_revives_their_record(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'finance', 'level' => 'view_files',
        ]);
        $this->actingAs($admin)->deleteJson("/portal/clients/{$client->uid}/assignments/{$emp->id}");

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'role' => 'contract_manager', 'level' => 'editor',
        ])->assertOk();

        // One row, revived — not a second one stacked on top.
        $rows = ClientAssignment::where('client_id', $client->id)->where('user_id', $emp->id)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('active', $rows->first()->status);
        $this->assertSame('contract_manager', $rows->first()->role);
        $this->assertNull($rows->first()->ended_at);
    }

    public function test_a_non_admin_staff_member_cannot_assign_or_end_assignments(): void
    {
        Mail::fake();
        $officer = $this->staff('Reviewing Officer');
        $client = $this->client();

        $this->actingAs($officer)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $this->staff()->id, 'level' => 'editor',
        ])->assertForbidden();

        $this->actingAs($officer)
            ->deleteJson("/portal/clients/{$client->uid}/assignments/1")
            ->assertForbidden();

        // But they may still see who is assigned.
        $this->actingAs($officer)->getJson("/portal/clients/{$client->uid}/assignments")->assertOk();
    }

    public function test_a_client_account_cannot_be_assigned_as_staff(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $clientUser = $this->staff('Client');
        $client = $this->client();

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $clientUser->id, 'level' => 'editor',
        ])->assertStatus(422);
    }

    public function test_assignable_staff_excludes_people_already_assigned(): void
    {
        Mail::fake();
        $admin = $this->admin();
        $emp = $this->staff();
        $client = $this->client();

        $before = $this->actingAs($admin)
            ->getJson("/portal/clients/{$client->uid}/assignments")->json('assignable');
        $this->assertContains($emp->id, array_column($before, 'id'));

        $this->actingAs($admin)->postJson("/portal/clients/{$client->uid}/assignments", [
            'userId' => $emp->id, 'level' => 'editor',
        ]);

        $after = $this->actingAs($admin)
            ->getJson("/portal/clients/{$client->uid}/assignments")->json('assignable');
        $this->assertNotContains($emp->id, array_column($after, 'id'));
    }
}
