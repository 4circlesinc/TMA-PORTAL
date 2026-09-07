<?php

namespace Tests\Feature;

use App\Mail\SignatureCompleted;
use App\Mail\SignatureDeclined;
use App\Mail\SignatureInvitation;
use App\Mail\SignatureReminder;
use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Files\Vault;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * These render the mailables for real.
 *
 * Mail::fake() never renders a view, so a template that throws on send looks
 * perfectly healthy to every other test in the suite. Rendering here is the
 * only thing that catches a broken variable before a recipient doesn't get
 * their link.
 */
class SignatureMailTest extends TestCase
{
    use RefreshDatabase;

    private function request(array $overrides = []): SignatureRequest
    {
        $user = User::factory()->create(['name' => 'Vernon Francis']);

        $request = SignatureRequest::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'created_by' => $user->id,
            'title' => 'TMA Contract.pdf',
            'status' => Status::SENT,
            'expires_at' => now()->addDays(30),
        ], $overrides));

        $request->recipients()->create([
            'uuid' => (string) Str::uuid(),
            'name' => 'Dana Reed',
            'email' => 'dana@example.com',
            'signing_order' => 1,
            'status' => 'pending',
        ]);

        return $request->fresh();
    }

    public function test_the_invitation_renders_with_a_custom_message(): void
    {
        // "message" is the variable Laravel reserves for the Mail\Message
        // object; a note that lands under that name blows the view up.
        $request = $this->request(['message' => 'Please sign by Friday.']);

        $html = (new SignatureInvitation(
            $request,
            $request->recipients()->first(),
            'https://portal.test/sign/abc123',
        ))->render();

        $this->assertStringContainsString('Please sign by Friday.', $html);
        $this->assertStringContainsString('https://portal.test/sign/abc123', $html);
        $this->assertStringContainsString('TMA Contract.pdf', $html);
        $this->assertStringContainsString('Vernon Francis', $html);
    }

    public function test_the_invitation_renders_without_a_message(): void
    {
        $request = $this->request(['message' => null]);

        $html = (new SignatureInvitation(
            $request,
            $request->recipients()->first(),
            'https://portal.test/sign/abc123',
        ))->render();

        $this->assertStringContainsString('https://portal.test/sign/abc123', $html);
    }

    public function test_the_invitation_subject_prefers_the_senders_wording(): void
    {
        $request = $this->request(['subject' => 'Countersign please']);
        $mail = new SignatureInvitation($request, $request->recipients()->first(), 'https://portal.test/sign/x');

        $this->assertSame('Countersign please', $mail->envelope()->subject);

        $plain = $this->request(['subject' => null]);
        $mail2 = new SignatureInvitation($plain, $plain->recipients()->first(), 'https://portal.test/sign/x');
        $this->assertSame('Please sign: TMA Contract.pdf', $mail2->envelope()->subject);
    }

    public function test_an_approver_is_asked_to_approve_not_sign(): void
    {
        $request = $this->request();
        $recipient = $request->recipients()->first();
        $recipient->forceFill(['role' => 'approver'])->save();

        $html = (new SignatureInvitation($request, $recipient->fresh(), 'https://portal.test/sign/x'))->render();

        $this->assertStringContainsString('approve', $html);
    }

    public function test_the_reminder_renders(): void
    {
        $request = $this->request();

        $html = (new SignatureReminder(
            $request,
            $request->recipients()->first(),
            'https://portal.test/sign/abc123',
        ))->render();

        $this->assertStringContainsString('TMA Contract.pdf', $html);
        $this->assertStringContainsString('https://portal.test/sign/abc123', $html);
    }

    public function test_the_declined_mail_renders_with_a_reason(): void
    {
        $request = $this->request();

        $html = (new SignatureDeclined($request, 'Wrong version', 'Dana Reed'))->render();

        $this->assertStringContainsString('declined', $html);
        $this->assertStringContainsString('Wrong version', $html);
        $this->assertStringContainsString('Dana Reed', $html);
    }

    public function test_the_completed_mail_renders_with_and_without_the_document(): void
    {
        $request = $this->request();

        $withDoc = (new SignatureCompleted($request, null, 'Dana Reed'))->render();
        // No signed file: it must not point at an attachment that isn't there.
        $this->assertStringContainsString('still preparing', $withDoc);
        $this->assertStringContainsString('Dana Reed', $withDoc);
        $this->assertStringContainsString('TMA Contract.pdf', $withDoc);
    }

    /**
     * Vault files are envelope-encrypted at rest, so attaching one straight
     * off the disk mailed the ciphertext and every recipient got a "signed
     * copy" their PDF reader refused to open. The bytes that leave must be a
     * real PDF, not what is stored.
     */
    public function test_the_signed_copy_is_attached_as_a_readable_pdf(): void
    {
        $request = $this->request(['status' => Status::COMPLETED]);
        $user = User::find($request->created_by);

        $tmp = tempnam(sys_get_temp_dir(), 'sig').'.pdf';
        copy(base_path('tests/Browser/fixtures/contract.pdf'), $tmp);
        $stored = Vault::store($tmp, 'pdf');

        $signed = FileItem::create([
            'uuid' => $stored['uuid'], 'name' => 'Contract (signed).pdf',
            'extension' => 'pdf', 'mime_type' => 'application/pdf',
            'size' => $stored['size'], 'disk' => $stored['disk'],
            'storage_path' => $stored['path'], 'checksum' => $stored['checksum'],
            'owner_id' => $user->id, 'uploaded_by' => $user->id,
        ]);

        // Whatever is on disk, the transmitted attachment must be a PDF.
        $captured = null;
        $mail = (new SignatureCompleted($request->fresh(), $signed, 'Dana Reed'))
            ->to('dana@example.com')
            ->withSymfonyMessage(function ($m) use (&$captured) { $captured = $m; });

        Mail::to('dana@example.com')->sendNow($mail);

        $bodies = [];
        foreach ($captured->getAttachments() as $part) {
            $bodies[] = $part->getBody();
        }

        $this->assertCount(1, $bodies, 'the signed copy should be attached');
        $this->assertStringStartsWith('%PDF', $bodies[0], 'the attachment must be a readable PDF, not the encrypted bytes');
    }

    public function test_outcome_emails_never_carry_a_signing_link(): void
    {
        $request = $this->request();

        // These go to the sender, not the signer - they must not hand over
        // anyone's credential.
        $this->assertStringNotContainsString('/sign/', (new SignatureDeclined($request))->render());
        $this->assertStringNotContainsString('/sign/', (new SignatureCompleted($request, null))->render());
    }

    public function test_a_hostile_message_is_escaped_not_rendered(): void
    {
        $request = $this->request(['message' => '<script>alert(1)</script>']);

        $html = (new SignatureInvitation(
            $request,
            $request->recipients()->first(),
            'https://portal.test/sign/x',
        ))->render();

        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('&lt;script&gt;', $html);
    }
}
