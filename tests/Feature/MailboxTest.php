<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use App\Support\Mail\MailSynchronizer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Covers the mailbox end to end with Gmail faked at the HTTP boundary, so the
 * provider mapping, the sync, and the controller are all exercised without
 * touching a real account.
 */
class MailboxTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        return User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function account(User $user, array $overrides = []): ConnectedAccount
    {
        return ConnectedAccount::create(array_merge([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ], $overrides));
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-1',
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'snippet' => 'Attached is the summary',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    private function pickImportedSignature(User $user, int $index = 0): array
    {
        $preview = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk();
        $choices = $preview->json('choices');
        $this->assertIsArray($choices);
        $this->assertNotEmpty($choices);
        $choice = $choices[$index];

        return $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature/apply', [
                'html' => $choice['html'],
                'name' => $choice['name'],
            ])
            ->assertOk()
            ->json();
    }

    private function fakeTokenEndpoint(array $extra = []): void
    {
        Http::fake(array_merge([
            'oauth2.googleapis.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
        ], $extra));
    }

    public function test_a_user_without_a_connected_mailbox_is_told_so_rather_than_shown_nothing(): void
    {
        $this->actingAs($this->user())
            ->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('connected', false)
            ->assertJsonPath('folders', []);
    }

    public function test_the_inbox_lists_synced_messages_newest_first_with_folder_counts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        // Separate conversations on purpose: this is about ordering, and the
        // listing groups a thread into one row (see MailConversationListTest),
        // so two messages sharing the helper's default thread id would be one.
        $this->message($user, $account, [
            'remote_id' => 'old', 'thread_id' => 'thread-old',
            'subject' => 'Older', 'sent_at' => now()->subDays(2),
        ]);
        $this->message($user, $account, [
            'remote_id' => 'new', 'thread_id' => 'thread-new',
            'subject' => 'Newer', 'sent_at' => now(),
        ]);
        $this->message($user, $account, ['remote_id' => 'sent-1', 'folder' => 'sent', 'is_read' => true]);

        $this->fakeTokenEndpoint();

        $this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=inbox')
            ->assertOk()
            ->assertJsonPath('messages.0.subject', 'Newer')
            ->assertJsonPath('messages.1.subject', 'Older')
            ->assertJsonCount(2, 'messages');

        $this->actingAs($user)
            ->getJson('/portal/mail')
            ->assertOk()
            ->assertJsonPath('connected', true)
            // Both inbox messages are unread; the sent one is not counted here.
            ->assertJsonPath('folders.inbox.unread', 2)
            ->assertJsonPath('folders.sent.total', 1);
    }

    /**
     * `time` is a UTC Carbon label (H:i for today). The home widget and the
     * mailbox must render from `sentAt` so a 12:09 AM message is not shown
     * as 04:09 to anyone west of UTC.
     */
    public function test_list_rows_carry_an_iso_instant_because_the_time_label_is_utc(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-06 04:32:00', 'UTC'));

        $user = $this->user();
        $account = $this->account($user);
        $sentAt = Carbon::parse('2026-09-06 04:09:00', 'UTC');
        $this->message($user, $account, ['sent_at' => $sentAt]);

        $this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=inbox')
            ->assertOk()
            ->assertJsonPath('messages.0.time', '04:09')
            ->assertJsonPath('messages.0.sentAt', $sentAt->toIso8601String());
    }

    public function test_starring_a_message_reaches_gmail_and_is_mirrored_locally(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'gmail-1']),
        ]);

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['starred' => true])
            ->assertOk()
            ->assertJsonPath('message.starred', true);

        $this->assertTrue($message->fresh()->is_starred);

        // The STARRED label must actually have been added at the provider.
        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/messages/gmail-1/modify')
                && in_array('STARRED', $request['addLabelIds'] ?? [], true);
        });
    }

    public function test_archiving_moves_the_message_and_removes_the_inbox_label(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'gmail-1']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$message->uuid.'/move', ['folder' => 'archive'])
            ->assertOk()
            ->assertJsonPath('message.folder', 'archive');

        $this->assertSame('archive', $message->fresh()->folder);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/messages/gmail-1/modify')
                && in_array('INBOX', $request['removeLabelIds'] ?? [], true);
        });
    }

    public function test_deleting_from_trash_permanently_removes_the_message(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account, ['folder' => 'trash']);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'gmail-1']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$message->uuid.'/move', ['folder' => 'trash'])
            ->assertOk()
            ->assertJsonMissingPath('message');

        $this->assertDatabaseMissing('mail_messages', ['id' => $message->id]);

        Http::assertSent(function ($request) {
            return $request->method() === 'DELETE'
                && str_contains($request->url(), '/messages/gmail-1');
        });
    }

    public function test_a_message_body_is_fetched_on_first_open_and_cached_after(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-1*' => Http::response([
                'id' => 'gmail-1',
                'threadId' => 'thread-1',
                'labelIds' => ['INBOX'],
                'internalDate' => (string) (now()->getTimestamp() * 1000),
                'snippet' => 'Attached is the summary',
                'payload' => [
                    'headers' => [
                        ['name' => 'From', 'value' => 'Dana Reed <dana@example.com>'],
                        ['name' => 'Subject', 'value' => 'Quarterly review'],
                    ],
                    'mimeType' => 'text/html',
                    'body' => ['data' => rtrim(strtr(base64_encode('<p>Full body</p>'), '+/', '-_'), '=')],
                ],
            ]),
        ]);

        $this->actingAs($user)
            ->getJson('/portal/mail/messages/'.$message->uuid)
            ->assertOk()
            ->assertJsonPath('message.bodyHtml', '<p>Full body</p>');

        $this->assertSame('<p>Full body</p>', $message->fresh()->body_html);
    }

    public function test_sending_posts_a_message_to_gmail(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->fakeTokenEndpoint([
            'gmail.googleapis.com/*' => Http::response(['id' => 'sent-123']),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'client@example.com', 'name' => 'A Client']],
                'subject' => 'Invoice attached',
                'bodyHtml' => '<p>Please find it enclosed.</p>',
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        Http::assertSent(function ($request) {
            if (! str_contains($request->url(), '/messages/send')) {
                return false;
            }

            // The raw MIME must carry the recipient and subject.
            $raw = base64_decode(strtr($request['raw'], '-_', '+/'), true);

            return str_contains($raw, 'client@example.com')
                && str_contains($raw, 'Invoice attached');
        });
    }

    public function test_a_revoked_grant_asks_the_user_to_reconnect_instead_of_failing(): void
    {
        $user = $this->user();
        $this->account($user);

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/sync')
            ->assertStatus(409)
            ->assertJsonPath('reconnect', true);
    }

    public function test_the_sync_maps_gmail_labels_onto_portal_folders_and_flags(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $encoded = fn (string $id) => [
            'id' => $id,
            'threadId' => 't-'.$id,
            'labelIds' => ['INBOX', 'UNREAD', 'STARRED'],
            'internalDate' => (string) (now()->getTimestamp() * 1000),
            'snippet' => 'Hello there',
            'payload' => [
                'headers' => [
                    ['name' => 'From', 'value' => 'Sam Lee <sam@example.com>'],
                    ['name' => 'Subject', 'value' => 'Hello'],
                ],
            ],
        ];

        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'a', 'expires_in' => 3600]),
            'gmail.googleapis.com/gmail/v1/users/me/labels' => Http::response(['labels' => []]),
            'gmail.googleapis.com/gmail/v1/users/me/profile' => Http::response(['historyId' => '999']),
            'gmail.googleapis.com/gmail/v1/users/me/messages/m1*' => Http::response($encoded('m1')),
            'gmail.googleapis.com/gmail/v1/users/me/messages*' => function ($request) {
                $label = $request['labelIds'] ?? null;
                if ($label === 'INBOX' || $label === ['INBOX']) {
                    return Http::response(['messages' => [['id' => 'm1']]]);
                }

                return Http::response(['messages' => []]);
            },
        ]);

        new MailSynchronizer($account)->sync();

        $message = MailMessage::where('remote_id', 'm1')->first();

        $this->assertNotNull($message);
        $this->assertSame('inbox', $message->folder);
        $this->assertSame('Sam Lee', $message->from_name);
        $this->assertSame('sam@example.com', $message->from_email);
        $this->assertFalse($message->is_read);
        $this->assertTrue($message->is_starred);

        // The cursor is what makes the next sync incremental.
        $this->assertSame('999', $account->fresh()->mail_cursor);
    }

    public function test_one_user_cannot_reach_another_users_message(): void
    {
        $owner = $this->user();
        $intruder = $this->user();
        $message = $this->message($owner, $this->account($owner));

        $this->actingAs($intruder)
            ->getJson('/portal/mail/messages/'.$message->uuid)
            ->assertNotFound();
    }

    public function test_mail_preferences_round_trip(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', [
                'preferences' => ['signature' => 'Sent from the portal', 'undoSendSeconds' => 12],
            ])
            ->assertOk()
            ->assertJsonPath('preferences.signature', 'Sent from the portal')
            ->assertJsonPath('preferences.undoSendSeconds', 12)
            // Untouched preferences keep their defaults.
            ->assertJsonPath('preferences.conversationView', true)
            // A legacy single signature becomes a selectable library entry.
            ->assertJsonPath('preferences.signatures.0.html', 'Sent from the portal');

        $activeId = $this->actingAs($user)
            ->getJson('/portal/mail/settings')
            ->assertOk()
            ->json('preferences.activeSignatureId');
        $this->assertIsString($activeId);
        $this->assertNotSame('', $activeId);
    }

    public function test_signature_library_can_be_selected_and_updated(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', [
                'preferences' => [
                    'signatures' => [
                        ['id' => 'sig-a', 'name' => 'Work', 'html' => '<div>Work</div>'],
                        ['id' => 'sig-b', 'name' => 'Personal', 'html' => '<div>Personal</div>'],
                    ],
                    'activeSignatureId' => 'sig-b',
                ],
            ])
            ->assertOk()
            ->assertJsonPath('preferences.activeSignatureId', 'sig-b')
            ->assertJsonPath('preferences.signature', '<div>Personal</div>')
            ->assertJsonPath('preferences.signatures.0.name', 'Work')
            ->assertJsonPath('preferences.signatures.1.name', 'Personal');

        // Editing only the active HTML keeps the selected entry in sync.
        $this->actingAs($user)
            ->putJson('/portal/mail/settings', [
                'preferences' => ['signature' => '<div>Personal updated</div>'],
            ])
            ->assertOk()
            ->assertJsonPath('preferences.activeSignatureId', 'sig-b')
            ->assertJsonPath('preferences.signature', '<div>Personal updated</div>')
            ->assertJsonPath('preferences.signatures.1.html', '<div>Personal updated</div>')
            ->assertJsonPath('preferences.signatures.0.html', '<div>Work</div>');
    }

    public function test_signature_html_keeps_a_full_size_logo_data_uri(): void
    {
        $user = $this->user();
        $this->account($user);

        $logo = 'data:image/png;base64,'.str_repeat('A', 120000);
        $html = '<div><img src="'.$logo.'" width="160" height="80" alt="Logo"></div>';
        $this->assertGreaterThan(100000, strlen($html));

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', [
                'preferences' => ['signature' => $html],
            ])
            ->assertOk();

        $stored = (string) data_get($user->fresh()->preferences, 'mail.signature');
        $this->assertSame($html, $stored);
        $this->assertGreaterThan(100000, strlen($stored));
        $this->assertStringContainsString($logo, $stored);
    }

    public function test_import_signature_keeps_a_full_size_logo(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $payload = str_repeat('B', 110000);
        $logo = 'data:image/png;base64,'.$payload;

        $this->message($user, $account, [
            'remote_id' => 'sent-hires-sig',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<div>Hi</div><div class="gmail_signature" data-smartmail="gmail_signature">'
                .'<div>Test User</div><img src="'.$logo.'" width="160" height="80" alt="Logo"></div>',
        ]);

        $this->assertNull(data_get($user->fresh()->preferences, 'mail.signature'));

        $applied = $this->pickImportedSignature($user);
        $stored = (string) data_get($applied, 'preferences.signature');
        $this->assertGreaterThan(100000, strlen($stored));
        $this->assertStringContainsString($payload, $stored);
        $this->assertStringNotContainsString('Hi', $stored);
    }

    public function test_import_signature_copies_the_mailbox_signature_into_preferences(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, [
            'remote_id' => 'sent-sig',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<div>Hi</div><div class="gmail_signature" data-smartmail="gmail_signature">'
                .'<div><b>Test User</b></div><div>TMA</div></div>',
        ]);

        $preview = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk();

        $this->assertNull(data_get($user->fresh()->preferences, 'mail.signature'));
        $choices = $preview->json('choices');
        $this->assertNotEmpty($choices);
        $this->assertStringContainsString('Test User', (string) $choices[0]['html']);
        $this->assertStringContainsString('TMA', (string) $choices[0]['html']);
        $this->assertStringNotContainsString('Hi', (string) $choices[0]['html']);

        $response = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature/apply', [
                'html' => $choices[0]['html'],
                'name' => $choices[0]['name'],
            ])
            ->assertOk();

        $signature = $response->json('preferences.signature');
        $this->assertIsString($signature);
        $this->assertStringContainsString('Test User', $signature);
        $this->assertStringContainsString('TMA', $signature);
        $this->assertStringContainsString(
            'Test User',
            data_get($user->fresh()->preferences, 'mail.signature')
        );
        $this->assertSame(
            $choices[0]['name'],
            data_get($response->json('preferences.signatures'), '0.name')
        );
    }

    public function test_import_signature_keeps_existing_library_entries(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $user->forceFill([
            'preferences' => [
                'mail' => [
                    'signatures' => [
                        ['id' => 'sig-work', 'name' => 'Work', 'html' => '<div>Work</div>'],
                    ],
                    'activeSignatureId' => 'sig-work',
                    'signature' => '<div>Work</div>',
                ],
            ],
        ])->save();

        $this->message($user, $account, [
            'remote_id' => 'sent-sig-keep',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<div>Hi</div><div class="gmail_signature" data-smartmail="gmail_signature">'
                .'<div><b>Imported User</b></div></div>',
        ]);

        $preview = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk();
        $choices = $preview->json('choices');
        $this->assertNotEmpty($choices);

        $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature/apply', [
                'html' => $choices[0]['html'],
                'name' => $choices[0]['name'],
            ])
            ->assertOk();

        $names = collect(data_get($user->fresh()->preferences, 'mail.signatures'))->pluck('name')->all();
        $this->assertContains('Work', $names);
        $this->assertStringContainsString('Work', (string) collect(data_get($user->fresh()->preferences, 'mail.signatures'))->firstWhere('name', 'Work')['html']);
        $this->assertStringContainsString('Imported User', (string) data_get($user->fresh()->preferences, 'mail.signature'));
    }

    public function test_import_signature_names_outlook_defaults(): void
    {
        $user = $this->user();
        $account = $this->account($user, [
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'scopes' => ['Mail.ReadWrite'],
        ]);

        $this->message($user, $account, [
            'remote_id' => 'sent-outlook-sig',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<div>Hi</div><div id="Signature"><div><b>Outlook User</b></div></div>',
        ]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);

        $preview = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk();
        $this->assertNotEmpty($preview->json('choices'));
        $this->assertStringContainsString(
            'Outlook User',
            (string) data_get($preview->json('choices'), '0.html')
        );
        $this->assertNull(data_get($user->fresh()->preferences, 'mail.signature'));
    }

    public function test_import_signature_saves_only_the_outlook_choice_the_user_picks(): void
    {
        $user = $this->user();
        $account = $this->account($user, [
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'scopes' => ['Mail.ReadWrite'],
        ]);

        $this->message($user, $account, [
            'remote_id' => 'seed-1',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<p>Thanks.</p><div id="appendonsend"></div>'
                .'<div id="Signature"><p>Office hours only</p></div>',
        ]);

        // The signature saved in Outlook lives in a hidden mailbox folder:
        // message root → mailbox root → ApplicationDataRoot → store → one
        // folder per signature → the item whose body is the signature.
        $savedBody = '<div id="Signature"><p>Kind Regards,</p><p><b>Vernon Francis</b></p>'
            .'<p>Managing Director</p></div>';

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
                ['id' => 'appdata-1', 'displayName' => 'ApplicationDataRoot'],
            ]]),
            'graph.microsoft.com/v1.0/me/mailFolders/appdata-1/childFolders*' => Http::response(['value' => [
                ['id' => 'sigstore-1', 'displayName' => '49499048-0129-47f5-b95e-f9d315b861a6'],
            ]]),
            'graph.microsoft.com/v1.0/me/mailFolders/sigstore-1/childFolders*' => Http::response(['value' => [
                ['id' => 'sigfolder-1', 'displayName' => 'Work'],
            ]]),
            'graph.microsoft.com/v1.0/me/mailFolders/sigstore-1/messages*' => Http::response(['value' => []]),
            'graph.microsoft.com/v1.0/me/mailFolders/sigfolder-1/messages*' => Http::response(['value' => [
                ['id' => 'sigitem-1', 'subject' => 'Work'],
            ]]),
            'graph.microsoft.com/v1.0/me/messages/sigitem-1*' => Http::response([
                'id' => 'sigitem-1',
                'subject' => 'Work',
                'body' => ['contentType' => 'html', 'content' => $savedBody],
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);

        $preview = $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk()
            ->assertJsonPath('reconnect', false);

        $choices = $preview->json('choices');
        $this->assertIsArray($choices);
        $this->assertGreaterThanOrEqual(2, count($choices));
        $this->assertNull(data_get($user->fresh()->preferences, 'mail.signature'));

        $names = collect($choices)->pluck('name');
        $this->assertTrue($names->contains('Saved in Outlook · Work'));
        $this->assertTrue($names->contains(fn ($name) => is_string($name) && str_starts_with($name, 'From sent mail')));

        $picked = collect($choices)->firstWhere('name', 'Saved in Outlook · Work');
        $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature/apply', [
                'html' => $picked['html'],
                'name' => $picked['name'],
            ])
            ->assertOk();

        $html = (string) data_get($user->fresh()->preferences, 'mail.signature');
        $this->assertStringContainsString('Vernon Francis', $html);
        $this->assertStringContainsString('Kind Regards', $html);
        $this->assertStringNotContainsString('Office hours only', $html);
        $this->assertSame('Saved in Outlook · Work', data_get($user->fresh()->preferences, 'mail.signatures.0.name'));

        // Reading the store never creates a draft or deletes anything.
        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'graph.microsoft.com')
            && in_array($request->method(), ['POST', 'DELETE', 'PATCH'], true));
    }

    public function test_import_signature_reads_outlook_mail_that_uses_appendonsend(): void
    {
        $user = $this->user();
        $account = $this->account($user, [
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'scopes' => ['Mail.ReadWrite'],
        ]);

        $this->message($user, $account, [
            'remote_id' => 'sent-append',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<p>See you Thursday.</p><div id="appendonsend"></div>'
                .'<div id="Signature"><p>Kind Regards,</p><p>Outlook User</p></div>',
        ]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);

        $applied = $this->pickImportedSignature($user);
        $html = (string) data_get($applied, 'preferences.signature');
        $this->assertStringContainsString('Outlook User', $html);
        $this->assertStringContainsString('Kind Regards', $html);
        $this->assertStringNotContainsString('See you Thursday', $html);
    }

    public function test_import_signature_explains_when_nothing_is_found(): void
    {
        $user = $this->user();
        $account = $this->account($user, [
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'scopes' => ['Mail.ReadWrite'],
        ]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['value' => []], 404),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertStatus(422)
            ->assertJsonPath('choices', [])
            ->assertJsonPath('signature', null)
            ->assertJsonPath('reconnect', false)
            ->assertJsonStructure(['message']);
    }

    /**
     * Gmail only shares the saved signature under gmail.settings.basic.
     * A connection made before that scope was requested still gets the
     * sent-mail guesses, but the response says a reconnect would do better.
     */
    public function test_import_signature_asks_gmail_users_to_reconnect_for_the_saved_signature(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertStatus(422)
            ->assertJsonPath('reconnect', true)
            ->assertJsonPath('message', 'Reconnect Gmail to import the signature saved in Gmail.');

        $this->message($user, $account, [
            'remote_id' => 'sent-1',
            'folder' => 'sent',
            'from_email' => 'user@example.com',
            'from_name' => 'Test User',
            'is_read' => true,
            'body_html' => '<div>Hi</div><div class="gmail_signature" data-smartmail="gmail_signature">'
                .'<div><b>Test User</b></div></div>',
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/settings/import-signature')
            ->assertOk()
            ->assertJsonPath('reconnect', true)
            ->assertJsonPath('choices.0.name', 'Default From Gmail');
    }

    public function test_import_signature_requires_a_connected_mailbox(): void
    {
        $this->actingAs($this->user())
            ->postJson('/portal/mail/settings/import-signature')
            ->assertStatus(422)
            ->assertJsonStructure(['message']);
    }
}
