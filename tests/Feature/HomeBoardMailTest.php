<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The home Recent Email tile follows the mailbox: one row per conversation,
 * so a pin on a thread is one pin, not one pin per reply.
 */
class HomeBoardMailTest extends TestCase
{
    use RefreshDatabase;

    public function test_pinned_thread_is_one_row_on_the_home_tile(): void
    {
        $user = User::factory()->create([
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);

        $account = ConnectedAccount::create([
            'user_id' => $user->id,
            'provider' => 'google',
            'provider_id' => 'g-'.$user->id,
            'email' => 'user@example.com',
            'name' => 'Test User',
            'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'],
            'sync_email' => true,
        ]);

        $this->message($user, $account, [
            'thread_id' => 'portal',
            'subject' => 'Re: New Portal',
            'from_name' => 'Maggie Williams',
            'sent_at' => now()->subDays(3),
            'is_pinned' => true,
        ]);
        $this->message($user, $account, [
            'thread_id' => 'portal',
            'subject' => 'Re: New Portal',
            'from_name' => 'Cindy Emmanuel',
            'sent_at' => now()->subDay(),
            'is_pinned' => true,
        ]);
        $this->message($user, $account, [
            'thread_id' => 'portal',
            'subject' => 'Re: New Portal',
            'from_name' => 'Kryshna Monrose',
            'sent_at' => now(),
            'is_pinned' => true,
        ]);
        $this->message($user, $account, [
            'thread_id' => 'webinar',
            'subject' => 'Invitation',
            'from_name' => 'Cindy Emmanuel',
            'sent_at' => now()->subDays(2),
            'is_pinned' => true,
        ]);
        $this->message($user, $account, [
            'thread_id' => 'other',
            'subject' => 'Unpinned',
            'sent_at' => now()->subHours(2),
            'is_pinned' => false,
        ]);

        $messages = collect($this->actingAs($user)
            ->getJson('/portal/dashboard/home?parts=mail')
            ->assertOk()
            ->json('mail.messages'));

        $pinned = $messages->where('pinned', true)->values();

        $this->assertCount(2, $pinned);
        $this->assertSame(['Kryshna Monrose', 'Cindy Emmanuel'], $pinned->pluck('sender')->all());
        $this->assertSame(1, $messages->where('threadId', 'portal')->count());
    }

    private function message(User $user, ConnectedAccount $account, array $overrides = []): MailMessage
    {
        return MailMessage::create(array_merge([
            'uuid' => (string) Str::uuid(),
            'user_id' => $user->id,
            'connected_account_id' => $account->id,
            'remote_id' => 'gmail-'.Str::random(8),
            'thread_id' => 'thread-1',
            'folder' => 'inbox',
            'subject' => 'Quarterly review',
            'snippet' => 'snippet',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'body_text' => 'cached body',
            'is_read' => true,
            'sent_at' => now()->subHour(),
        ], $overrides));
    }
}
