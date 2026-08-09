<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientAssignment;
use App\Models\FileItem;
use App\Models\Folder;
use App\Models\User;
use App\Support\Files\ClientDocuments;
use App\Support\Files\ReviewStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The client document review workflow, and the assignment rules that came
 * with it.
 *
 * The point of most of these is not that a status can be set — it is *where*
 * it gets set from. A client document must enter review whichever of the seven
 * file-creating paths put it there, and nested inside whatever folder, which
 * is the part a controller-level implementation quietly fails at.
 */
class ClientDocumentReviewTest extends TestCase
{
    use RefreshDatabase;

    private function staff(string $type = 'Employee'): User
    {
        $user = User::create([
            'name' => $type.' '.uniqid(),
            'email' => strtolower($type).uniqid().'@example.com',
            'password' => bcrypt('password12345'),
        ]);

        $user->forceFill([
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
            'status' => 'approved',
            'account_type' => $type,
        ])->save();

        return $user;
    }

    private function client(User $creator): Client
    {
        return Client::create([
            'uid' => 'c-'.uniqid(),
            'name' => 'Test Client',
            'email' => 'client'.uniqid().'@example.com',
            'data' => [],
            'created_by' => $creator->id,
        ]);
    }

    private function clientFolder(Client $client, User $owner): Folder
    {
        return Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => $client->name,
            'folder_type' => Folder::TYPE_CLIENT,
            'client_id' => $client->id,
            'owner_id' => $owner->id,
            'created_by' => $owner->id,
        ]);
    }

    private function file(array $attrs = []): FileItem
    {
        ClientDocuments::forget();

        return FileItem::create(array_merge([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Passport.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/x.pdf',
        ], $attrs));
    }

    public function test_a_file_in_a_client_folder_starts_pending_review(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);

        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->assertSame(ReviewStatus::PENDING, $file->fresh()->review_status);
    }

    /** The default subfolders — Citizenship Applications and the rest. */
    public function test_a_file_nested_below_a_client_folder_also_starts_pending(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $root = $this->clientFolder($client, $staff);

        $sub = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Citizenship Applications',
            'parent_id' => $root->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $deep = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Supporting evidence',
            'parent_id' => $sub->id,
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $file = $this->file(['folder_id' => $deep->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->assertSame(ReviewStatus::PENDING, $file->fresh()->review_status);
    }

    public function test_an_ordinary_file_gets_no_review_status(): void
    {
        $staff = $this->staff();

        $plain = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Marketing',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $inFolder = $this->file(['folder_id' => $plain->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);
        $loose = $this->file(['owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->assertNull($inFolder->fresh()->review_status);
        $this->assertNull($loose->fresh()->review_status, 'A File Box upload is nobody\'s client document.');
    }

    public function test_moving_a_file_into_and_out_of_a_client_folder_updates_its_review(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);

        $plain = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Scratch',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $file = $this->file(['folder_id' => $plain->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);
        $this->assertNull($file->fresh()->review_status);

        ClientDocuments::forget();
        $file->update(['folder_id' => $folder->id]);
        $this->assertSame(ReviewStatus::PENDING, $file->fresh()->review_status);

        ClientDocuments::forget();
        $file->update(['folder_id' => $plain->id]);
        $this->assertNull($file->fresh()->review_status, 'Out of the folder is out of the queue.');
    }

    public function test_staff_move_a_document_through_the_review(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->actingAs($staff)
            ->patchJson("/portal/files/files/{$file->uuid}/review", ['status' => ReviewStatus::UNDER_REVIEW])
            ->assertOk()
            ->assertJsonPath('status.label', 'Under review');

        $this->actingAs($staff)
            ->patchJson("/portal/files/files/{$file->uuid}/review", ['status' => ReviewStatus::APPROVED, 'note' => 'All present.'])
            ->assertOk()
            ->assertJsonPath('status.label', 'Approved');

        $file->refresh();
        $this->assertSame(ReviewStatus::APPROVED, $file->review_status);
        $this->assertSame($staff->id, $file->reviewed_by);
        $this->assertNotNull($file->reviewed_at);
    }

    public function test_a_rejection_must_say_why(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->actingAs($staff)
            ->patchJson("/portal/files/files/{$file->uuid}/review", ['status' => ReviewStatus::REJECTED])
            ->assertStatus(422);

        $this->actingAs($staff)
            ->patchJson("/portal/files/files/{$file->uuid}/review", [
                'status' => ReviewStatus::REJECTED,
                'note' => 'Expired — please send a current copy.',
            ])
            ->assertOk();

        $this->assertSame('Expired — please send a current copy.', $file->fresh()->review_note);
    }

    public function test_a_client_cannot_approve_their_own_document(): void
    {
        $staff = $this->staff();
        $owner = $this->client($staff);
        $folder = $this->clientFolder($owner, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $clientUser = $this->staff('Client');

        $this->actingAs($clientUser)
            ->patchJson("/portal/files/files/{$file->uuid}/review", ['status' => ReviewStatus::APPROVED])
            ->assertForbidden();
    }

    public function test_the_review_status_reaches_the_file_listing(): void
    {
        $staff = $this->staff('Administrator');
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->actingAs($staff)
            ->getJson('/portal/files/?section=all&folder='.$folder->uuid)
            ->assertOk()
            ->assertJsonPath('files.0.status.label', 'Pending review')
            ->assertJsonPath('files.0.review.status', ReviewStatus::PENDING);
    }

    /* ── automatic transitions ────────────────────────────────────── */

    public function test_a_comment_starts_the_review(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $this->assertSame(ReviewStatus::PENDING, $file->fresh()->review_status);

        $c = \App\Models\FileComment::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'file_id' => $file->id,
            'author_id' => $staff->id,
            'body' => 'Checking the dates on page 2.',
        ]);
        $c->forceFill(['root_id' => $c->id])->save();

        $this->assertSame(
            ReviewStatus::UNDER_REVIEW,
            $file->fresh()->review_status,
            'Somebody discussing the document means somebody is looking at it.'
        );
    }

    public function test_an_approval_request_and_its_outcome_move_the_document(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $wf = \App\Models\FileWorkflow::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'file_id' => $file->id,
            'type' => 'approval',
            'status' => \App\Support\Files\Workflow\Status::AWAITING_APPROVAL,
            'created_by' => $staff->id,
            'require_all' => true,
            'ordered' => false,
            'lock_file' => false,
        ]);

        $this->assertSame(ReviewStatus::AWAITING_APPROVAL, $file->fresh()->review_status);

        $wf->forceFill(['status' => \App\Support\Files\Workflow\Status::CHANGES_REQUESTED])->save();
        $this->assertSame(ReviewStatus::CHANGES_REQUESTED, $file->fresh()->review_status);

        $wf->forceFill(['status' => \App\Support\Files\Workflow\Status::APPROVED])->save();
        $this->assertSame(ReviewStatus::APPROVED, $file->fresh()->review_status);
    }

    public function test_activity_never_overrules_a_person(): void
    {
        $staff = $this->staff();
        $client = $this->client($staff);
        $folder = $this->clientFolder($client, $staff);
        $file = $this->file(['folder_id' => $folder->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        // A reviewer settles it by hand.
        $this->actingAs($staff)
            ->patchJson("/portal/files/files/{$file->uuid}/review", ['status' => ReviewStatus::APPROVED])
            ->assertOk();

        $c = \App\Models\FileComment::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'file_id' => $file->id,
            'author_id' => $staff->id,
            'body' => 'Nice one.',
        ]);
        $c->forceFill(['root_id' => $c->id])->save();

        $this->assertSame(
            ReviewStatus::APPROVED,
            $file->fresh()->review_status,
            'A remark about finished work is not a reason to reopen it.'
        );
    }

    public function test_an_ordinary_library_file_is_untouched_by_comments(): void
    {
        $staff = $this->staff();

        $plain = Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Marketing',
            'owner_id' => $staff->id,
            'created_by' => $staff->id,
        ]);

        $file = $this->file(['folder_id' => $plain->id, 'owner_id' => $staff->id, 'uploaded_by' => $staff->id]);

        $c = \App\Models\FileComment::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'file_id' => $file->id,
            'author_id' => $staff->id,
            'body' => 'Looks good.',
        ]);
        $c->forceFill(['root_id' => $c->id])->save();

        $this->assertNull($file->fresh()->review_status, 'Nothing to advance — it was never in a review.');
    }

    /* ── assignment rules ─────────────────────────────────────────── */

    public function test_the_creator_is_assigned_and_administrators_are_not_offered(): void
    {
        $creator = $this->staff();
        $colleague = $this->staff();
        $admin = $this->staff('Administrator');

        $this->actingAs($creator)
            ->postJson('/portal/clients', ['uid' => 'acme', 'name' => 'Acme Ltd', 'profile' => ['emails' => [['value' => 'acme@example.com']]]])
            ->assertSuccessful();

        $client = Client::where('name', 'Acme Ltd')->firstOrFail();

        $this->assertTrue(
            ClientAssignment::live()->where('client_id', $client->id)->where('user_id', $creator->id)->exists(),
            'The employee who created the client is its default assignee.'
        );

        $body = $this->actingAs($creator)
            ->getJson("/portal/clients/{$client->uid}/assignments")
            ->assertOk()
            ->json('assignable');

        $ids = array_column($body, 'id');

        $this->assertNotContains($admin->id, $ids, 'Administrators are not assignable.');
        $this->assertNotContains($creator->id, $ids, 'The creator is already the default assignee.');
        $this->assertContains($colleague->id, $ids, 'Other employees are still offered.');
    }
}
