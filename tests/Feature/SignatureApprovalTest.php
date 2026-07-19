<?php

namespace Tests\Feature;

use App\Mail\SignatureChangesRequested;
use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\SigningToken;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

class SignatureApprovalTest extends TestCase
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

    private function admin(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Administrator',
            'email_verified_at' => now(), 'profile_completed_at' => now(), 'onboarding_completed_at' => now(),
        ]);
    }

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

    /**
     * A sent request whose recipients are given by [name, email, role, order].
     * Signers get a signature field; approvers get none.
     */
    private function sentRequest(User $user, array $recipients): SignatureRequest
    {
        $id = $this->actingAs($user)
            ->postJson('/portal/signatures', ['fileId' => $this->file($user)->uuid])
            ->json('request.id');

        $payload = array_map(fn ($r) => [
            'name' => $r[0], 'email' => $r[1], 'role' => $r[2], 'order' => $r[3],
        ], $recipients);
        $res = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, ['recipients' => $payload]);

        $fields = [];
        foreach ($res->json('request.recipients') as $i => $r) {
            if ($r['role'] !== 'signer') {
                continue;
            }
            $fields[] = ['type' => 'signature', 'recipient' => $r['id'], 'page' => 1,
                'x' => 0.1, 'y' => 0.1 + ($i * 0.1), 'width' => 0.2, 'height' => 0.05];
        }
        if ($fields) {
            $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => $fields])->assertOk();
        }

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $this->actingAs($user)->postJson('/portal/signatures/'.$request->uuid.'/send')->assertOk();

        return $request->fresh();
    }

    private function tokenFor(SignatureRequest $request, string $email): string
    {
        return SigningToken::reveal($request->recipients()->where('email', $email)->firstOrFail());
    }

    public function test_an_approver_gets_the_review_page_not_the_signing_editor(): void
    {
        $user = $this->admin();
        $request = $this->sentRequest($user, [['Ada Approver', 'ada@example.com', 'approver', 1]]);
        $token = $this->tokenFor($request, 'ada@example.com');

        $body = $this->get('/sign/'.$token)->assertOk()->getContent();
        $this->assertStringContainsString('Request changes', $body);
        $this->assertStringContainsString('Approve', $body);
        $this->assertStringNotContainsString('/js/sign.js', $body); // not the field editor
    }

    public function test_an_approver_can_approve_and_the_flow_advances(): void
    {
        $user = $this->admin();
        // Approver first, then a signer: approving should move the turn on.
        $request = $this->sentRequest($user, [
            ['Ada Approver', 'ada@example.com', 'approver', 1],
            ['Sam Signer', 'sam@example.com', 'signer', 2],
        ]);
        $token = $this->tokenFor($request, 'ada@example.com');

        $this->postJson('/sign/'.$token.'/approve', ['comment' => 'Looks good to me'])
            ->assertOk()
            ->assertJsonPath('done', true);

        $ada = $request->recipients()->where('email', 'ada@example.com')->first()->fresh();
        $this->assertSame('signed', $ada->status);
        $this->assertSame('Looks good to me', $ada->comment);
        $this->assertSame(Status::IN_PROGRESS, $request->fresh()->status);
        $this->assertTrue($request->events()->where('action', 'approved')->exists());
    }

    public function test_request_changes_halts_the_request_and_notifies_the_sender(): void
    {
        $user = $this->admin();
        $request = $this->sentRequest($user, [
            ['Ada Approver', 'ada@example.com', 'approver', 1],
            ['Sam Signer', 'sam@example.com', 'signer', 2],
        ]);
        $token = $this->tokenFor($request, 'ada@example.com');

        $this->postJson('/sign/'.$token.'/request-changes', ['comment' => 'Fix clause 3'])
            ->assertOk()
            ->assertJsonPath('status', Status::CHANGES_REQUESTED);

        $ada = $request->recipients()->where('email', 'ada@example.com')->first()->fresh();
        $this->assertSame('changes_requested', $ada->status);
        $this->assertSame('Fix clause 3', $ada->comment);
        $this->assertSame(Status::CHANGES_REQUESTED, $request->fresh()->status);
        $this->assertTrue($request->events()->where('action', 'changes_requested')->exists());

        Mail::assertQueued(SignatureChangesRequested::class, fn ($m) => $m->hasTo($user->email));

        // The signer's link is dead now — the request is on hold.
        $this->assertNull($request->recipients()->where('email', 'sam@example.com')->first()->fresh()->token_hash);
    }

    public function test_request_changes_requires_a_comment(): void
    {
        $user = $this->admin();
        $request = $this->sentRequest($user, [['Ada Approver', 'ada@example.com', 'approver', 1]]);
        $token = $this->tokenFor($request, 'ada@example.com');

        $this->postJson('/sign/'.$token.'/request-changes', ['comment' => ''])
            ->assertStatus(422);
    }

    public function test_a_signer_cannot_use_the_approve_endpoint(): void
    {
        $user = $this->admin();
        $request = $this->sentRequest($user, [['Sam Signer', 'sam@example.com', 'signer', 1]]);
        $token = $this->tokenFor($request, 'sam@example.com');

        $this->postJson('/sign/'.$token.'/approve', ['comment' => 'x'])->assertForbidden();
        $this->postJson('/sign/'.$token.'/request-changes', ['comment' => 'x'])->assertForbidden();
    }

    public function test_sender_sees_the_approver_decision_and_comment(): void
    {
        $user = $this->admin();
        $request = $this->sentRequest($user, [
            ['Ada Approver', 'ada@example.com', 'approver', 1],
            ['Sam Signer', 'sam@example.com', 'signer', 2],
        ]);
        $this->postJson('/sign/'.$this->tokenFor($request, 'ada@example.com').'/approve', ['comment' => 'Approved with note'])->assertOk();

        $recipients = $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid)
            ->assertOk()->json('request.recipients');
        $ada = collect($recipients)->firstWhere('email', 'ada@example.com');

        $this->assertSame('Approved', $ada['statusLabel']);
        $this->assertSame('Approved with note', $ada['comment']);
    }
}
