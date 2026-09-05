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

    /** A mailbox without Outlook's saved-signature store: every Graph read 404s. */
    private function fakeOutlookSavedSignaturesUnavailable(): void
    {
        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);
    }

    /**
     * The hidden-folder walk Graph needs for Outlook's saved signatures:
     * message root → mailbox root → ApplicationDataRoot → the store → one
     * sub-folder per signature → an item whose body is the signature.
     *
     * @param  array<string, string>  $signatures  saved name => body HTML
     * @param  array<string, mixed>  $extra  fakes that must win over the item fakes (attachment bytes)
     * @return array<string, mixed>
     */
    private function outlookSavedSignatureFakes(array $signatures, array $extra = []): array
    {
        $fakes = [
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/mailFolders/msgfolderroot*' => Http::response([
                'id' => 'msgroot-1',
                'parentFolderId' => 'root-1',
            ]),
            'graph.microsoft.com/v1.0/me/mailFolders/root-1/childFolders*' => Http::response(['value' => [
                ['id' => 'common-views', 'displayName' => 'Common Views'],
                ['id' => 'appdata-1', 'displayName' => 'ApplicationDataRoot'],
            ]]),
            'graph.microsoft.com/v1.0/me/mailFolders/appdata-1/childFolders*' => Http::response(['value' => [
                ['id' => 'other-app', 'displayName' => '00000000-0000-0000-0000-000000000000'],
                ['id' => 'sigstore-1', 'displayName' => '49499048-0129-47f5-b95e-f9d315b861a6'],
            ]]),
            'graph.microsoft.com/v1.0/me/mailFolders/sigstore-1/messages*' => Http::response(['value' => []]),
        ];

        $folders = [];
        $i = 0;
        foreach ($signatures as $name => $body) {
            $i++;
            $folders[] = ['id' => 'sigfolder-'.$i, 'displayName' => (string) Str::uuid()];
            $fakes['graph.microsoft.com/v1.0/me/mailFolders/sigfolder-'.$i.'/messages*'] = Http::response(['value' => [
                ['id' => 'sigitem-'.$i, 'subject' => $name],
            ]]);
        }
        $fakes['graph.microsoft.com/v1.0/me/mailFolders/sigstore-1/childFolders*'] = Http::response(['value' => $folders]);

        foreach ($extra as $url => $response) {
            $fakes[$url] = $response;
        }

        $i = 0;
        foreach ($signatures as $name => $body) {
            $i++;
            $fakes['graph.microsoft.com/v1.0/me/messages/sigitem-'.$i.'*'] = is_array($body)
                ? Http::response($body + ['id' => 'sigitem-'.$i, 'subject' => $name])
                : Http::response([
                    'id' => 'sigitem-'.$i,
                    'subject' => $name,
                    'body' => ['contentType' => 'html', 'content' => $body],
                ]);
        }

        $fakes['graph.microsoft.com/*'] = Http::response(['value' => []], 404);

        return $fakes;
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

    public function test_it_lists_each_gmail_send_as_signature_as_a_choice(): void
    {
        $account = $this->account();
        $account->forceFill([
            'scopes' => [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/gmail.settings.basic',
            ],
        ])->save();

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'gmail.googleapis.com/gmail/v1/users/me/settings/sendAs' => Http::response([
                'sendAs' => [
                    ['isPrimary' => true, 'sendAsEmail' => 'user@example.com', 'signature' => '<div>Work Sig</div>'],
                    ['isPrimary' => false, 'sendAsEmail' => 'hello@example.com', 'signature' => '<div>Hello Sig</div>'],
                ],
            ]),
        ]);

        $choices = SignatureImporter::for($account)->choices();

        $this->assertCount(2, $choices);
        $this->assertSame('Default From Gmail', $choices[0]['name']);
        $this->assertStringContainsString('Work Sig', $choices[0]['html']);
        $this->assertSame('Gmail · hello@example.com', $choices[1]['name']);
        $this->assertStringContainsString('Hello Sig', $choices[1]['html']);
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

        $this->fakeOutlookSavedSignaturesUnavailable();

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

        $this->fakeOutlookSavedSignaturesUnavailable();

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

    public function test_it_keeps_outlook_signature_text_that_sits_beside_the_logo(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookSavedSignaturesUnavailable();

        $this->sent(
            $account,
            '<p>See you Thursday.</p><div id="appendonsend"></div>'
            .'<img src="https://cdn.example.com/logo.png" width="160" height="80" alt="Logo">'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
            .'<p>Managing Director</p><p>1-555-0100</p></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Managing Director', $signature);
        $this->assertStringContainsString('1-555-0100', $signature);
        $this->assertStringContainsString('cdn.example.com/logo.png', $signature);
        $this->assertStringNotContainsString('See you Thursday', $signature);
    }

    public function test_it_keeps_the_legal_disclaimer_that_follows_an_outlook_banner(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookSavedSignaturesUnavailable();

        $disclaimer = 'This Electronic Mail and any attached files may contain confidential '
            .'and/or privileged material for the sole use of the intended recipient. '
            .'Any review, use, distribution, or disclosure by others is strictly prohibited. '
            .'If you are not the intended recipient (or authorised to receive this email for '
            .'the recipient), please contact the sender by reply email and delete all copies '
            .'of this email. Further, Electronic messages are not secure or error free and '
            .'can contain viruses or may be delayed. While TM ANTOINE Partners/BESPOKE has '
            .'taken reasonable precautions to ensure that any attachment to this e-mail has '
            .'been scanned for viruses, TM ANTOINE Partners/BESPOKE does not accept any '
            .'liability for any of these occurrences and/or any loss or damage suffered '
            .'resulting from such use.';

        $this->sent(
            $account,
            '<p>Hi Dana, please review the draft.</p>'
            .'<p>--</p>'
            .'<div id="Signature"><img src="https://cdn.example.com/banner.png" width="600" height="120" alt=""></div>'
            .'<p>'.$disclaimer.'</p>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('cdn.example.com/banner.png', $signature);
        $this->assertStringContainsString('This Electronic Mail and any attached files', $signature);
        $this->assertStringContainsString('does not accept any liability', $signature);
        $this->assertStringNotContainsString('Hi Dana', $signature);

        $choices = SignatureImporter::for($account)->choices();
        $this->assertNotEmpty($choices);
        $this->assertStringContainsString('This Electronic Mail', $choices[0]['preview']);
        $this->assertStringContainsString('This Electronic Mail', $choices[0]['name']);
        $this->assertStringNotContainsString(' · --', $choices[0]['name']);
    }

    public function test_it_keeps_outlook_contact_lines_outside_an_image_only_wrapper(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookSavedSignaturesUnavailable();

        $this->sent(
            $account,
            '<p>Thanks.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><img src="https://cdn.example.com/banner.png" width="160" height="80" alt=""></div>'
            .'<p>Vernon Francis</p><p>Managing Director</p>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Managing Director', $signature);
        $this->assertStringContainsString('cdn.example.com/banner.png', $signature);
        $this->assertStringNotContainsString('Thanks.', $signature);
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
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
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

        $this->fakeOutlookSavedSignaturesUnavailable();

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

    public function test_outlook_import_reads_the_signature_saved_in_the_mailbox(): void
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

        Http::fake($this->outlookSavedSignatureFakes([
            'Work' => '<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
                .'<p>Managing Director</p></div>',
        ]));

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Managing Director', $signature);
        $this->assertStringNotContainsString('Dana Reed', $signature);
        $this->assertStringNotContainsString('Wrong leftover', $signature);

        // Reading the store must leave the mailbox alone: no draft created,
        // nothing deleted or changed.
        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'graph.microsoft.com')
            && in_array($request->method(), ['POST', 'DELETE', 'PATCH'], true));
    }

    public function test_outlook_saved_signature_logos_become_data_uris(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        // Minimal valid 1x1 PNG.
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');

        Http::fake($this->outlookSavedSignatureFakes([
            'Work' => [
                'hasAttachments' => false,
                'body' => [
                    'contentType' => 'html',
                    'content' => '<div id="Signature"><p><b>Vernon Francis</b></p>'
                        .'<img src="cid:logo001" width="120" height="40" alt="Logo"></div>',
                ],
                'attachments' => [[
                    'id' => 'att-logo',
                    'name' => 'logo.png',
                    'contentType' => 'image/png',
                    'size' => strlen($png),
                    'isInline' => true,
                    'contentId' => 'logo001',
                ]],
            ],
        ], [
            'graph.microsoft.com/v1.0/me/messages/sigitem-1/attachments/att-logo*' => Http::response($png, 200, [
                'Content-Type' => 'image/png',
            ]),
        ]));

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('data:image/png;base64,', $signature);
        $this->assertStringNotContainsString('cid:logo001', $signature);
    }

    public function test_outlook_import_falls_back_to_sent_mail_when_the_store_is_missing(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->sent(
            $account,
            '<p>Thanks.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><p><b>Outlook User</b></p><p>Advisor</p></div>'
        );

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/mailFolders/msgfolderroot*' => Http::response([
                'id' => 'msgroot-1',
                'parentFolderId' => 'root-1',
            ]),
            'graph.microsoft.com/v1.0/me/mailFolders/root-1/childFolders*' => Http::response(['value' => [
                ['id' => 'common-views', 'displayName' => 'Common Views'],
            ]]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);

        $choices = SignatureImporter::for($account)->choices();

        $this->assertCount(1, $choices);
        $this->assertStringStartsWith('From sent mail', $choices[0]['name']);
        $this->assertStringContainsString('Outlook User', $choices[0]['html']);
    }

    public function test_gmail_import_asks_for_a_reconnect_until_the_settings_scope_is_granted(): void
    {
        $account = $this->account();

        $this->assertSame(
            'Reconnect Gmail to import the signature saved in Gmail.',
            SignatureImporter::for($account)->reconnectHint()
        );

        $account->forceFill(['scopes' => [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/gmail.settings.basic',
        ]])->save();
        $this->assertNull(SignatureImporter::for($account->fresh())->reconnectHint());

        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();
        $this->assertNull(SignatureImporter::for($account->fresh())->reconnectHint());
    }

    public function test_it_keeps_an_outlook_logo_hidden_in_word_vml_comments(): void
    {
        $account = $this->account();
        $account->forceFill([
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$account->user_id,
            'scopes' => ['Mail.ReadWrite'],
        ])->save();

        $this->fakeOutlookSavedSignaturesUnavailable();

        $this->sent(
            $account,
            '<p>See you Thursday.</p><div id="appendonsend"></div>'
            .'<!--[if gte vml 1]><v:shape><v:imagedata src="cid:image001.png"/></v:shape><![endif]-->'
            .'<!--[if !vml]><img src="https://cdn.example.com/logo.png" width="160" height="80" alt="Logo"><![endif]-->'
            .'<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
            .'<p>Managing Director</p></div>'
        );

        $signature = SignatureImporter::for($account)->import();

        $this->assertNotNull($signature);
        $this->assertStringContainsString('Vernon Francis', $signature);
        $this->assertStringContainsString('Managing Director', $signature);
        $this->assertStringContainsString('cdn.example.com/logo.png', $signature);
        $this->assertStringNotContainsString('v:shape', $signature);
        $this->assertStringNotContainsString('See you Thursday', $signature);
    }

    public function test_outlook_lists_the_saved_signature_and_sent_mail_as_separate_choices(): void
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
            '<p>Thanks.</p><div id="appendonsend"></div>'
            .'<div id="Signature"><p>Office hours only</p></div>',
            'seed-1'
        );

        Http::fake($this->outlookSavedSignatureFakes([
            'Work' => '<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
                .'<p>Managing Director</p></div>',
            'Short' => '<p>Vernon</p>',
        ]));

        $choices = SignatureImporter::for($account)->choices();
        $names = collect($choices)->pluck('name')->all();

        $this->assertSame('Saved in Outlook · Work', $names[0]);
        $this->assertContains('Saved in Outlook · Short', $names);
        $this->assertTrue(collect($names)->contains(fn (string $name): bool => str_starts_with($name, 'From sent mail')));
        $this->assertStringContainsString(
            'Vernon Francis',
            (string) collect($choices)->firstWhere('name', 'Saved in Outlook · Work')['html']
        );
        $this->assertStringContainsString(
            'Office hours only',
            (string) collect($choices)->first(
                fn (array $choice): bool => str_starts_with((string) $choice['name'], 'From sent mail')
            )['html']
        );
    }
}
