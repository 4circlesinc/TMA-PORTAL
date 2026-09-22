<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The photos under a chat bubble: who has seen the message, and when.
 */
class ReadReceiptTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email, string $name): User
    {
        return User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @param  array<int, User>  $members */
    private function conversation(array $members): Conversation
    {
        $conversation = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);

        foreach ($members as $member) {
            ConversationParticipant::create([
                'conversation_id' => $conversation->id,
                'user_id' => $member->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $conversation;
    }

    public function test_a_reader_shows_on_each_message_at_the_time_they_first_saw_it(): void
    {
        $sender = $this->user('sender@example.com', 'Ada Sender');
        $recipient = $this->user('recipient@example.com', 'Gil Reader');
        $conversation = $this->conversation([$sender, $recipient]);
        $send = "/portal/messaging/conversations/{$conversation->uuid}/messages";
        $read = "/portal/messaging/conversations/{$conversation->uuid}/read";

        Carbon::setTestNow(Carbon::parse('2026-09-22 12:00:00'));
        $this->actingAs($sender)->postJson($send, ['body' => 'The return is filed'])->assertOk();
        $this->actingAs($recipient)->postJson($read)->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-22 15:00:00'));
        $this->actingAs($sender)->postJson($send, ['body' => 'Any questions?'])->assertOk();
        $this->actingAs($recipient)->postJson($read)->assertOk();

        $messages = collect(
            $this->actingAs($sender)->getJson($send)->assertOk()->json('messages')
        );

        $first = $messages->firstWhere('body', 'The return is filed');
        $this->assertSame($recipient->id, $first['seenBy'][0]['id']);
        $this->assertSame('Gil Reader', $first['seenBy'][0]['name']);
        $this->assertArrayHasKey('avatar', $first['seenBy'][0]);
        $this->assertTrue(
            Carbon::parse($first['seenBy'][0]['seenAt'])->equalTo(Carbon::parse('2026-09-22 12:00:00'))
        );

        $second = $messages->firstWhere('body', 'Any questions?');
        $this->assertTrue(
            Carbon::parse($second['seenBy'][0]['seenAt'])->equalTo(Carbon::parse('2026-09-22 15:00:00'))
        );

        $asReader = collect(
            $this->actingAs($recipient)->getJson($send)->assertOk()->json('messages')
        );
        $this->assertSame([], $asReader->firstWhere('body', 'The return is filed')['seenBy']);

        Carbon::setTestNow();
    }

    public function test_someone_who_hides_read_receipts_is_not_shown(): void
    {
        $sender = $this->user('sender@example.com', 'Ada Sender');
        $recipient = $this->user('recipient@example.com', 'Gil Reader');
        $recipient->forceFill([
            'preferences' => ['messaging' => ['readReceipts' => false]],
        ])->save();

        $conversation = $this->conversation([$sender, $recipient]);
        $send = "/portal/messaging/conversations/{$conversation->uuid}/messages";

        $this->actingAs($sender)->postJson($send, ['body' => 'The return is filed'])->assertOk();
        $this->actingAs($recipient)
            ->postJson("/portal/messaging/conversations/{$conversation->uuid}/read")
            ->assertOk();

        $messages = $this->actingAs($sender)->getJson($send)->assertOk()->json('messages');

        $this->assertSame([], $messages[0]['seenBy']);
    }
}
