<?php

namespace Tests\Feature;

use App\Models\ConnectedAccount;
use App\Models\MailMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The conversation dropdown in the message list, and the flag-shaped views
 * the inbox category tabs switch between.
 *
 * The dropdown's whole contract is `threadCount`: the arrow only appears where
 * it is greater than one, so a wrong count is either an arrow that opens onto
 * nothing or a conversation with no way to see inside it.
 */
class MailConversationListTest extends TestCase
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

    public function test_list_rows_carry_the_size_of_their_conversation(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['thread_id' => 'big', 'sent_at' => now()->subHours(3)]);
        $this->message($user, $account, ['thread_id' => 'big', 'sent_at' => now()->subHours(2)]);
        $this->message($user, $account, ['thread_id' => 'big', 'sent_at' => now()->subHour()]);
        $this->message($user, $account, ['thread_id' => 'alone', 'sent_at' => now()]);

        $rows = collect($this->actingAs($user)->getJson('/portal/mail/messages')->json('messages'))
            ->keyBy('threadId');

        $this->assertSame(3, $rows['big']['threadCount']);
        // One message means no arrow — the client keys the dropdown off this.
        $this->assertSame(1, $rows['alone']['threadCount']);
    }

    public function test_a_conversation_is_one_row_carrying_its_newest_message(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'First', 'sent_at' => now()->subDays(2)]);
        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'Middle', 'sent_at' => now()->subDay()]);
        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'Latest', 'sent_at' => now()]);
        $this->message($user, $account, ['thread_id' => 'other', 'subject' => 'Unrelated', 'sent_at' => now()->subHours(5)]);

        $response = $this->actingAs($user)->getJson('/portal/mail/messages')->assertOk();

        $this->assertSame(['Latest', 'Unrelated'], collect($response->json('messages'))->pluck('subject')->all());
        // Paging counts conversations too, or "1–2 of 4" would be nonsense.
        $this->assertSame(2, $response->json('total'));
    }

    public function test_messages_with_no_thread_id_are_never_folded_together(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        // Some providers leave the thread id empty on single-message
        // conversations. Grouping on an empty value would collapse all of
        // them into one row, which is how a mailbox loses mail.
        $this->message($user, $account, ['thread_id' => null, 'subject' => 'Loose one', 'sent_at' => now()->subHour()]);
        $this->message($user, $account, ['thread_id' => null, 'subject' => 'Loose two', 'sent_at' => now()]);

        $subjects = collect($this->actingAs($user)->getJson('/portal/mail/messages')->json('messages'))
            ->pluck('subject')->all();

        $this->assertSame(['Loose two', 'Loose one'], $subjects);
    }

    public function test_turning_conversation_view_off_lists_every_message(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'First', 'sent_at' => now()->subDay()]);
        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'Latest', 'sent_at' => now()]);

        $user->forceFill(['preferences' => ['mail' => ['conversationView' => false]]])->save();

        $subjects = collect($this->actingAs($user)->getJson('/portal/mail/messages')->json('messages'))
            ->pluck('subject')->all();

        $this->assertSame(['Latest', 'First'], $subjects);
    }

    public function test_grouping_keeps_the_newest_message_that_is_in_this_folder(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['thread_id' => 'conv', 'subject' => 'Received', 'sent_at' => now()->subDay()]);
        // The reply is the newest in the thread but lives in Sent. The inbox
        // must still show the conversation, headed by what was received.
        $this->message($user, $account, [
            'thread_id' => 'conv', 'subject' => 'My reply', 'folder' => 'sent', 'sent_at' => now(),
        ]);

        $inbox = collect($this->actingAs($user)->getJson('/portal/mail/messages?folder=inbox')->json('messages'));

        $this->assertSame(['Received'], $inbox->pluck('subject')->all());
        // The arrow still promises both, because expanding shows the whole
        // conversation rather than only this folder's part of it.
        $this->assertSame(2, $inbox->first()['threadCount']);
    }

    public function test_drafts_do_not_inflate_a_conversations_count(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['thread_id' => 'reply-draft']);
        $this->message($user, $account, ['thread_id' => 'reply-draft', 'folder' => 'draft']);

        $rows = $this->actingAs($user)->getJson('/portal/mail/messages')->json('messages');

        $this->assertSame(1, $rows[0]['threadCount']);
    }

    public function test_the_conversation_endpoint_returns_the_whole_thread_newest_first(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $oldest = $this->message($user, $account, ['sent_at' => now()->subHours(3), 'subject' => 'First']);
        $this->message($user, $account, ['sent_at' => now()->subHours(2), 'subject' => 'Second']);
        $newest = $this->message($user, $account, ['sent_at' => now()->subHour(), 'subject' => 'Third']);

        $response = $this->actingAs($user)
            ->getJson('/portal/mail/messages/'.$newest->uuid.'/conversation')
            ->assertOk();

        $subjects = collect($response->json('messages'))->pluck('subject')->all();

        $this->assertSame(['Third', 'Second', 'First'], $subjects);
        $this->assertSame($oldest->thread_id, $response->json('threadId'));
    }

    public function test_the_conversation_endpoint_never_reaches_the_provider(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        // No body stored at all: `thread` would hydrate this from Gmail, which
        // is exactly what expanding a row in the list must not do. Http is not
        // faked here, so any outbound call fails the test loudly.
        $message = $this->message($user, $account, ['body_text' => null, 'body_html' => null]);

        $this->actingAs($user)
            ->getJson('/portal/mail/messages/'.$message->uuid.'/conversation')
            ->assertOk()
            ->assertJsonPath('messages.0.id', $message->uuid);
    }

    public function test_another_users_conversation_is_not_readable(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $intruder = $this->user();

        $this->actingAs($intruder)
            ->getJson('/portal/mail/messages/'.$message->uuid.'/conversation')
            ->assertNotFound();
    }

    public function test_starred_and_pinned_are_listable_views_with_their_own_counts(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, ['subject' => 'Plain']);
        $this->message($user, $account, ['subject' => 'Starred', 'is_starred' => true]);
        $this->message($user, $account, ['subject' => 'Pinned', 'is_pinned' => true]);
        // Junk stays out of the flag views the way it stays out of Important.
        $this->message($user, $account, [
            'subject' => 'Starred junk', 'is_starred' => true, 'folder' => 'spam',
        ]);

        $starred = $this->actingAs($user)->getJson('/portal/mail/messages?folder=starred')->assertOk();
        $this->assertSame(['Starred'], collect($starred->json('messages'))->pluck('subject')->all());

        $pinned = $this->actingAs($user)->getJson('/portal/mail/messages?folder=pinned')->assertOk();
        $this->assertSame(['Pinned'], collect($pinned->json('messages'))->pluck('subject')->all());

        $folders = $this->actingAs($user)->getJson('/portal/mail')->json('folders');
        $this->assertSame(1, $folders['starred']['total']);
        $this->assertSame(1, $folders['pinned']['total']);
    }

    public function test_the_bootstrap_carries_the_readers_mail_preferences(): void
    {
        $user = $this->user();
        $this->account($user);

        $preferences = $this->actingAs($user)->getJson('/portal/mail')->json('preferences');

        // Split and a hidden sidebar are the defaults the first paint relies on.
        $this->assertSame('split', $preferences['layout']);
        $this->assertSame('hidden', $preferences['sidebarMode']);
        $this->assertSame(['important', 'starred', 'pinned'], $preferences['inboxCategories']);
    }

    public function test_saving_one_preference_leaves_the_others_alone(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', ['preferences' => ['sidebarMode' => 'icons']])
            ->assertOk();

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', ['preferences' => ['layout' => 'single']])
            ->assertOk()
            // Normalising the payload on its own filled every absent key with
            // its default, so the second save used to undo the first.
            ->assertJsonPath('preferences.sidebarMode', 'icons')
            ->assertJsonPath('preferences.layout', 'single');
    }

    public function test_a_nonsense_sidebar_mode_is_rejected(): void
    {
        $user = $this->user();
        $this->account($user);

        $this->actingAs($user)
            ->putJson('/portal/mail/settings', ['preferences' => ['sidebarMode' => 'sideways']])
            ->assertStatus(422);
    }

    public function test_a_conversation_opens_in_its_own_window_without_the_portal_shell(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $message = $this->message($user, $account, [
            'subject' => 'Quarterly review',
            'body_html' => '<p>The numbers are attached.</p>',
            'to' => [['name' => 'Test User', 'email' => 'user@example.com']],
            'cc' => [['name' => 'Sam Cole', 'email' => 'sam@example.com']],
        ]);

        $response = $this->actingAs($user)
            ->get('/portal/mail/window/'.$message->uuid)
            ->assertOk();

        // Server-rendered: the mail is in the first response, which is the
        // whole point of the window.
        $response->assertSee('Quarterly review');
        $response->assertSee('sam@example.com');
        $response->assertSee('The numbers are attached.', escape: false);

        // Same reading-pane chrome as the inbox, not the portal shell and not
        // a separate gray-card layout.
        $response->assertSee('tma-dash__email-detail', false);
        $response->assertSee('tma-dash__email-message-head-name', false);
        $response->assertSee('tma-dash__email-thread-btn', false);
        $response->assertSee('to Test User', false);
        $response->assertSee('/email/compose?message='.$message->uuid.'&amp;mode=reply"', false);
        $response->assertSee('/email/compose?message='.$message->uuid.'&amp;mode=reply-all"', false);
        $response->assertSee('/email/compose?message='.$message->uuid.'&amp;mode=forward"', false);
        $response->assertSee('data-compose-to="Dana Reed &lt;dana@example.com&gt;"', false);
        $response->assertSee('data-compose-subject="Re: Quarterly review"', false);
        $response->assertSee('data-compose-cc="Sam Cole &lt;sam@example.com&gt;"', false);
        $response->assertDontSee('compose=reply', false);
        $response->assertDontSee('tma-dash__sidebar', false);
        $response->assertDontSee('mw__bar', false);
        $response->assertDontSee('mw__msg', false);
    }

    public function test_a_conversation_window_shows_only_the_opened_message(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $this->message($user, $account, [
            'subject' => 'First',
            'body_html' => '<p>oldest body</p>',
            'sent_at' => now()->subHours(2),
        ]);
        $opened = $this->message($user, $account, [
            'subject' => 'Middle reply',
            'body_html' => '<p>just this reply</p>',
            'sent_at' => now()->subHour(),
        ]);
        $this->message($user, $account, [
            'subject' => 'Latest',
            'body_html' => '<p>newest body</p>',
            'sent_at' => now(),
        ]);

        $response = $this->actingAs($user)
            ->get('/portal/mail/window/'.$opened->uuid)
            ->assertOk();

        $response->assertSee('just this reply', escape: false);
        $response->assertDontSee('oldest body', false);
        $response->assertDontSee('newest body', false);
    }

    public function test_window_reply_all_includes_every_other_recipient(): void
    {
        $user = $this->user();
        $account = $this->account($user);

        $message = $this->message($user, $account, [
            'subject' => 'Kickoff',
            'from_name' => 'Dana Reed',
            'from_email' => 'dana@example.com',
            'to' => [
                ['name' => 'Test User', 'email' => 'user@example.com'],
                ['name' => 'Pat Lee', 'email' => 'pat@example.com'],
            ],
            'cc' => [['name' => 'Sam Cole', 'email' => 'sam@example.com']],
        ]);

        $response = $this->actingAs($user)
            ->get('/portal/mail/window/'.$message->uuid)
            ->assertOk();

        $response->assertSee('data-compose-to="Dana Reed &lt;dana@example.com&gt;, Pat Lee &lt;pat@example.com&gt;"', false);
        $response->assertSee('data-compose-cc="Sam Cole &lt;sam@example.com&gt;"', false);
        $response->assertSee('mode=reply-all', false);
    }

    public function test_another_users_message_has_no_window(): void
    {
        $user = $this->user();
        $account = $this->account($user);
        $message = $this->message($user, $account);

        $this->actingAs($this->user())
            ->get('/portal/mail/window/'.$message->uuid)
            ->assertNotFound();
    }
}
