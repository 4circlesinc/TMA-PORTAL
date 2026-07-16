<?php

namespace Tests\Feature;

use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SignatureFieldTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-sig-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config(['filesystems.disks.local.root' => $this->vaultRoot]);
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
        foreach (scandir($dir) as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $dir.'/'.$entry;
            is_dir($path) ? $this->rrmdir($path) : @unlink($path);
        }
        @rmdir($dir);
    }

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
        $path = 'vault/'.Str::random(10).'.'.$ext;
        $full = $this->vaultRoot.'/'.$path;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, '%PDF-1.4 fake bytes');

        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name,
            'extension' => $ext,
            'mime_type' => 'application/pdf',
            'size' => 18,
            'disk' => 'local',
            'storage_path' => $path,
            'owner_id' => $owner->id,
            'uploaded_by' => $owner->id,
        ]);
    }

    /** @return array{0: User, 1: string, 2: string} user, request uuid, recipient uuid */
    private function draftWithRecipient(): array
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana Reed', 'email' => 'dana@example.com']],
        ])->json('request.recipients.0.id');

        return [$user, $id, $recipient];
    }

    public function test_fields_are_saved_and_returned_with_page_relative_coordinates(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $res = $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [
                ['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.1, 'y' => 0.8, 'width' => 0.22, 'height' => 0.055],
                ['type' => 'date', 'recipient' => $recipient, 'page' => 2,
                    'x' => 0.5, 'y' => 0.2, 'width' => 0.14, 'height' => 0.035],
            ],
        ]);

        $res->assertOk()
            ->assertJsonCount(2, 'fields')
            ->assertJsonPath('fields.0.type', 'signature')
            ->assertJsonPath('fields.0.x', 0.1)
            ->assertJsonPath('fields.0.page', 1)
            ->assertJsonPath('fields.0.recipient', $recipient)
            ->assertJsonPath('fields.1.page', 2);

        $this->assertDatabaseCount('signature_fields', 2);
    }

    public function test_saving_fields_replaces_the_previous_set(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [
                ['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],
                ['type' => 'text', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.3, 'y' => 0.3, 'width' => 0.2, 'height' => 0.03],
            ],
        ])->assertOk();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [
                ['type' => 'initials', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.4, 'y' => 0.4, 'width' => 0.08, 'height' => 0.045],
            ],
        ])->assertOk()->assertJsonCount(1, 'fields');

        $this->assertDatabaseCount('signature_fields', 1);
    }

    public function test_all_fields_can_be_cleared(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertOk();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => []])
            ->assertOk()->assertJsonCount(0, 'fields');

        $this->assertDatabaseCount('signature_fields', 0);
    }

    public function test_a_field_cannot_be_assigned_to_another_requests_recipient(): void
    {
        [$user, $id] = $this->draftWithRecipient();

        // A second request with its own recipient.
        $otherId = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user, 'Other.pdf')->uuid])
            ->json('request.id');
        $otherRecipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$otherId, [
            'recipients' => [['name' => 'Sam Poll', 'email' => 'sam@example.com']],
        ])->json('request.recipients.0.id');

        // Handing this request's field to the other request's signer must fail.
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => $otherRecipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertStatus(422);

        $this->assertDatabaseCount('signature_fields', 0);
    }

    public function test_unknown_recipient_is_rejected(): void
    {
        [$user, $id] = $this->draftWithRecipient();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => (string) Str::uuid(), 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertStatus(422);
    }

    public function test_fields_outside_the_page_are_rejected(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $cases = [
            ['x' => 1.5, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],   // x past the edge
            ['x' => 0.1, 'y' => -0.2, 'width' => 0.2, 'height' => 0.05],  // negative y
            ['x' => 0.9, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],   // overhangs right
            ['x' => 0.1, 'y' => 0.98, 'width' => 0.2, 'height' => 0.05],  // overhangs bottom
        ];

        foreach ($cases as $box) {
            $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
                'fields' => [array_merge(['type' => 'signature', 'recipient' => $recipient, 'page' => 1], $box)],
            ])->assertStatus(422);
        }

        $this->assertDatabaseCount('signature_fields', 0);
    }

    public function test_a_field_flush_against_the_edge_is_allowed(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.8, 'y' => 0.95, 'width' => 0.2, 'height' => 0.05]],
        ])->assertOk()->assertJsonCount(1, 'fields');
    }

    public function test_unknown_field_type_is_rejected(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'creditcard', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertStatus(422);
    }

    public function test_autofilled_types_are_always_required(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        // Asking for an optional date makes no sense: it's filled in for them.
        $res = $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [
                ['type' => 'date', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.1, 'y' => 0.1, 'width' => 0.14, 'height' => 0.035, 'required' => false],
                ['type' => 'text', 'recipient' => $recipient, 'page' => 1,
                    'x' => 0.4, 'y' => 0.4, 'width' => 0.2, 'height' => 0.035, 'required' => false],
            ],
        ])->assertOk();

        $this->assertTrue($res->json('fields.0.required'), 'date must stay required');
        $this->assertTrue($res->json('fields.0.autofilled'));
        $this->assertFalse($res->json('fields.1.required'), 'text may be optional');
    }

    public function test_fields_cannot_be_changed_once_the_request_is_sent(): void
    {
        [$user, $id, $recipient] = $this->draftWithRecipient();

        SignatureRequest::where('uuid', $id)->update([
            'status' => Status::SENT,
            'sent_at' => now(),
        ]);

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertStatus(422);
    }

    public function test_a_stranger_cannot_read_or_write_fields_or_fetch_the_document(): void
    {
        [, $id, $recipient] = $this->draftWithRecipient();
        $stranger = $this->approvedUser();

        $this->actingAs($stranger)->getJson('/portal/signatures/'.$id.'/fields')->assertForbidden();
        $this->actingAs($stranger)->get('/portal/signatures/'.$id.'/document')->assertForbidden();
        $this->actingAs($stranger)->putJson('/portal/signatures/'.$id.'/fields', [
            'fields' => [['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05]],
        ])->assertForbidden();
    }

    public function test_guests_cannot_reach_the_document_or_fields(): void
    {
        // Built without actingAs on purpose: acting as a user earlier in the
        // test would leave the session authenticated, and the "guest" request
        // would silently pass.
        $owner = $this->approvedUser();
        $request = SignatureRequest::create([
            'uuid' => (string) Str::uuid(),
            'file_id' => $this->file($owner)->id,
            'created_by' => $owner->id,
            'title' => 'Private.pdf',
            'status' => Status::DRAFT,
        ]);

        $this->get('/portal/signatures/'.$request->uuid.'/document')->assertRedirect();
        $this->getJson('/portal/signatures/'.$request->uuid.'/fields')->assertUnauthorized();
        $this->putJson('/portal/signatures/'.$request->uuid.'/fields', ['fields' => []])
            ->assertUnauthorized();
    }

    public function test_document_streams_the_original_file(): void
    {
        [$user, $id] = $this->draftWithRecipient();

        $res = $this->actingAs($user)->get('/portal/signatures/'.$id.'/document');
        $res->assertOk();
        $this->assertSame('%PDF-1.4 fake bytes', $res->streamedContent());
    }

    public function test_field_types_are_advertised_to_the_editor(): void
    {
        [$user, $id] = $this->draftWithRecipient();

        $res = $this->actingAs($user)->getJson('/portal/signatures/'.$id.'/fields')->assertOk();

        $types = array_column($res->json('types'), 'type');
        $this->assertSame(
            ['signature', 'initials', 'name', 'email', 'date', 'text', 'checkbox'],
            $types,
        );
    }
}
