<?php

namespace Tests\Feature;

use App\Mail\SignatureCompleted;
use App\Mail\SignatureDeclined;
use App\Mail\SignatureInvitation;
use App\Mail\SignatureReminder;
use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\SigningToken;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class SigningFlowTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-sign-'.uniqid();
        @mkdir($this->vaultRoot, 0775, true);
        config(['filesystems.disks.local.root' => $this->vaultRoot]);
        Mail::fake();
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
        foreach (scandir($dir) as $e) {
            if ($e === '.' || $e === '..') {
                continue;
            }
            $p = $dir.'/'.$e;
            is_dir($p) ? $this->rrmdir($p) : @unlink($p);
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

    /**
     * A genuine PDF, not a stub: sending checks the document can actually be
     * stamped, so "%PDF" followed by junk is correctly refused.
     */
    private function file(User $owner): FileItem
    {
        $bytes = file_get_contents(base_path('tests/Browser/fixtures/contract.pdf'));
        $path = 'vault/'.Str::random(10).'.pdf';
        $full = $this->vaultRoot.'/'.$path;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, $bytes);

        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Contract.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => strlen($bytes), 'disk' => 'local', 'storage_path' => $path,
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    /** A draft with N signers, each given a signature field. */
    private function draft(User $user, array $recipients = [['Dana Reed', 'dana@example.com']]): SignatureRequest
    {
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $payload = [];
        foreach ($recipients as $i => [$name, $email]) {
            $payload[] = ['name' => $name, 'email' => $email, 'order' => $i + 1];
        }
        $res = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['recipients' => $payload]);

        $fields = [];
        foreach ($res->json('request.recipients') as $i => $r) {
            $fields[] = [
                'type' => 'signature', 'recipient' => $r['id'], 'page' => 1,
                'x' => 0.1, 'y' => 0.1 + ($i * 0.1), 'width' => 0.2, 'height' => 0.05,
            ];
        }
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => $fields])->assertOk();

        return SignatureRequest::where('uuid', $id)->firstOrFail();
    }

    private const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    /* ── sending ───────────────────────────────────── */

    public function test_sending_issues_links_and_emails_only_the_first_signer(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')
            ->assertOk()
            ->assertJsonPath('request.status', 'sent');

        // Both get a token so the flow can advance without re-issuing...
        $this->assertCount(2, $request->recipients()->whereNotNull('token_hash')->get());

        // ...but only the first is emailed: a link that doesn't work yet
        // sitting in an inbox is just confusing.
        Mail::assertSent(SignatureInvitation::class, 1);
        Mail::assertSent(SignatureInvitation::class, fn ($m) => $m->hasTo('first@example.com'));
    }

    public function test_a_draft_with_no_fields_cannot_be_sent(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');
        $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana', 'email' => 'dana@example.com']],
        ]);

        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')
            ->assertStatus(422);
        Mail::assertNothingSent();
    }

    public function test_a_signer_with_no_fields_blocks_sending(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);

        // Add a second signer but give them nothing to do.
        $this->actingAs($user)->patchJson('/portal/signatures/'.$request->uuid, [
            'recipients' => [
                ['name' => 'Dana Reed', 'email' => 'dana@example.com'],
                ['name' => 'Idle Person', 'email' => 'idle@example.com'],
            ],
        ])->assertOk();

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')
            ->assertStatus(422)
            ->assertJsonPath('message', 'Idle Person has no fields to complete. Assign a field or remove them.');
    }

    public function test_a_sent_request_cannot_be_sent_again(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')
            ->assertStatus(422);
    }

    /* ── token security ────────────────────────────── */

    public function test_the_raw_token_is_never_stored(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $recipient = $request->recipients()->first();
        $raw = SigningToken::reveal($recipient);

        $this->assertNotNull($raw);
        // The hash column must not be the token itself.
        $this->assertNotSame($raw, $recipient->token_hash);
        $this->assertSame(hash('sha256', $raw), $recipient->token_hash);
        // Ciphertext must not contain the plaintext.
        $this->assertStringNotContainsString($raw, $recipient->token_ciphertext);
    }

    public function test_a_bogus_token_is_rejected(): void
    {
        $this->get('/sign/'.str_repeat('a', 64))->assertNotFound();
        $this->get('/sign/short')->assertNotFound();
    }

    public function test_signing_links_are_never_exposed_by_the_read_apis(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $raw = SigningToken::reveal($request->recipients()->first());

        $list = $this->actingAs($user)->getJson('/portal/signatures')->getContent();
        $show = $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid)->getContent();

        $this->assertStringNotContainsString($raw, $list);
        $this->assertStringNotContainsString($raw, $show);
        $this->assertStringNotContainsString('token', $show);
    }

    public function test_the_owner_can_recover_the_link_to_copy_it(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $res = $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid.'/links')->assertOk();

        $url = $res->json('links.0.url');
        $this->assertNotNull($url);
        // And it actually works.
        $this->get($url)->assertOk();
    }

    public function test_a_stranger_cannot_read_the_signing_links(): void
    {
        $user = $this->approvedUser();
        $stranger = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $this->actingAs($stranger)->getJson('/portal/signatures/'.$request->uuid.'/links')
            ->assertForbidden();
    }

    /* ── signing ───────────────────────────────────── */

    private function tokenFor(SignatureRequest $request, string $email): string
    {
        $recipient = $request->recipients()->where('email', $email)->firstOrFail();

        return SigningToken::reveal($recipient);
    }

    public function test_a_recipient_can_open_and_sign_without_a_portal_account(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        // Opening marks it viewed.
        $this->get('/sign/'.$token)->assertOk()->assertSee('Contract.pdf');
        $this->assertSame(Status::VIEWED, $request->fresh()->status);
        $this->assertNotNull($request->recipients()->first()->viewed_at);

        $field = $request->fields()->first();
        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertOk()
            ->assertJsonPath('status', Status::COMPLETED);

        $this->assertSame('signed', $request->recipients()->first()->fresh()->status);
        $this->assertSame(Status::COMPLETED, $request->fresh()->status);
    }

    public function test_viewing_and_signing_are_recorded_with_ip(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        $this->get('/sign/'.$token)->assertOk();
        $field = $request->fields()->first();
        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])->assertOk();

        foreach (['created', 'sent', 'viewed', 'field_completed', 'signed', 'completed'] as $action) {
            $this->assertDatabaseHas('signature_events', [
                'signature_request_id' => $request->id,
                'action' => $action,
            ]);
        }
        $this->assertNotNull(
            $request->events()->where('action', 'signed')->first()->ip,
            'a signature without an IP is not much of an audit trail'
        );
    }

    public function test_the_link_stops_working_once_signed(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');
        $field = $request->fields()->first();

        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])->assertOk();

        // The token is revoked on signing, so the URL is dead.
        $this->get('/sign/'.$token)->assertNotFound();
    }

    public function test_signing_twice_does_not_double_submit(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $recipient = $request->recipients()->where('email', 'first@example.com')->first();
        $token = SigningToken::reveal($recipient);
        $field = $request->fields()->where('signature_recipient_id', $recipient->id)->first();

        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])->assertOk();
        $signedAt = $recipient->fresh()->signed_at;

        // Replaying the same request must not re-sign or re-advance.
        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertNotFound(); // token already revoked
        $this->assertEquals($signedAt, $recipient->fresh()->signed_at);
    }

    /* ── signing order ─────────────────────────────── */

    public function test_a_later_signer_cannot_jump_the_queue(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $second = $request->recipients()->where('email', 'second@example.com')->first();
        $token = SigningToken::reveal($second);
        $field = $request->fields()->where('signature_recipient_id', $second->id)->first();

        // They hold a valid link, but it isn't their turn. (Raw compare: the
        // view's apostrophe isn't HTML-escaped, assertSee's default is.)
        $this->get('/sign/'.$token)->assertOk()->assertSee("It isn't your turn yet", false);
        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertForbidden();
        $this->get('/sign/'.$token.'/document')->assertForbidden();
    }

    public function test_the_next_signer_is_invited_once_the_first_signs(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $first = $request->recipients()->where('email', 'first@example.com')->first();
        $token = SigningToken::reveal($first);
        $field = $request->fields()->where('signature_recipient_id', $first->id)->first();

        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertOk()
            ->assertJsonPath('status', Status::IN_PROGRESS);

        Mail::assertSent(SignatureInvitation::class, fn ($m) => $m->hasTo('second@example.com'));

        // Now it IS the second signer's turn.
        $secondToken = $this->tokenFor($request, 'second@example.com');
        $this->get('/sign/'.$secondToken)->assertOk()->assertDontSee("It isn't your turn yet");
    }

    public function test_parallel_signers_are_not_emailed_twice(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['A', 'a@example.com'], ['B', 'b@example.com']]);

        // Same order = both may sign at once.
        $request->recipients()->update(['signing_order' => 1]);

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        Mail::assertSent(SignatureInvitation::class, 2);

        $a = $request->recipients()->where('email', 'a@example.com')->first();
        $field = $request->fields()->where('signature_recipient_id', $a->id)->first();
        $this->postJson('/sign/'.SigningToken::reveal($a).'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertOk();

        // B is still in the current group, but was already invited at send -
        // advancing must not send them a second copy.
        Mail::assertSent(SignatureInvitation::class, 2);
    }

    public function test_completion_needs_every_signer(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        foreach (['first@example.com', 'second@example.com'] as $i => $email) {
            $recipient = $request->recipients()->where('email', $email)->first();
            $token = SigningToken::reveal($recipient);
            $field = $request->fields()->where('signature_recipient_id', $recipient->id)->first();
            $res = $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])->assertOk();

            $this->assertSame(
                $i === 0 ? Status::IN_PROGRESS : Status::COMPLETED,
                $res->json('status')
            );
        }

        Mail::assertSent(SignatureCompleted::class, fn ($m) => $m->hasTo('second@example.com'));
    }

    /* ── cross-recipient isolation ─────────────────── */

    public function test_a_signer_cannot_fill_another_recipients_field(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $first = $request->recipients()->where('email', 'first@example.com')->first();
        $second = $request->recipients()->where('email', 'second@example.com')->first();
        $token = SigningToken::reveal($first);
        $ownField = $request->fields()->where('signature_recipient_id', $first->id)->first();
        $otherField = $request->fields()->where('signature_recipient_id', $second->id)->first();

        // Sending the other signer's field uuid must not fill it in.
        $this->postJson('/sign/'.$token.'/submit', ['values' => [
            $ownField->uuid => self::PNG,
            $otherField->uuid => self::PNG,
        ]])->assertOk();

        $this->assertNull($otherField->fresh()->value, "another signer's field must stay empty");
        $this->assertNotNull($ownField->fresh()->value);
    }

    public function test_the_signing_page_never_reveals_other_recipients_fields(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $first = $request->recipients()->where('email', 'first@example.com')->first();
        $second = $request->recipients()->where('email', 'second@example.com')->first();
        $otherField = $request->fields()->where('signature_recipient_id', $second->id)->first();

        $body = $this->get('/sign/'.SigningToken::reveal($first))->assertOk()->getContent();

        $this->assertStringNotContainsString($otherField->uuid, $body);
        $this->assertStringNotContainsString('second@example.com', $body);
    }

    public function test_a_token_from_one_request_cannot_touch_another(): void
    {
        $user = $this->approvedUser();
        $a = $this->draft($user, [['A', 'a@example.com']]);
        $b = $this->draft($user, [['B', 'b@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$a->uuid.'/send')->assertOk();
        $this->actingAs($user)->postJson('/portal/signatures/'.$b->uuid.'/send')->assertOk();

        $tokenA = $this->tokenFor($a, 'a@example.com');
        $fieldB = $b->fields()->first();

        // A's token submitting B's field: the field isn't theirs, so it's ignored
        // and A's own required field is still empty.
        $this->postJson('/sign/'.$tokenA.'/submit', ['values' => [$fieldB->uuid => self::PNG]])
            ->assertStatus(422);
        $this->assertNull($fieldB->fresh()->value);
    }

    /* ── value validation ──────────────────────────── */

    public function test_a_required_field_must_be_filled_to_finish(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        $this->postJson('/sign/'.$token.'/submit', ['values' => []])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Please complete every required field.');

        // A rejected submit must not have signed anything.
        $this->assertNotSame('signed', $request->recipients()->first()->fresh()->status);
        $this->assertNotSame(Status::COMPLETED, $request->fresh()->status);
    }

    public function test_a_signature_must_be_a_real_png(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');
        $field = $request->fields()->first();

        $bad = [
            'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',                  // svg is scriptable
            'https://evil.example.com/x.png',                              // would make us fetch it
            'data:image/png;base64,bm90IGEgcG5n',                          // lies about being a PNG
            'javascript:alert(1)',
            '<script>alert(1)</script>',
        ];

        foreach ($bad as $value) {
            $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => $value]])
                ->assertStatus(422);
        }

        $this->assertNull($field->fresh()->value);
    }

    public function test_an_oversized_signature_is_rejected(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');
        $field = $request->fields()->first();

        $huge = 'data:image/png;base64,'.str_repeat('A', 600 * 1024);

        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => $huge]])
            ->assertStatus(422);
    }

    public function test_autofilled_fields_use_our_data_not_the_signers(): void
    {
        $user = $this->approvedUser();
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');
        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana Reed', 'email' => 'dana@example.com']],
        ])->json('request.recipients.0.id');

        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => [
            ['type' => 'name', 'recipient' => $recipient, 'page' => 1, 'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.03],
            ['type' => 'email', 'recipient' => $recipient, 'page' => 1, 'x' => 0.1, 'y' => 0.2, 'width' => 0.2, 'height' => 0.03],
        ]])->assertOk();

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        $nameField = $request->fields()->where('type', 'name')->first();
        $emailField = $request->fields()->where('type', 'email')->first();

        // Try to claim someone else's identity.
        $this->postJson('/sign/'.$token.'/submit', ['values' => [
            $nameField->uuid => 'Someone Else',
            $emailField->uuid => 'attacker@evil.example.com',
        ]])->assertOk();

        $this->assertSame('Dana Reed', $nameField->fresh()->value);
        $this->assertSame('dana@example.com', $emailField->fresh()->value);
    }

    /* ── progress ──────────────────────────────────── */

    public function test_progress_is_saved_and_restored(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');
        $field = $request->fields()->first();

        $this->postJson('/sign/'.$token.'/progress', ['values' => [$field->uuid => self::PNG]])
            ->assertOk()->assertJsonPath('saved', true);

        $this->assertNotNull($field->fresh()->value);
        // Saving progress is not signing.
        $this->assertSame('pending', $request->recipients()->first()->fresh()->status);
        $this->assertNotSame(Status::COMPLETED, $request->fresh()->status);
    }

    /* ── decline ───────────────────────────────────── */

    public function test_declining_ends_the_request_and_kills_every_link(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $secondToken = $this->tokenFor($request, 'second@example.com');
        $firstToken = $this->tokenFor($request, 'first@example.com');

        $this->postJson('/sign/'.$firstToken.'/decline', ['reason' => 'Wrong contract'])
            ->assertOk()
            ->assertJsonPath('status', Status::DECLINED);

        $this->assertSame(Status::DECLINED, $request->fresh()->status);
        // Nobody else should be able to keep signing it.
        $this->get('/sign/'.$secondToken)->assertNotFound();

        Mail::assertSent(SignatureDeclined::class);
        $this->assertDatabaseHas('signature_events', [
            'signature_request_id' => $request->id,
            'action' => 'declined',
        ]);
    }

    /* ── expiry & cancellation ─────────────────────── */

    public function test_an_expired_link_is_refused_and_the_request_is_marked_expired(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send', ['expiresInDays' => 1])
            ->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        $this->travel(2)->days();

        $this->get('/sign/'.$token)->assertStatus(410);
        $this->assertSame(Status::EXPIRED, $request->fresh()->status);
    }

    public function test_cancelling_kills_the_link(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/cancel')->assertOk();

        $this->get('/sign/'.$token)->assertNotFound();
    }

    /* ── reminders ─────────────────────────────────── */

    public function test_reminders_go_only_to_whoever_is_being_waited_on(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user, [['First', 'first@example.com'], ['Second', 'second@example.com']]);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/remind')
            ->assertOk()
            ->assertJsonPath('reminded', 1);

        Mail::assertSent(SignatureReminder::class, 1);
        Mail::assertSent(SignatureReminder::class, fn ($m) => $m->hasTo('first@example.com'));
        Mail::assertNotSent(SignatureReminder::class, fn ($m) => $m->hasTo('second@example.com'));
    }

    public function test_a_draft_cannot_be_reminded(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/remind')
            ->assertStatus(422);
        Mail::assertNotSent(SignatureReminder::class);
    }

    /* ── portal isolation ──────────────────────────── */

    public function test_a_signing_token_grants_no_portal_access(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();
        $token = $this->tokenFor($request, 'dana@example.com');

        // Drop the session actingAs() left behind, or "the recipient" would
        // still be the signed-in owner and this would pass for the wrong
        // reason. The whole point is to be nothing but a link-holder.
        $this->app['auth']->forgetGuards();
        $this->flushSession();

        // Hold the link, then try to walk into the portal with it.
        $this->get('/sign/'.$token)->assertOk();

        $this->getJson('/portal/signatures')->assertUnauthorized();
        $this->getJson('/portal/files/')->assertUnauthorized();
        $this->getJson('/portal/signatures/'.$request->uuid)->assertUnauthorized();
        $this->get('/signatures')->assertRedirect();
    }

    public function test_cc_recipients_are_not_asked_to_sign(): void
    {
        $user = $this->approvedUser();
        $request = $this->draft($user);

        $this->actingAs($user)->patchJson('/portal/signatures/'.$request->uuid, [
            'recipients' => [
                ['name' => 'Dana Reed', 'email' => 'dana@example.com', 'role' => 'signer'],
                ['name' => 'Watcher', 'email' => 'cc@example.com', 'role' => 'cc'],
            ],
        ])->assertOk();

        // Re-place Dana's field (recipients changed).
        $dana = $request->recipients()->where('email', 'dana@example.com')->first();
        $this->actingAs($user)->putJson('/portal/signatures/'.$request->uuid.'/fields', ['fields' => [
            ['type' => 'signature', 'recipient' => $dana->uuid, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],
        ]])->assertOk();

        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        // A CC is never issued a signing link and never gates completion.
        $cc = $request->recipients()->where('email', 'cc@example.com')->first();
        $this->assertNull($cc->token_hash);

        $field = $request->fields()->first();
        // Re-read: $dana predates the send, so its token columns are stale.
        $token = SigningToken::reveal($dana->fresh());
        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => self::PNG]])
            ->assertOk()
            ->assertJsonPath('status', Status::COMPLETED);
    }
}
