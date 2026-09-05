<?php

namespace Tests\Unit;

use App\Models\ConnectedAccount;
use App\Models\MailAttachment;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\SignatureImporter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
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

    /** Sent-mail tests must not hit Graph createReply. */
    private function fakeOutlookReplyDraftUnavailable(): void
    {
        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*/createReply' => Http::response(['error' => ['message' => 'unavailable']], 400),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
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

        Http::fake(['*' => Http::response(['messages' => [], 'value' => []], 404)]);

        $this->assertNull(SignatureImporter::for($account)->import());
    }

    public function test_it_reads_the_configured_gmail_signature_when_the_scope_allows(): void
    {
        $account = $this->account();
        $account->forceFill([
            'scopes' => [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/gmail.settings.basic',
            ],
        ])->save();

        // Sent mail carries a different block — the configured one must win.
        $this->sent($account, '<div class="gmail_signature"><div>Sent-mail Sig</div></div>');

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/gmail/v1/users/me/settings/sendAs' => Http::response([
                'sendAs' => [
                    ['isPrimary' => false, 'signature' => '<div>Alias Sig</div>'],
                    ['isPrimary' => true, 'signature' => '<div><b>Configured Sig</b><script>x()</script></div>'],
                ],
            ]),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Configured Sig', $signature);
        $this->assertStringNotContainsString('Alias Sig', $signature);
        $this->assertStringNotContainsString('Sent-mail Sig', $signature);
        $this->assertStringNotContainsString('<script', $signature);
    }

    public function test_it_falls_back_to_sent_mail_when_the_gmail_settings_call_fails(): void
    {
        $account = $this->account();
        $account->forceFill([
            'scopes' => [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/gmail.settings.basic',
            ],
        ])->save();

        $this->sent($account, '<div class="gmail_signature"><div>Sent-mail Sig</div></div>');

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/gmail/v1/users/me/settings/sendAs' => Http::response(null, 403),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Sent-mail Sig', $signature);
    }

    public function test_it_embeds_cid_signature_images_as_data_uris(): void
    {
        $account = $this->account();
        $message = $this->sent(
            $account,
            '<div class="gmail_signature" data-smartmail="gmail_signature">'
            .'<div>Jane Doe</div>'
            .'<img src="cid:logo001" width="120" height="40" alt="Logo">'
            .'</div>'
        );

        MailAttachment::create([
            'uuid' => (string) Str::uuid(),
            'mail_message_id' => $message->id,
            'remote_id' => 'att-logo',
            'filename' => 'logo.png',
            'mime_type' => 'image/png',
            'size' => 68,
            'is_inline' => true,
            'content_id' => 'logo001',
        ]);

        // Minimal valid 1x1 PNG.
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/*/messages/sent-1/attachments/att-logo*' => Http::response([
                'data' => rtrim(strtr(base64_encode($png), '+/', '-_'), '='),
            ]),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Jane Doe', $signature);
        $this->assertStringContainsString('data:image/png;base64,', $signature);
        $this->assertStringNotContainsString('cid:logo001', $signature);
    }

    public function test_imported_signature_images_keep_their_source_resolution(): void
    {
        if (! function_exists('imagecreatetruecolor') || ! function_exists('getimagesizefromstring')) {
            $this->markTestSkipped('GD is required to assert image dimensions.');
        }

        $png = $this->noisyPng(640, 320);
        $this->assertGreaterThan(80_000, strlen($png), 'the fixture must be large enough that the old importer would have crushed it');

        $account = $this->account();
        $message = $this->sent(
            $account,
            '<div class="gmail_signature" data-smartmail="gmail_signature">'
            .'<div>Jane Doe</div>'
            .'<img src="cid:logo-hires" width="160" height="80" alt="Logo">'
            .'</div>'
        );

        MailAttachment::create([
            'uuid' => (string) Str::uuid(),
            'mail_message_id' => $message->id,
            'remote_id' => 'att-hires',
            'filename' => 'logo.png',
            'mime_type' => 'image/png',
            'size' => strlen($png),
            'is_inline' => true,
            'content_id' => 'logo-hires',
        ]);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/*/messages/sent-1/attachments/att-hires*' => Http::response([
                'data' => rtrim(strtr(base64_encode($png), '+/', '-_'), '='),
            ]),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertMatchesRegularExpression('/data:image\/png;base64,([A-Za-z0-9+\/=]+)/', $signature);
        preg_match('/data:image\/png;base64,([A-Za-z0-9+\/=]+)/', $signature, $match);
        $decoded = base64_decode($match[1], true);
        $this->assertNotFalse($decoded);
        $info = getimagesizefromstring($decoded);
        $this->assertIsArray($info);
        $this->assertSame(640, $info[0]);
        $this->assertSame(320, $info[1]);
    }

    /** Uncompressible noise so PNG size stays above the old 80 KB crush threshold. */
    private function noisyPng(int $width, int $height): string
    {
        $image = imagecreatetruecolor($width, $height);
        for ($y = 0; $y < $height; $y += 2) {
            for ($x = 0; $x < $width; $x += 2) {
                $color = imagecolorallocate($image, ($x * 13) % 256, ($y * 7) % 256, ($x + $y) % 256);
                imagefilledrectangle($image, $x, $y, $x + 1, $y + 1, $color);
            }
        }
        ob_start();
        imagepng($image, null, 0);
        imagedestroy($image);

        return ob_get_clean() ?: '';
    }

    public function test_it_lifts_an_outlook_signature_after_appendonsend(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookReplyDraftUnavailable();

        $disclaimer = str_repeat('This Electronic Mail and any attached files may contain confidential information. ', 12);

        $this->sent(
            $account,
            '<div class="WordSection1"><p class="MsoNormal">Hi Dana, please review.</p>'
            .'<div id="appendonsend"></div>'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
            .'<p>'.$disclaimer.'</p></div></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Kind Regards', $signature);
        $this->assertStringContainsString('confidential', $signature);
        $this->assertStringNotContainsString('Hi Dana', $signature);
    }

    public function test_it_lifts_an_outlook_signature_that_has_no_signature_id(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookReplyDraftUnavailable();

        $this->sent(
            $account,
            '<p>Thanks for the update.</p><div id="appendonsend"></div>'
            .'<p>Kind Regards,</p><p><b>Sam Lee</b></p><p>Partner</p>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Sam Lee', $signature);
        $this->assertStringContainsString('Kind Regards', $signature);
        $this->assertStringNotContainsString('Thanks for the update', $signature);
    }

    public function test_it_fetches_sent_bodies_when_the_local_row_has_none(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $message = $this->sent($account, '', 'sent-empty');
        $message->forceFill(['body_html' => null])->save();

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*/createReply' => Http::response(['error' => ['message' => 'unavailable']], 400),
            'graph.microsoft.com/v1.0/me/messages/sent-empty*' => Http::response([
                'id' => 'sent-empty',
                'conversationId' => 'c-sent-empty',
                'subject' => 'Hello',
                'bodyPreview' => 'Hi',
                'from' => ['emailAddress' => ['name' => 'Test User', 'address' => 'user@example.com']],
                'body' => [
                    'contentType' => 'html',
                    'content' => '<p>Hi there</p><div id="Signature"><p><b>Outlook User</b></p><p>Advisor</p></div>',
                ],
            ]),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Outlook User', $signature);
        $this->assertStringContainsString('Advisor', $signature);
        $this->assertStringNotContainsString('Hi there', $signature);
        $this->assertNotNull($message->fresh()->body_html);
    }

    public function test_it_does_not_import_a_quoted_outlook_signature(): void
    {
        $account = $this->account();
        $account->forceFill([
            'name' => 'Vernon Francis',
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookReplyDraftUnavailable();

        $quoted = '<div id="divRplyFwdMsg"><hr><b>From:</b> Dana Reed<br>'
            .'<div id="Signature"><p>Dana Reed</p><p>Client Corp</p></div></div>';

        $this->sent(
            $account,
            '<p>Sounds good.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p></div>'
            .$quoted,
            'reply-1'
        );
        $this->sent(
            $account,
            '<p>Following up.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p></div>'
            .$quoted,
            'reply-2'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringNotContainsString('Dana Reed', $signature);
        $this->assertStringNotContainsString('Client Corp', $signature);
    }

    public function test_it_does_not_import_a_quoted_gmail_signature(): void
    {
        $account = $this->account();

        $this->sent(
            $account,
            '<div>On it.</div>'
            .'<div class="gmail_signature" data-smartmail="gmail_signature"><div>Jane Doe</div><div>Advisor</div></div>'
            .'<div class="gmail_quote">On Mon, Dana wrote:<br>'
            .'<div class="gmail_signature">Dana Reed<br>Other Co</div></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Jane Doe', $signature);
        $this->assertStringContainsString('Advisor', $signature);
        $this->assertStringNotContainsString('Dana Reed', $signature);
        $this->assertStringNotContainsString('Other Co', $signature);
    }

    public function test_outlook_import_uses_the_signature_outlook_puts_on_a_reply_draft(): void
    {
        $account = $this->account();
        $account->forceFill([
            'name' => 'Vernon Francis',
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->sent(
            $account,
            '<p>Sounds good.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><p>Wrong leftover</p></div>'
            .'<div id="divRplyFwdMsg"><div id="Signature"><p>Dana Reed</p></div></div>',
            'seed-1'
        );

        $draftBody = '<div></div><div id="appendonsend"></div>'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
            .'<p>Managing Director</p></div>'
            .'<div id="divRplyFwdMsg"><b>From:</b> Dana Reed'
            .'<div id="Signature"><p>Dana Reed</p><p>Client Corp</p></div></div>';

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages/seed-1/createReply' => Http::response([
                'id' => 'draft-sig-1',
            ]),
            'graph.microsoft.com/v1.0/me/messages/draft-sig-1*' => Http::response([
                'id' => 'draft-sig-1',
                'conversationId' => 'c-draft',
                'subject' => 'Re: Hello',
                'bodyPreview' => 'Kind Regards',
                'from' => ['emailAddress' => ['name' => 'Vernon Francis', 'address' => 'user@example.com']],
                'body' => [
                    'contentType' => 'html',
                    'content' => $draftBody,
                ],
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []]),
        ]);

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Managing Director', $signature);
        $this->assertStringNotContainsString('Dana Reed', $signature);
        $this->assertStringNotContainsString('Wrong leftover', $signature);

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_contains($request->url(), 'messages/seed-1/createReply'));
        Http::assertSent(fn ($request) => $request->method() === 'DELETE'
            && str_contains($request->url(), 'messages/draft-sig-1'));
    }
}
