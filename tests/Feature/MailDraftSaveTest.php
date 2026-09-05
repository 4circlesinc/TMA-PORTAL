<?php

namespace Tests\Feature;

use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\MailCorrespondent;
use App\Models\MailDraft;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * Compose autosave writes the portal row and mirrors it into Outlook/Gmail
 * Drafts from the first save, then reuses that remote draft on send.
 */
class MailDraftSaveTest extends TestCase
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

    private function microsoftAccount(User $user): ConnectedAccount
    {
        return ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'microsoft',
            'provider_id' => 'ms-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['Mail.ReadWrite', 'Mail.Send'],
            'sync_email' => true,
        ]);
    }

    public function test_saving_a_new_draft_creates_it_in_outlook(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
        ]);

        $response = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'to' => [['email' => 'dana@example.com', 'name' => 'Dana']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Draft body</p>',
            ])
            ->assertOk();

        $uuid = $response->json('draft.id');
        $this->assertNotEmpty($uuid);

        $this->assertDatabaseHas('mail_drafts', [
            'uuid' => $uuid,
            'user_id' => $user->id,
            'remote_id' => 'outlook-draft-1',
            'subject' => 'Hello',
        ]);

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && preg_match('#/me/messages$#', parse_url($request->url(), PHP_URL_PATH) ?: '')
            && ($request['subject'] ?? null) === 'Hello');
    }

    public function test_updating_a_draft_patches_the_same_outlook_message(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1' => Http::response(['id' => 'outlook-draft-1']),
        ]);

        $uuid = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'subject' => 'Hello',
                'bodyHtml' => '<p>First</p>',
            ])
            ->assertOk()
            ->json('draft.id');

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'id' => $uuid,
                'subject' => 'Hello again',
                'bodyHtml' => '<p>Second</p>',
            ])
            ->assertOk();

        $this->assertSame(1, MailDraft::query()->where('user_id', $user->id)->count());
        $this->assertSame('outlook-draft-1', MailDraft::query()->where('uuid', $uuid)->value('remote_id'));

        Http::assertSent(fn ($request) => $request->method() === 'PATCH'
            && str_contains($request->url(), '/messages/outlook-draft-1')
            && ($request['subject'] ?? null) === 'Hello again');
    }

    public function test_sending_reuses_the_outlook_draft_instead_of_creating_another(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/v1.0/me/messages' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1' => Http::response(['id' => 'outlook-draft-1']),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1/attachments' => Http::response(['value' => []]),
            'graph.microsoft.com/v1.0/me/messages/outlook-draft-1/send' => Http::response(null, 202),
        ]);

        $uuid = $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'to' => [['email' => 'dana@example.com']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Ready</p>',
            ])
            ->json('draft.id');

        $this->actingAs($user)
            ->postJson('/portal/mail/send', [
                'to' => [['email' => 'dana@example.com']],
                'subject' => 'Hello',
                'bodyHtml' => '<p>Ready</p>',
                'draftId' => $uuid,
            ])
            ->assertOk()
            ->assertJsonPath('sent', true);

        $creates = collect(Http::recorded())->filter(function ($pair) {
            $request = $pair[0];

            return $request->method() === 'POST'
                && preg_match('#/me/messages$#', parse_url($request->url(), PHP_URL_PATH) ?: '');
        });
        $this->assertCount(1, $creates, 'Send must reuse the Outlook draft created on autosave.');

        Http::assertSent(fn ($request) => $request->method() === 'POST'
            && str_ends_with(parse_url($request->url(), PHP_URL_PATH) ?: '', '/messages/outlook-draft-1/send'));

        $this->assertDatabaseMissing('mail_drafts', ['uuid' => $uuid]);
        $this->assertTrue(
            MailCorrespondent::query()
                ->where('user_id', $user->id)
                ->where('email', 'dana@example.com')
                ->exists()
        );
    }

    public function test_a_local_draft_is_kept_when_outlook_is_unreachable(): void
    {
        $user = $this->user();
        $this->microsoftAccount($user);

        Queue::fake([SyncMailbox::class]);

        Http::fake([
            'login.microsoftonline.com/*' => Http::response([
                'access_token' => 'access-token',
                'expires_in' => 3600,
            ]),
            'graph.microsoft.com/*' => Http::response(['error' => ['message' => 'boom']], 500),
        ]);

        $this->actingAs($user)
            ->postJson('/portal/mail/drafts', [
                'subject' => 'Offline',
                'bodyHtml' => '<p>Still here</p>',
            ])
            ->assertOk();

        $this->assertDatabaseHas('mail_drafts', [
            'user_id' => $user->id,
            'subject' => 'Offline',
            'remote_id' => null,
        ]);
    }
}
