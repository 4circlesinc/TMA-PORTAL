<?php

namespace Tests\Feature;

use App\Models\CipPerson;
use App\Support\Files\Vault;
use App\Support\Security\Envelope;
use App\Support\Security\IdentityFields;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PortalHardeningTest extends TestCase
{
    use RefreshDatabase;

    public function test_vault_bytes_are_envelope_encrypted_and_still_readable(): void
    {
        $source = tempnam(sys_get_temp_dir(), 'tma');
        file_put_contents($source, 'passport-scan');
        $stored = Vault::store($source, 'bin');

        $cipher = Storage::disk($stored['disk'])->get($stored['path']);
        $this->assertTrue(Envelope::isWrapped($cipher));
        $this->assertNotSame('passport-scan', $cipher);
        $this->assertSame('passport-scan', Envelope::unwrapBytes($cipher));
        $this->assertTrue($stored['encrypted']);
    }

    public function test_plain_vault_objects_written_before_encryption_still_open(): void
    {
        Storage::disk(config('filesystems.files_disk'))->put('vault/legacy.bin', 'legacy-plain');
        $this->assertSame(
            'legacy-plain',
            Envelope::readDisk(Storage::disk(config('filesystems.files_disk')), 'vault/legacy.bin')
        );
    }

    public function test_passport_number_and_dob_are_sealed_with_a_lookup(): void
    {
        $person = new CipPerson;
        $person->passport_number = 'X1234567';
        $person->date_of_birth = '1815-12-10';

        $raw = $person->getAttributes();
        $this->assertNotSame('X1234567', $raw['passport_number']);
        $this->assertTrue(IdentityFields::isSealed($raw['passport_number']));
        $this->assertSame(IdentityFields::lookup('X1234567'), $raw['passport_number_lookup']);
        $this->assertSame(IdentityFields::lookup('1815-12-10'), $raw['date_of_birth_lookup']);
        $this->assertSame('X1234567', $person->passport_number);
        $this->assertSame('1815-12-10', $person->date_of_birth->toDateString());
    }

    public function test_security_headers_include_csp_and_permissions_policy(): void
    {
        $response = $this->get(route('login'));

        $csp = $response->headers->get('Content-Security-Policy');
        $this->assertNotNull($csp);
        $this->assertStringContainsString("default-src 'self'", $csp);
        $this->assertStringContainsString("object-src 'none'", $csp);
        $this->assertStringContainsString('frame-ancestors', $csp);
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $response->assertHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        $this->assertStringContainsString('camera=(self)', (string) $response->headers->get('Permissions-Policy'));
    }

    public function test_turnstile_is_skipped_when_keys_are_empty(): void
    {
        $this->assertFalse(\App\Support\Security\Turnstile::enabled());

        $this->post(route('login'), [
            'email' => 'nobody@example.com',
            'password' => 'wrong-password',
        ])->assertStatus(302);
    }

    public function test_identity_public_links_require_a_password(): void
    {
        $user = \App\Models\User::factory()->create([
            'status' => 'approved',
            'account_type' => \App\Support\Access\Role::ADMINISTRATOR,
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
        $folder = \App\Models\Folder::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'name' => 'Client',
            'owner_id' => $user->id,
            'created_by' => $user->id,
        ]);
        $file = \App\Models\FileItem::create([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'folder_id' => $folder->id,
            'name' => 'Passport bio page.pdf',
            'extension' => 'pdf',
            'mime_type' => 'application/pdf',
            'size' => 10,
            'disk' => 'local',
            'storage_path' => 'vault/p.pdf',
            'owner_id' => $user->id,
            'uploaded_by' => $user->id,
        ]);

        $this->actingAs($user)->postJson('/portal/files/shares', [
            'type' => 'file',
            'id' => $file->uuid,
            'mode' => 'link',
            'role' => 'viewer',
        ])->assertStatus(422);

        $this->actingAs($user)->postJson('/portal/files/shares', [
            'type' => 'file',
            'id' => $file->uuid,
            'mode' => 'link',
            'role' => 'viewer',
            'password' => 'correct-horse',
        ])->assertCreated()
            ->assertJsonPath('link.hasPassword', true);
    }
}
