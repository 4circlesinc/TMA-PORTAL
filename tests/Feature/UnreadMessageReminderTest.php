<?php

namespace Tests\Feature;

use App\Mail\Postcard;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Mail\Postcards;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Unread-message reminder subjects name who wrote, and which group, so a
 * reader can tell a group nudge from a direct one without opening it.
 */
class UnreadMessageReminderTest extends TestCase
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
    private function conversation(array $members, string $type, ?string $name = null): Conversation
    {
        $conversation = Conversation::create([
            'type' => $type,
            'name' => $name,
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

    private function leaveUnread(Conversation $conversation, User $sender, string $body = 'The return is ready.'): void
    {
        Message::create([
            'conversation_id' => $conversation->id,
            'user_id' => $sender->id,
            'type' => Message::TYPE_TEXT,
            'body' => $body,
        ])->forceFill(['created_at' => now()->subHours(2)])->save();
    }

    public function test_a_group_reminder_names_the_group_and_says_it_is_a_reminder(): void
    {
        Mail::fake();
        $sender = $this->user('dana@example.com', 'Dana Reed');
        $reader = $this->user('chen@example.com', 'Chen Wei');
        $other = $this->user('omar@example.com', 'Omar Shah');
        $conversation = $this->conversation(
            [$sender, $reader, $other],
            Conversation::TYPE_GROUP,
            'Tax team',
        );
        $this->leaveUnread($conversation, $sender);

        $this->artisan('messaging:send-unread-reminders')->assertSuccessful();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($reader) {
            return $mail->hasTo($reader->email)
                && $mail->subjectLine === 'Reminder: unread message from Dana Reed in Tax team'
                && ($mail->payload['title'] ?? null) === 'Unread message in Tax team';
        });
    }

    public function test_a_direct_reminder_names_the_sender(): void
    {
        Mail::fake();
        $sender = $this->user('dana@example.com', 'Dana Reed');
        $reader = $this->user('chen@example.com', 'Chen Wei');
        $conversation = $this->conversation([$sender, $reader], Conversation::TYPE_DIRECT);
        $this->leaveUnread($conversation, $sender);

        $this->artisan('messaging:send-unread-reminders')->assertSuccessful();

        Mail::assertQueued(Postcard::class, function (Postcard $mail) use ($reader) {
            return $mail->hasTo($reader->email)
                && $mail->subjectLine === 'Reminder: unread message from Dana Reed'
                && ($mail->payload['title'] ?? null) === 'Unread message from Dana Reed';
        });
    }

    public function test_later_reminders_keep_naming_the_group(): void
    {
        $this->assertSame(
            "Reminder: Dana Reed's message in Tax team is still unread",
            Postcards::messageReminder(2, 'Dana Reed', 'Hello', 'https://portal.test/messages', 'Tax team')->subjectLine,
        );
        $this->assertSame(
            'Final reminder: unread message from Dana Reed in Tax team',
            Postcards::messageReminder(3, 'Dana Reed', 'Hello', 'https://portal.test/messages', 'Tax team')->subjectLine,
        );
        $this->assertSame(
            "Reminder: Dana Reed's message is still unread",
            Postcards::messageReminder(2, 'Dana Reed', null, 'https://portal.test/messages')->subjectLine,
        );
        $this->assertSame(
            'Final reminder: unread message from Dana Reed',
            Postcards::messageReminder(3, 'Dana Reed', null, 'https://portal.test/messages')->subjectLine,
        );
    }
}
