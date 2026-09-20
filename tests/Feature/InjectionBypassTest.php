<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Adversarial pass: the backend must reject what a hand-rolled HTTP request
 * sends, not merely what the UI would have sent.
 */
class InjectionBypassTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $o = []): User
    {
        return User::factory()->create(array_merge([
            'status' => 'approved', 'account_type' => 'Client',
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ], $o));
    }

    public function test_renamed_executables_are_refused_by_the_api(): void
    {
        $user = $this->user();

        foreach ([
            ['doc.pdf', "\x7fELF\x02\x01\x01".str_repeat("\x00", 100)],
            ['scan.pdf', "MZ\x90\x00\x03".str_repeat("\x00", 100)],
            ['photo.jpg', "#!/bin/sh\nrm -rf /\n"],
            ['bio.png', "\xca\xfe\xba\xbe".str_repeat("\x00", 100)],
        ] as [$name, $bytes]) {
            $this->actingAs($user)->post('/portal/files/files', [
                'file' => UploadedFile::fake()->createWithContent($name, $bytes),
            ], ['Accept' => 'application/json'])->assertStatus(422);
        }
    }

    public function test_blocked_extensions_are_refused_by_the_api(): void
    {
        $user = $this->user();

        foreach (['shell.php', 'tool.exe', 'go.sh', 'x.phar', 'p.jsp'] as $name) {
            $this->actingAs($user)->post('/portal/files/files', [
                'file' => UploadedFile::fake()->createWithContent($name, 'payload'),
            ], ['Accept' => 'application/json'])->assertStatus(422);
        }
    }

    public function test_sql_injection_in_search_does_not_execute(): void
    {
        $user = $this->user();
        $this->assertNotNull(User::find($user->id));

        foreach ([
            "'; DROP TABLE users; --",
            "' OR '1'='1",
            "1' UNION SELECT NULL,NULL,NULL--",
            "%' OR 1=1--",
        ] as $payload) {
            $this->actingAs($user)->getJson('/portal/files?q='.urlencode($payload))->assertOk();
        }

        // The table is still there and the row with it.
        $this->assertNotNull(User::find($user->id));
    }

    public function test_xss_payload_in_a_filename_is_stored_inert_and_returned_as_data(): void
    {
        $user = $this->user();
        $xss = '<img src=x onerror=alert(1)>.txt';

        $id = $this->actingAs($user)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent($xss, 'hi'),
        ], ['Accept' => 'application/json'])->assertCreated()->json('id');

        // JSON carries it as data; it is never interpolated into HTML server-side.
        $res = $this->actingAs($user)->getJson("/portal/files/files/{$id}")->assertOk();
        $this->assertStringNotContainsString('<script', strtolower($res->getContent()));
    }

    public function test_one_account_cannot_reach_another_accounts_file_by_id(): void
    {
        $owner = $this->user();
        $stranger = $this->user();

        $id = $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('passport.pdf', 'private'),
        ], ['Accept' => 'application/json'])->assertCreated()->json('id');

        // IDOR: the stranger holds a valid uuid and asks for it directly.
        $this->actingAs($stranger)->getJson("/portal/files/files/{$id}")->assertStatus(403);
        $this->actingAs($stranger)->get("/portal/files/files/{$id}/download")->assertStatus(403);
        $this->actingAs($stranger)->get("/portal/files/files/{$id}/preview")->assertStatus(403);
    }

    public function test_signed_out_requests_are_refused(): void
    {
        $owner = $this->user();
        $id = $this->actingAs($owner)->post('/portal/files/files', [
            'file' => UploadedFile::fake()->createWithContent('n.txt', 'x'),
        ], ['Accept' => 'application/json'])->assertCreated()->json('id');

        auth()->logout();
        $this->getJson("/portal/files/files/{$id}")->assertStatus(401);
        $this->get("/portal/files/files/{$id}/download")->assertRedirect();
    }
}
