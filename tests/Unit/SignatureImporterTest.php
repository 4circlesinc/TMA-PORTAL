<?php

namespace Tests\Unit;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\SignatureImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class SignatureImporterTest extends TestCase
{
    use RefreshDatabase;

    private function account(): ConnectedAccount
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);
    }

    private function sent(ConnectedAccount $account, string $html, string $remoteId = 'sent-1'): MailMessage
    {
        return MailMessage::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $account->user_id,
            'connected_account_id' => $account->id,
            'remote_id' => $remoteId,
            'thread_id' => 'thread-'.$remoteId,
            'folder' => 'sent',
            'subject' => 'Hello',
            'snippet' => 'Hello',
            'body_html' => $html,
            'from_name' => 'Test User',
            'from_email' => 'user@example.com',
            'is_read' => true,
            'sent_at' => now(),
        ]);
    }

    public function test_it_lifts_a_gmail_signature_block_from_sent_mail(): void
    {
        $account = $this->account();
        $this->sent(
            $account,
            '<div>Hello there</div><div class="gmail_signature" data-smartmail="gmail_signature">'
            .'<div>Jane Doe</div><div>Advisor</div></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Jane Doe', $signature);
        $this->assertStringContainsString('Advisor', $signature);
        $this->assertStringNotContainsString('Hello there', $signature);
    }

    public function test_it_lifts_an_outlook_signature_block_from_sent_mail(): void
    {
        $account = $this->account();
        $this->sent(
            $account,
            '<div>Thanks</div><div id="Signature"><p><b>Sam Lee</b><br>Partner</p></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Sam Lee', $signature);
        $this->assertStringContainsString('Partner', $signature);
    }

    public function test_it_prefers_the_signature_that_repeats_across_sent_mail(): void
    {
        $account = $this->account();

        $shared = '<div class="gmail_signature"><div>Shared Sig</div></div>';
        $this->sent($account, '<div>One</div>'.$shared, 'a');
        $this->sent($account, '<div>Two</div>'.$shared, 'b');
        $this->sent(
            $account,
            '<div>Three</div><div class="gmail_signature"><div>One-off</div></div>',
            'c'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Shared Sig', $signature);
        $this->assertStringNotContainsString('One-off', $signature);
    }

    public function test_it_strips_scripts_from_imported_html(): void
    {
        $account = $this->account();
        $this->sent(
            $account,
            '<div class="gmail_signature"><div>Safe</div>'
            .'<script>alert(1)</script><img src="https://cdn.example.com/logo.png" onerror="alert(1)"></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Safe', $signature);
        $this->assertStringContainsString('https://cdn.example.com/logo.png', $signature);
        $this->assertStringNotContainsString('<script', $signature);
        $this->assertStringNotContainsString('onerror', $signature);
    }

    public function test_it_returns_null_when_the_mailbox_has_no_sent_mail(): void
    {
        $account = $this->account();

        $this->assertNull(SignatureImporter::for($account)->import());
    }
}
