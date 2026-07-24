<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Pinning (a portal-only flag that floats messages to the top of a folder)
 * and the virtual Important view (important mail across folders, minus
 * trash / spam / drafts).
 */
class MailPinImportantTest extends TestCase
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

    private function account(User $user): ConnectedAccount
    {
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

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(6),
            'thread_id' => 'thread-'.Str::random(4),
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'is_read' => false,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }

    public function test_pinning_is_local_only_and_never_calls_the_provider(): void
    {
        Http::fake();

        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['pinned' => true])
            ->assertOk()
            ->assertJsonPath('message.pinned', true);

        $this->assertTrue($message->fresh()->is_pinned);
        Http::assertNothingSent();

        $this->actingAs($user)
            ->patchJson('/portal/mail/messages/'.$message->uuid, ['pinned' => false])
            ->assertOk()
            ->assertJsonPath('message.pinned', false);

        $this->assertFalse($message->fresh()->is_pinned);
    }

    public function test_pinned_messages_sort_above_newer_unpinned_ones(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $old = $this->message($user, $account, ['subject' => 'Old but pinned', 'sent_at' => now()->subDays(5), 'is_pinned' => true]);
        $new = $this->message($user, $account, ['subject' => 'Fresh', 'sent_at' => now()->subMinute()]);
        $mid = $this->message($user, $account, ['subject' => 'Middle', 'sent_at' => now()->subDay()]);

        $rows = $this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=inbox')
            ->assertOk()
            ->json('messages');

        $this->assertSame(
            [$old->uuid, $new->uuid, $mid->uuid],
            array_column($rows, 'id')
        );
        $this->assertTrue($rows[0]['pinned']);
    }

    public function test_the_important_view_spans_folders_but_skips_trash_spam_and_drafts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $inbox = $this->message($user, $account, ['subject' => 'Important inbox', 'is_important' => true]);
        $archived = $this->message($user, $account, ['subject' => 'Important archive', 'folder' => 'archive', 'is_important' => true, 'sent_at' => now()->subDay()]);
        $this->message($user, $account, ['subject' => 'Important trash', 'folder' => 'trash', 'is_important' => true]);
        $this->message($user, $account, ['subject' => 'Important spam', 'folder' => 'spam', 'is_important' => true]);
        $this->message($user, $account, ['subject' => 'Important draft', 'folder' => 'draft', 'is_important' => true]);
        $this->message($user, $account, ['subject' => 'Plain inbox']);

        $rows = $this->actingAs($user)
            ->getJson('/portal/mail/messages?folder=important')
            ->assertOk()
            ->json('messages');

        $this->assertSame(
            [$inbox->uuid, $archived->uuid],
            array_column($rows, 'id')
        );
    }

    public function test_folder_counts_include_the_important_view(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['is_important' => true]);
        $this->message($user, $account, ['folder' => 'archive', 'is_important' => true, 'is_read' => true]);
        $this->message($user, $account, ['folder' => 'trash', 'is_important' => true]);
        $target = $this->message($user, $account, []);

        // Any endpoint returning folder counts works; move() is convenient.
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'access-token', 'expires_in' => 3600]),
            'gmail.googleapis.com/*' => Http::response(['id' => $target->remote_id]),
        ]);

        $folders = $this->actingAs($user)
            ->postJson('/portal/mail/messages/'.$target->uuid.'/move', ['folder' => 'archive'])
            ->assertOk()
            ->json('folders');

        $this->assertSame(2, $folders['important']['total']);
        $this->assertSame(1, $folders['important']['unread']);
    }

    public function test_bulk_pin_and_unpin_apply_without_touching_the_provider(): void
    {
        Http::fake();

        $user = $this->user();
        $account = $this->account($user);

        $a = $this->message($user, $account);
        $b = $this->message($user, $account);

        $this->actingAs($user)
            ->postJson('/portal/mail/bulk', ['ids' => [$a->uuid, $b->uuid], 'action' => 'pin'])
            ->assertOk()
            ->assertJsonPath('applied', 2)
            ->assertJsonPath('failed', 0);

        $this->assertTrue($a->fresh()->is_pinned);
        $this->assertTrue($b->fresh()->is_pinned);
        Http::assertNothingSent();

        $this->actingAs($user)
            ->postJson('/portal/mail/bulk', ['ids' => [$a->uuid], 'action' => 'unpin'])
            ->assertOk();

        $this->assertFalse($a->fresh()->is_pinned);
        $this->assertTrue($b->fresh()->is_pinned);
    }
}
