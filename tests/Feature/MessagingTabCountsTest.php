<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Models\UserWorkStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The badges on the Messages nav bar.
 *
 * Neither Calls nor Updates has a per-item read state — a missed call is not
 * "unread", and a colleague's status is not addressed to anyone — so both
 * counts are defined against a *seen* marker. These tests are mostly about
 * that marker: what advances it, and what it does and does not swallow.
 */
class MessagingTabCountsTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @param  array<int, User>  $members */
    private function conversation(array $members): Conversation
    {
        $c = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);
        foreach ($members as $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $u->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    private function callLine(Conversation $c, string $event, ?int $initiatorId): Message
    {
        return $c->messages()->create([
            'user_id' => null,
            'type' => Message::TYPE_SYSTEM,
            'system_event' => [
                'event' => $event,
                'label' => 'Voice call',
                'media' => 'audio',
                'answered' => $event === 'call_ended',
                'initiatorId' => $initiatorId,
            ],
        ]);
    }

    private function counts(User $user): array
    {
        return $this->actingAs($user)->getJson('/portal/messaging/tab-counts')->json('tabCounts');
    }

    public function test_a_call_someone_else_placed_and_i_missed_is_counted(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);

        $this->callLine($c, 'call_missed', $them->id);

        $this->assertSame(1, $this->counts($me)['calls']);
    }

    public function test_a_call_i_placed_that_nobody_answered_is_not_my_missed_call(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);

        // "No answer" in my own log — I watched it ring out.
        $this->callLine($c, 'call_missed', $me->id);

        $this->assertSame(0, $this->counts($me)['calls']);
        // It is a missed call for the person who did not pick up.
        $this->assertSame(1, $this->counts($them)['calls']);
    }

    public function test_an_answered_call_is_never_a_badge(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);

        $this->callLine($c, 'call_ended', $them->id);

        $this->assertSame(0, $this->counts($me)['calls']);
    }

    public function test_opening_the_calls_tab_clears_it_and_later_calls_count_again(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);

        $this->callLine($c, 'call_missed', $them->id);
        $this->callLine($c, 'call_missed', $them->id);
        $this->assertSame(2, $this->counts($me)['calls']);

        $this->actingAs($me)
            ->postJson('/portal/messaging/tab-counts/seen', ['tab' => 'calls'])
            ->assertOk()
            ->assertJsonPath('tabCounts.calls', 0);

        $this->callLine($c, 'call_missed', $them->id);
        $this->assertSame(1, $this->counts($me)['calls']);
    }

    public function test_a_missed_call_in_a_conversation_i_am_not_in_is_invisible(): void
    {
        $me = $this->user('me@example.com');
        $a = $this->user('a@example.com');
        $b = $this->user('b@example.com');
        $theirs = $this->conversation([$a, $b]);

        $this->callLine($theirs, 'call_missed', $a->id);

        $this->assertSame(0, $this->counts($me)['calls']);
    }

    public function test_updates_counts_colleagues_statuses_but_never_my_own(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');

        UserWorkStatus::create(['user_id' => $them->id, 'emoji' => '📊', 'text' => 'On the Acme audit']);
        UserWorkStatus::create(['user_id' => $me->id, 'emoji' => '☕', 'text' => 'Back at two']);

        $this->assertSame(1, $this->counts($me)['updates']);
    }

    public function test_opening_updates_clears_it_and_a_later_status_counts_again(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $other = $this->user('other@example.com');

        UserWorkStatus::create(['user_id' => $them->id, 'emoji' => '📊', 'text' => 'On the Acme audit']);
        $this->assertSame(1, $this->counts($me)['updates']);

        $this->actingAs($me)
            ->postJson('/portal/messaging/tab-counts/seen', ['tab' => 'updates'])
            ->assertOk()
            ->assertJsonPath('tabCounts.updates', 0);

        $this->travel(2)->minutes();
        UserWorkStatus::create(['user_id' => $other->id, 'emoji' => '🚗', 'text' => 'Travelling']);

        $this->assertSame(1, $this->counts($me)['updates']);
    }

    public function test_an_expired_status_is_not_new(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');

        UserWorkStatus::create([
            'user_id' => $them->id,
            'emoji' => '📊',
            'text' => 'Gone already',
            'expires_at' => now()->subMinute(),
        ]);

        $this->assertSame(0, $this->counts($me)['updates']);
    }

    public function test_the_conversation_list_carries_the_counts_so_the_bar_has_them_on_load(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);
        $this->callLine($c, 'call_missed', $them->id);
        UserWorkStatus::create(['user_id' => $them->id, 'emoji' => '📊', 'text' => 'On the audit']);

        $this->actingAs($me)->getJson('/portal/messaging/conversations')
            ->assertOk()
            ->assertJsonPath('tabCounts.calls', 1)
            ->assertJsonPath('tabCounts.updates', 1);
    }

    public function test_seen_refuses_a_tab_it_does_not_own(): void
    {
        $me = $this->user('me@example.com');

        // Chats is summed client-side from the visible rows; there is no marker
        // here to move, and pretending otherwise would create a second answer.
        $this->actingAs($me)
            ->postJson('/portal/messaging/tab-counts/seen', ['tab' => 'chats'])
            ->assertStatus(422);
    }

    public function test_one_users_marker_does_not_move_anothers(): void
    {
        $me = $this->user('me@example.com');
        $them = $this->user('them@example.com');
        $c = $this->conversation([$me, $them]);

        $this->callLine($c, 'call_missed', $them->id);
        $this->callLine($c, 'call_missed', $me->id);

        $this->actingAs($me)->postJson('/portal/messaging/tab-counts/seen', ['tab' => 'calls']);

        $this->assertSame(0, $this->counts($me)['calls']);
        $this->assertSame(1, $this->counts($them)['calls']);
    }
}
