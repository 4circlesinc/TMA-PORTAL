<?php

namespace Tests\Feature;

use App\Mail\SignatureCompleted;
use App\Models\FileItem;
use App\Models\SignatureRequest;
use App\Models\User;
use App\Support\Signatures\SigningToken;
use App\Support\Signatures\Stamper;
use App\Support\Signatures\Status;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use setasign\Fpdi\Fpdi;
use Tests\TestCase;

class SignatureStampingTest extends TestCase
{
    use RefreshDatabase;

    private string $vaultRoot;

    protected function setUp(): void
    {
        parent::setUp();
        $this->vaultRoot = sys_get_temp_dir().'/tma-stamp-'.uniqid();
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

    private function approvedUser(): User
    {
        return User::factory()->create([
            'status' => 'approved', 'account_type' => 'Client',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** The real two-page fixture the browser tests use. */
    private function pdfFile(User $owner, string $name = 'Contract.pdf'): FileItem
    {
        return $this->vaultFile($owner, $name, 'pdf', 'application/pdf',
            file_get_contents(base_path('tests/Browser/fixtures/contract.pdf')));
    }

    private function imageFile(User $owner, string $name = 'Scan.png'): FileItem
    {
        $img = imagecreatetruecolor(600, 800);
        imagefill($img, 0, 0, imagecolorallocate($img, 255, 255, 255));
        imagestring($img, 5, 40, 40, 'SCANNED FORM', imagecolorallocate($img, 0, 0, 0));
        ob_start();
        imagepng($img);
        $bytes = ob_get_clean();
        imagedestroy($img);

        return $this->vaultFile($owner, $name, 'png', 'image/png', $bytes);
    }

    private function vaultFile(User $owner, string $name, string $ext, string $mime, string $bytes): FileItem
    {
        $path = 'vault/'.Str::random(10).'.'.$ext;
        $full = $this->vaultRoot.'/'.$path;
        @mkdir(dirname($full), 0775, true);
        file_put_contents($full, $bytes);

        return FileItem::create([
            'uuid' => (string) Str::uuid(),
            'name' => $name, 'extension' => $ext, 'mime_type' => $mime,
            'size' => strlen($bytes), 'disk' => 'local', 'storage_path' => $path,
            'owner_id' => $owner->id, 'uploaded_by' => $owner->id,
        ]);
    }

    /** A 40x20 solid black PNG - big enough to find again in the output. */
    private function signaturePng(): string
    {
        $img = imagecreatetruecolor(40, 20);
        imagefill($img, 0, 0, imagecolorallocate($img, 0, 0, 0));
        ob_start();
        imagepng($img);
        $bytes = ob_get_clean();
        imagedestroy($img);

        return 'data:image/png;base64,'.base64_encode($bytes);
    }

    /**
     * Build a sent request with the given fields and sign it through the
     * public endpoint, exactly as a recipient would.
     */
    private function signThrough(User $user, FileItem $file, array $fieldSpecs): SignatureRequest
    {
        $id = $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $file->uuid])
            ->json('request.id');
        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana Reed', 'email' => 'dana@example.com']],
        ])->json('request.recipients.0.id');

        $fields = array_map(fn ($f) => array_merge(['recipient' => $recipient], $f), $fieldSpecs);
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => $fields])->assertOk();
        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')->assertOk();

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $token = SigningToken::reveal($request->recipients()->first());

        $values = [];
        foreach ($request->fields as $field) {
            $values[$field->uuid] = match ($field->type) {
                'signature', 'initials' => $this->signaturePng(),
                'checkbox' => true,
                'text' => 'Agreed',
                default => null,
            };
        }
        $this->postJson('/sign/'.$token.'/submit', ['values' => $values])->assertOk();

        return $request->fresh();
    }

    public function test_a_signed_copy_is_produced_and_filed_beside_the_original(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);

        $request = $this->signThrough($user, $original, [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.25, 'height' => 0.06],
        ]);

        $this->assertSame(Status::COMPLETED, $request->status);
        $signed = $request->signedFile;
        $this->assertNotNull($signed, 'a completed request must have a signed copy');

        $this->assertSame('Contract (signed).pdf', $signed->name);
        $this->assertSame('pdf', $signed->extension);
        $this->assertSame($original->folder_id, $signed->folder_id);
        $this->assertTrue(Storage::disk($signed->disk)->exists($signed->storage_path));

        // Real PDF bytes, not an empty file.
        $bytes = Storage::disk($signed->disk)->get($signed->storage_path);
        $this->assertStringStartsWith('%PDF', $bytes);
        $this->assertGreaterThan(1000, strlen($bytes));
    }

    public function test_the_original_is_left_completely_untouched(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);
        $before = Storage::disk('local')->get($original->storage_path);
        $beforeChecksum = hash('sha256', $before);

        $request = $this->signThrough($user, $original, [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.25, 'height' => 0.06],
        ]);

        $original->refresh();
        $this->assertTrue(Storage::disk('local')->exists($original->storage_path));
        $this->assertSame(
            $beforeChecksum,
            hash('sha256', Storage::disk('local')->get($original->storage_path)),
            'signing must never rewrite the document that was sent'
        );

        // Two distinct library rows: what we sent, and what came back.
        $this->assertNotSame($original->id, $request->signed_file_id);
        $this->assertDatabaseHas('files', ['id' => $original->id, 'name' => 'Contract.pdf']);
    }

    public function test_the_stamped_pdf_keeps_every_page_and_gains_the_signature(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);

        $request = $this->signThrough($user, $original, [
            ['type' => 'signature', 'page' => 2, 'x' => 0.1, 'y' => 0.8, 'width' => 0.25, 'height' => 0.06],
        ]);

        $signed = $request->signedFile;
        $raw = Storage::disk($signed->disk)->get($signed->storage_path);

        // FPDI needs a real path, and the vault disk may not be local.
        $out = tempnam(sys_get_temp_dir(), 'signed').'.pdf';
        file_put_contents($out, $raw);

        try {
            // The fixture is 2 pages; the signed copy must not lose one.
            $pdf = new Fpdi;
            $this->assertSame(2, $pdf->setSourceFile($out), 'signed copy must keep every page');
        } finally {
            @unlink($out);
        }

        $this->assertStringContainsString('/Image', $raw, 'the signature image should be embedded');
    }

    public function test_text_checkbox_and_autofilled_fields_all_stamp(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);

        // One of every kind that renders differently.
        $request = $this->signThrough($user, $original, [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.7, 'width' => 0.25, 'height' => 0.06],
            ['type' => 'initials', 'page' => 1, 'x' => 0.5, 'y' => 0.7, 'width' => 0.08, 'height' => 0.05],
            ['type' => 'name', 'page' => 1, 'x' => 0.1, 'y' => 0.5, 'width' => 0.3, 'height' => 0.04],
            ['type' => 'email', 'page' => 1, 'x' => 0.1, 'y' => 0.55, 'width' => 0.3, 'height' => 0.04],
            ['type' => 'date', 'page' => 1, 'x' => 0.1, 'y' => 0.6, 'width' => 0.2, 'height' => 0.04],
            ['type' => 'text', 'page' => 1, 'x' => 0.5, 'y' => 0.5, 'width' => 0.2, 'height' => 0.04],
            ['type' => 'checkbox', 'page' => 1, 'x' => 0.5, 'y' => 0.6, 'width' => 0.03, 'height' => 0.02],
        ]);

        $signed = $request->signedFile;
        $this->assertNotNull($signed, 'every field type must survive stamping');
        $this->assertStringStartsWith(
            '%PDF',
            Storage::disk($signed->disk)->get($signed->storage_path)
        );

        // The autofilled values came from us, not the signer.
        $this->assertSame('Dana Reed', $request->fields()->where('type', 'name')->first()->value);
        $this->assertSame('dana@example.com', $request->fields()->where('type', 'email')->first()->value);
    }

    public function test_a_png_document_is_wrapped_into_a_signed_pdf(): void
    {
        $user = $this->approvedUser();
        $original = $this->imageFile($user);

        $request = $this->signThrough($user, $original, [
            ['type' => 'signature', 'page' => 1, 'x' => 0.2, 'y' => 0.7, 'width' => 0.3, 'height' => 0.08],
        ]);

        $signed = $request->signedFile;
        $this->assertNotNull($signed);
        // Signed output is always a PDF, whatever went in.
        $this->assertSame('pdf', $signed->extension);
        $this->assertSame('Scan (signed).pdf', $signed->name);
        $this->assertStringStartsWith(
            '%PDF',
            Storage::disk($signed->disk)->get($signed->storage_path)
        );
        // ...and the original PNG is still a PNG.
        $this->assertSame('png', $original->fresh()->extension);
    }

    public function test_a_second_request_does_not_overwrite_the_first_signed_copy(): void
    {
        $user = $this->approvedUser();

        $first = $this->signThrough($user, $this->pdfFile($user), [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.2, 'height' => 0.05],
        ]);
        $second = $this->signThrough($user, $this->pdfFile($user), [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.2, 'height' => 0.05],
        ]);

        $this->assertSame('Contract (signed).pdf', $first->signedFile->name);
        $this->assertSame('Contract (signed) (1).pdf', $second->signedFile->name);
        $this->assertNotSame($first->signed_file_id, $second->signed_file_id);
    }

    public function test_the_signed_copy_is_emailed_to_everyone(): void
    {
        $user = $this->approvedUser();

        $this->signThrough($user, $this->pdfFile($user), [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.2, 'height' => 0.05],
        ]);

        // The signer gets their copy...
        Mail::assertSent(SignatureCompleted::class, fn ($m) => $m->hasTo('dana@example.com'));
        // ...and so does the sender.
        Mail::assertSent(SignatureCompleted::class, fn ($m) => $m->hasTo($user->email));
        Mail::assertSent(SignatureCompleted::class, 2);
    }

    public function test_the_completed_email_carries_the_signed_pdf(): void
    {
        $user = $this->approvedUser();
        $request = $this->signThrough($user, $this->pdfFile($user), [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.2, 'height' => 0.05],
        ]);

        Mail::assertSent(SignatureCompleted::class, function ($mail) use ($request) {
            $attachments = $mail->attachments();

            return count($attachments) === 1
                && $attachments[0]->as === $request->signedFile->name
                && $attachments[0]->mime === 'application/pdf';
        });
    }

    public function test_the_signed_copy_is_downloadable_and_shows_in_the_api(): void
    {
        $user = $this->approvedUser();
        $request = $this->signThrough($user, $this->pdfFile($user), [
            ['type' => 'signature', 'page' => 1, 'x' => 0.1, 'y' => 0.8, 'width' => 0.2, 'height' => 0.05],
        ]);

        $res = $this->actingAs($user)->getJson('/portal/signatures/'.$request->uuid)->assertOk();
        $res->assertJsonPath('request.signedDocument.name', 'Contract (signed).pdf')
            ->assertJsonPath('request.permissions.downloadSigned', true)
            ->assertJsonPath('request.permissions.downloadOriginal', true);

        // Both are real, separate downloads.
        $signedId = $res->json('request.signedDocument.id');
        $originalId = $res->json('request.document.id');
        $this->assertNotSame($signedId, $originalId);

        $this->actingAs($user)->get('/portal/files/files/'.$signedId.'/download')->assertOk();
        $this->actingAs($user)->get('/portal/files/files/'.$originalId.'/download')->assertOk();
    }

    public function test_an_unstampable_pdf_is_refused_at_send_time(): void
    {
        $user = $this->approvedUser();
        // Claims to be a PDF; FPDI can't parse it.
        $broken = $this->vaultFile($user, 'Broken.pdf', 'pdf', 'application/pdf', 'not really a pdf at all');

        $id = $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $broken->uuid])
            ->json('request.id');
        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana', 'email' => 'dana@example.com']],
        ])->json('request.recipients.0.id');
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => [
            ['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],
        ]])->assertOk();

        // Better to fail now than after someone has signed it.
        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')
            ->assertStatus(422)
            ->assertJsonPath('message', 'This document can\'t be prepared for signing — it may be password-protected or damaged.');

        Mail::assertNothingSent();
    }

    public function test_canstamp_accepts_a_real_pdf_and_rejects_rubbish(): void
    {
        $user = $this->approvedUser();

        $this->assertTrue(Stamper::canStamp($this->pdfFile($user)));
        $this->assertTrue(Stamper::canStamp($this->imageFile($user)));
        $this->assertFalse(Stamper::canStamp(
            $this->vaultFile($user, 'Broken.pdf', 'pdf', 'application/pdf', 'nope')
        ));
    }

    public function test_a_non_latin_name_does_not_break_stamping(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);

        $id = $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $original->uuid])
            ->json('request.id');
        // FPDF's core fonts are Latin-1; this must degrade, not explode.
        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'José Müller-Škoda', 'email' => 'jose@example.com']],
        ])->json('request.recipients.0.id');
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => [
            ['type' => 'name', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.5, 'width' => 0.4, 'height' => 0.04],
        ]])->assertOk();
        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')->assertOk();

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $token = SigningToken::reveal($request->recipients()->first());
        $field = $request->fields()->first();

        $this->postJson('/sign/'.$token.'/submit', ['values' => [$field->uuid => null]])->assertOk();

        $this->assertNotNull($request->fresh()->signedFile, 'a non-Latin name must not break the stamper');
        // The stored value keeps the real name; only the PDF rendering degrades.
        $this->assertSame('José Müller-Škoda', $field->fresh()->value);
    }

    public function test_a_declined_request_produces_no_signed_copy(): void
    {
        $user = $this->approvedUser();
        $original = $this->pdfFile($user);

        $id = $this->actingAs($user)->postJson('/portal/signatures', ['fileId' => $original->uuid])
            ->json('request.id');
        $recipient = $this->actingAs($user)->patchJson('/portal/signatures/'.$id, [
            'recipients' => [['name' => 'Dana', 'email' => 'dana@example.com']],
        ])->json('request.recipients.0.id');
        $this->actingAs($user)->putJson('/portal/signatures/'.$id.'/fields', ['fields' => [
            ['type' => 'signature', 'recipient' => $recipient, 'page' => 1,
                'x' => 0.1, 'y' => 0.1, 'width' => 0.2, 'height' => 0.05],
        ]])->assertOk();
        $this->actingAs($user)->postJson('/portal/signatures/'.$id.'/send')->assertOk();

        $request = SignatureRequest::where('uuid', $id)->firstOrFail();
        $this->postJson('/sign/'.SigningToken::reveal($request->recipients()->first()).'/decline')
            ->assertOk();

        $this->assertNull($request->fresh()->signed_file_id);
        Mail::assertNotSent(SignatureCompleted::class);
    }
}
