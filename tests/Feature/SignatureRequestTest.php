<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\Folder;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SignatureRequestTest extends TestCase
{
    use RefreshDatabase;

    private function approvedUser(array $overrides = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved',
            'account_type' => 'Client',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $overrides));
    }

    private function file(User $owner, string $name = 'Contract.pdf', string $ext = 'pdf'): FileItem
    {
        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'extension' => $ext,
            'mime_type' => 'application/pdf',
            'size' => 1024,
            'disk' => 'local',
            'storage_path' => 'vault/'.Str::random(8),
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ]);
    }

    public function test_draft_is_created_from_a_library_file(): void
    {
        $user = $this->approvedUser();
        $file = $this->file($user);

        $res = $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $file->uuid]);

        $res->assertCreated()
            ->assertJsonPath('request.status', 'draft')
            ->assertJsonPath('request.statusLabel', 'Draft')
            ->assertJsonPath('request.title', 'Contract.pdf')
            ->assertJsonPath('request.document.name', 'Contract.pdf');

        $this->assertDatabaseHas('signature_requests', [
            'file_id' => $file->id,
            'created_by' => $user->id,
            'status' => Status::DRAFT,
        ]);
    }

    public function test_creating_a_draft_writes_an_audit_event(): void
    {
        $user = $this->approvedUser();
        $file = $this->file($user);

        $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $file->uuid])
            ->assertCreated();

        $this->assertDatabaseHas('signature_events', [
            'action' => 'created',
            'user_id' => $user->id,
        ]);
    }

    public function test_unsupported_file_types_are_refused(): void
    {
        $user = $this->approvedUser();
        $file = $this->file($user, 'Notes.docx', 'docx');

        $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $file->uuid])
            ->assertStatus(422);
    }

    public function test_png_and_jpg_are_accepted(): void
    {
        $user = $this->approvedUser();

        foreach (['png', 'jpg', 'jpeg'] as $ext) {
            $file = $this->file($user, 'Scan.'.$ext, $ext);
            $this->actingAs($user)
                ->postJson('/portal/signatures', ['fileId' => $file->uuid])
                ->assertCreated();
        }
    }

    public function test_a_user_cannot_start_a_request_from_someone_elses_file(): void
    {
        $owner = $this->approvedUser();
        $stranger = $this->approvedUser();
        $file = $this->file($owner);

        $this->actingAs($stranger)
            ->postJson('/portal/signatures', ['fileId' => $file->uuid])
            ->assertForbidden();
    }

    public function test_list_only_returns_your_own_requests(): void
    {
        $mine = $this->approvedUser();
        $theirs = $this->approvedUser();

        $this->actingAs($mine)->postJson('/portal/signatures', ['fileId' => $this->file($mine)->uuid]);
        $this->actingAs($theirs)->postJson('/portal/signatures', ['fileId' => $this->file($theirs)->uuid]);

        $res = $this->actingAs($mine)->getJson('/portal/signatures');

        $res->assertOk()->assertJsonCount(1, 'requests');
        $this->assertFalse($res->json('canAdminView'));
    }

    public function test_admin_view_is_ignored_for_non_admins(): void
    {
        $mine = $this->approvedUser();
        $theirs = $this->approvedUser();

        $this->actingAs($mine)->postJson('/portal/signatures', ['fileId' => $this->file($mine)->uuid]);
        $this->actingAs($theirs)->postJson('/portal/signatures', ['fileId' => $this->file($theirs)->uuid]);

        // Asking for everything must not grant it.
        $this->actingAs($mine)->getJson('/portal/signatures?scope=all')
            ->assertOk()
            ->assertJsonCount(1, 'requests');
    }

    public function test_admin_view_returns_every_request_for_an_administrator(): void
    {
        $admin = $this->approvedUser(['account_type' => 'Administrator']);
        $other = $this->approvedUser();

        $this->actingAs($admin)->postJson('/portal/signatures', ['fileId' => $this->file($admin)->uuid]);
        $this->actingAs($other)->postJson('/portal/signatures', ['fileId' => $this->file($other)->uuid]);

        $this->actingAs($admin)->getJson('/portal/signatures?scope=all')
            ->assertOk()
            ->assertJsonCount(2, 'requests');
    }

    public function test_search_matches_title_and_recipient(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user, 'Lease Agreement.pdf')->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana Reed', 'email' => 'dana@example.com']],
        ])->assertOk();

        $this->actingAs($user)->getJson('/portal/signatures?search=lease')
            ->assertOk()->assertJsonCount(1, 'requests');

        $this->actingAs($user)->getJson('/portal/signatures?search=dana@example.com')
            ->assertOk()->assertJsonCount(1, 'requests');

        $this->actingAs($user)->getJson('/portal/signatures?search=nothingmatches')
            ->assertOk()->assertJsonCount(0, 'requests');
    }

    public function test_status_filter_narrows_the_list(): void
    {
        $user = $this->approvedUser();
        $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid]);

        $this->actingAs($user)->getJson('/portal/signatures?status=draft')
            ->assertOk()->assertJsonCount(1, 'requests');

        $this->actingAs($user)->getJson('/portal/signatures?status=completed')
            ->assertOk()->assertJsonCount(0, 'requests');
    }

    public function test_recipients_are_replaced_and_ordered(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $res = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'First Signer', 'email' => 'a@example.com'],
                ['name' => 'Second Signer', 'email' => 'b@example.com', 'role' => 'approver'],
            ],
        ]);

        $res->assertOk()
            ->assertJsonPath('request.recipients.0.order', 1)
            ->assertJsonPath('request.recipients.1.order', 2)
            ->assertJsonPath('request.recipients.1.role', 'approver')
            ->assertJsonPath('request.progress.total', 2)
            ->assertJsonPath('request.progress.signed', 0);

        // Replacing the list must not accumulate rows.
        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Only Signer', 'email' => 'c@example.com']],
        ])->assertOk()->assertJsonCount(1, 'request.recipients');
    }

    public function test_editing_a_recipient_keeps_their_identity_and_placed_fields(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $res = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'Dana Reed', 'email' => 'dana@example.com'],
                ['name' => 'Sam Poll', 'email' => 'sam@example.com'],
            ],
        ])->assertOk();

        $danaUuid = $res->json('request.recipients.0.id');
        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $dana = $request->recipients()->where('email', 'dana@example.com')->firstOrFail();

        // A field placed for Dana; it must survive an unrelated edit.
        $field = $request->fields()->create([
            'uuid' => (string) Str::uuid(),
            'signature_recipient_id' => $dana->id,
            'type' => 'signature',
            'page' => 1, 'x' => 0.1, 'y' => 0.2, 'width' => 0.2, 'height' => 0.05,
        ]);

        // Fix a typo in Dana's name and drop Sam.
        $after = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana Reid', 'email' => 'dana@example.com']],
        ])->assertOk();

        $after->assertJsonCount(1, 'request.recipients')
            ->assertJsonPath('request.recipients.0.name', 'Dana Reid')
            // Same row, so anything pointing at her still resolves.
            ->assertJsonPath('request.recipients.0.id', $danaUuid);

        $this->assertDatabaseHas('signature_fields', [
            'id' => $field->id,
            'signature_recipient_id' => $dana->id,
        ]);
    }

    public function test_removing_a_recipient_discards_only_their_fields(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'Keep Me', 'email' => 'keep@example.com'],
                ['name' => 'Drop Me', 'email' => 'drop@example.com'],
            ],
        ])->assertOk();

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $keep = $request->recipients()->where('email', 'keep@example.com')->firstOrFail();
        $drop = $request->recipients()->where('email', 'drop@example.com')->firstOrFail();

        $keptField = $request->fields()->create([
            'uuid' => (string) Str::uuid(), 'signature_recipient_id' => $keep->id,
            'type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05,
        ]);
        $goneField = $request->fields()->create([
            'uuid' => (string) Str::uuid(), 'signature_recipient_id' => $drop->id,
            'type' => 'initials', 'page' => 1, 'x' => 0.5, 'y' => 0.5, 'width' => 0.1, 'height' => 0.05,
        ]);

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Keep Me', 'email' => 'keep@example.com']],
        ])->assertOk();

        $this->assertDatabaseHas('signature_fields', ['id' => $keptField->id]);
        $this->assertDatabaseMissing('signature_fields', ['id' => $goneField->id]);
    }

    public function test_duplicate_recipient_emails_are_rejected(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'One', 'email' => 'same@example.com'],
                ['name' => 'Two', 'email' => 'SAME@example.com'],
            ],
        ])->assertStatus(422);
    }

    public function test_invalid_recipient_email_is_rejected(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Bad', 'email' => 'not-an-email']],
        ])->assertStatus(422);
    }

    public function test_signed_copy_destination_must_be_a_folder_you_can_write_to(): void
    {
        $user = $this->approvedUser();
        $stranger = $this->approvedUser();

        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $mine = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Signed',
            'owner_id' => $user->id,
            'created_by' => $user->id,
        ]);
        $theirs = Folder::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Private',
            'owner_id' => $stranger->id,
            'created_by' => $stranger->id,
        ]);

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['folderId' => $mine->uuid])
            ->assertOk()
            ->assertJsonPath('request.folder.name', 'Signed');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['folderId' => $theirs->uuid])
            ->assertForbidden();
    }

    public function test_a_draft_can_be_deleted_but_a_sent_request_cannot(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $sent = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($user)->id,
            'created_by' => $user->id,
            'title' => 'Already sent.pdf',
            'status' => Status::SENT,
            'sent_at' => now(),
        ]);

        $this->actingAs($user)->deleteJson('/portal/signatures/'.$sent->uuid)
            ->assertStatus(422);

        $this->actingAs($user)->deleteJson('/portal/signatures/'.$id)
            ->assertOk();
    }

    public function test_cancelling_a_sent_request_expires_its_signing_tokens(): void
    {
        $user = $this->approvedUser();

        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($user)->id,
            'created_by' => $user->id,
            'title' => 'Out for signature.pdf',
            'status' => Status::SENT,
            'sent_at' => now(),
        ]);
        $recipient = $request->recipients()->create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Dana Reed',
            'email' => 'dana@example.com',
            'token_hash' => hash('sha256', 'a-live-token'),
            'token_expires_at' => now()->addDays(7),
        ]);

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/cancel')
            ->assertOk()
            ->assertJsonPath('request.status', 'cancelled');

        // Status alone wouldn't revoke a bearer link - the token must die too.
        $recipient->refresh();
        $this->assertNull($recipient->token_hash);
        $this->assertTrue($recipient->token_expires_at->isPast());
    }

    public function test_a_draft_cannot_be_cancelled(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/cancel')
            ->assertStatus(422);
    }

    public function test_a_stranger_cannot_read_or_delete_your_request(): void
    {
        $owner = $this->approvedUser();
        $stranger = $this->approvedUser();

        $id = $this->actingAs($owner)
            ->postJson('/portal/signatures', ['fileId' => $this->file($owner)->uuid])
            ->json('request.id');

        $this->actingAs($stranger)->getJson('/portal/signatures/'.$id)->assertForbidden();
        $this->actingAs($stranger)->deleteJson('/portal/signatures/'.$id)->assertForbidden();
        $this->actingAs($stranger)->patchJson('/portal/signatures/'.$id, ['title' => 'Hijacked'])
            ->assertForbidden();
    }

    public function test_a_sent_request_cannot_be_edited(): void
    {
        $user = $this->approvedUser();

        $sent = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($user)->id,
            'created_by' => $user->id,
            'title' => 'Locked.pdf',
            'status' => Status::SENT,
            'sent_at' => now(),
        ]);

        $this->actingAs($user)->patchJson('/portal/signatures/'.$sent->uuid, ['title' => 'Changed'])
            ->assertStatus(422);
    }

    public function test_signing_tokens_are_never_serialized(): void
    {
        $user = $this->approvedUser();

        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($user)->id,
            'created_by' => $user->id,
            'title' => 'Secret.pdf',
            'status' => Status::SENT,
        ]);
        $request->recipients()->create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Dana Reed',
            'email' => 'dana@example.com',
            'token_hash' => hash('sha256', 'super-secret-token'),
        ]);

        $body = $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid)
            ->assertOk()->getContent();

        $this->assertStringNotContainsString('token', $body);
        $this->assertStringNotContainsString(hash('sha256', 'super-secret-token'), $body);
    }

    public function test_document_picker_lists_only_signable_files(): void
    {
        $user = $this->approvedUser();
        $this->file($user, 'Contract.pdf', 'pdf');
        $this->file($user, 'Scan.png', 'png');
        $this->file($user, 'Notes.docx', 'docx');
        $this->file($user, 'Clip.mp4', 'mp4');

        $res = $this->actingAs($user)->getJson('/portal/signatures/documents');

        $res->assertOk()->assertJsonCount(2, 'files');
        $names = array_column($res->json('files'), 'name');
        sort($names);
        $this->assertSame(['Contract.pdf', 'Scan.png'], $names);
    }

    public function test_subject_and_message_are_saved_and_can_be_cleared(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'subject' => 'Please sign the lease',
            'message' => 'Sign by Friday please.',
        ])->assertOk()->assertJsonPath('request.subject', 'Please sign the lease');

        $this->actingAs($user)->getJson('/portal/signatures/'.$id)
            ->assertOk()
            ->assertJsonPath('request.message', 'Sign by Friday please.');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'subject' => null,
            'message' => null,
        ])->assertOk()->assertJsonPath('request.subject', null);
    }

    public function test_title_defaults_to_the_file_name_and_survives_a_rename(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user, 'Lease.pdf')->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['title' => 'Signed Lease.pdf'])
            ->assertOk()
            ->assertJsonPath('request.title', 'Signed Lease.pdf')
            // Renaming the request must not touch the library file itself.
            ->assertJsonPath('request.document.name', 'Lease.pdf');
    }

    public function test_signing_order_follows_the_submitted_sequence(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'Third', 'email' => 'c@example.com'],
                ['name' => 'First', 'email' => 'a@example.com'],
                ['name' => 'Second', 'email' => 'b@example.com'],
            ],
        ])->assertOk()
            ->assertJsonPath('request.recipients.0.name', 'Third')
            ->assertJsonPath('request.recipients.0.order', 1)
            ->assertJsonPath('request.recipients.2.name', 'Second')
            ->assertJsonPath('request.recipients.2.order', 3);

        // An explicit order wins over position, and the list comes back sorted.
        $res = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'Last', 'email' => 'z@example.com', 'order' => 2],
                ['name' => 'Opener', 'email' => 'y@example.com', 'order' => 1],
            ],
        ])->assertOk();

        $this->assertSame('Opener', $res->json('request.recipients.0.name'));
        $this->assertSame('Last', $res->json('request.recipients.1.name'));
    }

    public function test_cc_recipients_are_excluded_from_completion_progress(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        // A CC has nothing to sign, so counting them would stall progress at
        // under 100% forever.
        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [
                ['name' => 'Signer', 'email' => 'signer@example.com', 'role' => 'signer'],
                ['name' => 'Watcher', 'email' => 'cc@example.com', 'role' => 'cc'],
            ],
        ])->assertOk()
            ->assertJsonPath('request.progress.total', 1)
            ->assertJsonPath('request.progress.percent', 0);
    }

    public function test_progress_reflects_signed_recipients(): void
    {
        $user = $this->approvedUser();
        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($user)->id,
            'created_by' => $user->id,
            'title' => 'Two signers.pdf',
            'status' => Status::IN_PROGRESS,
        ]);
        $request->recipients()->create([
            'uuid' => (string) Str::uuid(), 'name' => 'A', 'email' => 'a@example.com',
            'signing_order' => 1, 'status' => 'signed', 'signed_at' => now(),
        ]);
        $request->recipients()->create([
            'uuid' => (string) Str::uuid(), 'name' => 'B', 'email' => 'b@example.com',
            'signing_order' => 2, 'status' => 'pending',
        ]);

        $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid)
            ->assertOk()
            ->assertJsonPath('request.progress.signed', 1)
            ->assertJsonPath('request.progress.total', 2)
            ->assertJsonPath('request.progress.percent', 50);
    }

    public function test_too_many_recipients_are_rejected(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $many = [];
        for ($i = 0; $i < 26; $i++) {
            $many[] = ['name' => 'Person '.$i, 'email' => 'p'.$i.'@example.com'];
        }

        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['recipients' => $many])
            ->assertStatus(422);
    }

    public function test_people_picker_lists_approved_portal_users(): void
    {
        $user = $this->approvedUser(['name' => 'Vernon Francis']);
        $this->approvedUser(['name' => 'Dana Reed', 'account_type' => 'Client']);
        $this->approvedUser(['name' => 'Sam Poll', 'account_type' => 'Employee']);

        $res = $this->actingAs($user)->getJson('/portal/signatures/people')->assertOk();

        $names = array_column($res->json('people'), 'name');
        $this->assertContains('Dana Reed', $names);
        $this->assertContains('Sam Poll', $names);
        // You can send something to yourself, so you're in the list, flagged.
        $this->assertContains('Vernon Francis', $names);
        $you = collect($res->json('people'))->firstWhere('name', 'Vernon Francis');
        $this->assertTrue($you['isYou']);
    }

    public function test_people_picker_hides_unapproved_accounts(): void
    {
        $user = $this->approvedUser();
        User::factory()->create(['name' => 'Pending Person', 'status' => 'pending']);
        User::factory()->create(['name' => 'Suspended Person', 'status' => 'suspended']);

        $res = $this->actingAs($user)->getJson('/portal/signatures/people')->assertOk();

        $names = array_column($res->json('people'), 'name');
        $this->assertNotContains('Pending Person', $names);
        $this->assertNotContains('Suspended Person', $names);
    }

    public function test_people_picker_exposes_no_more_than_it_needs(): void
    {
        $user = $this->approvedUser();
        User::factory()->create([
            'name' => 'Dana Reed', 'status' => 'approved',
            'phone' => '+15550001111', 'admin_note' => 'Difficult client',
        ]);

        $res = $this->actingAs($user)->getJson('/portal/signatures/people')->assertOk();
        $body = $res->getContent();

        // Any signed-in user can call this, so it must not become a back door
        // into the admin directory.
        $this->assertStringNotContainsString('+15550001111', $body);
        $this->assertStringNotContainsString('Difficult client', $body);
        $this->assertStringNotContainsString('password', $body);

        $person = collect($res->json('people'))->firstWhere('name', 'Dana Reed');
        $this->assertSame(
            ['name', 'email', 'accountType', 'avatar', 'initials', 'isYou'],
            array_keys($person),
        );
    }

    public function test_people_picker_can_be_searched(): void
    {
        $user = $this->approvedUser(['name' => 'Vernon Francis']);
        $this->approvedUser(['name' => 'Dana Reed', 'email' => 'dana@example.com']);
        $this->approvedUser(['name' => 'Sam Poll', 'email' => 'sam@example.com']);

        $byName = $this->actingAs($user)->getJson('/portal/signatures/people?search=dana')->assertOk();
        $this->assertSame(['Dana Reed'], array_column($byName->json('people'), 'name'));

        $byEmail = $this->actingAs($user)->getJson('/portal/signatures/people?search=sam@example.com')->assertOk();
        $this->assertSame(['Sam Poll'], array_column($byEmail->json('people'), 'name'));
    }

    public function test_guests_cannot_list_portal_people(): void
    {
        $this->getJson('/portal/signatures/people')->assertUnauthorized();
    }

    public function test_signatures_page_is_reachable(): void
    {
        $user = $this->approvedUser();

        $this->actingAs($user)->get('/signatures')->assertOk();
    }

    public function test_guests_cannot_reach_the_signatures_api(): void
    {
        $this->getJson('/portal/signatures')->assertUnauthorized();
    }
}
