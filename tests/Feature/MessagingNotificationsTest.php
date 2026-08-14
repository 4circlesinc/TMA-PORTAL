<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Messages and missed calls reaching the notification system.
 *
 * The Messages page keeps its own unread badge, so everything here is about
 * the other case: the user is somewhere else in the portal, or signed out, and
 * the bell is the only thing that will tell them.
 */
class MessagingNotificationsTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Reviewing Officer',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @param  array<int, User>  $members */
    private function conversation(array $members, string $type = Conversation::TYPE_DIRECT): Conversation
    {
        $c = Conversation::create([
            'type' => $type,
            'name' => $type === Conversation::TYPE_GROUP ? 'Tax team' : null,
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

    private function notificationsFor(User $user): \Illuminate\Database\Eloquent\Collection
    {
        return Notification::query()->where('user_id', $user->id)->get();
    }

    public function test_a_sent_message_notifies_the_recipient_and_never_the_sender(): void
    {
        $sender = $this->user('sender@example.com');
        $recipient = $this->user('recipient@example.com');
        $c = $this->conversation([$sender, $recipient]);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'The return is filed'])
            ->assertOk();

        $this->assertCount(0, $this->notificationsFor($sender));

        $notifications = $this->notificationsFor($recipient);
        $this->assertCount(1, $notifications);
        $this->assertSame('message.received', $notifications[0]->type);
        $this->assertSame($sender->name, $notifications[0]->title);
        $this->assertSame('The return is filed', $notifications[0]->message);
        $this->assertSame('/social/messages?conversation='.$c->uuid, $notifications[0]->action_url);
        $this->assertNull($notifications[0]->read_at);
    }

    public function test_a_burst_of_messages_stays_one_notification(): void
    {
        $sender = $this->user('sender@example.com');
        $recipient = $this->user('recipient@example.com');
        $c = $this->conversation([$sender, $recipient]);

        foreach (['one', 'two', 'three'] as $body) {
            $this->actingAs($sender)
                ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => $body])
                ->assertOk();
        }

        $notifications = $this->notificationsFor($recipient);
        $this->assertCount(1, $notifications);
        // The row shows the newest message and counts what it stands for.
        $this->assertSame('three', $notifications[0]->message);
        $this->assertSame(3, $notifications[0]->metadata['count'] ?? null);
    }

    public function test_a_muted_conversation_raises_no_notification(): void
    {
        $sender = $this->user('sender@example.com');
        $recipient = $this->user('recipient@example.com');
        $c = $this->conversation([$sender, $recipient]);

        ConversationParticipant::where('conversation_id', $c->id)
            ->where('user_id', $recipient->id)
            ->update(['muted_until' => now()->addDay()]);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Quiet please'])
            ->assertOk();

        $this->assertCount(0, $this->notificationsFor($recipient));
    }

    public function test_a_group_message_is_titled_by_the_group(): void
    {
        $sender = $this->user('sender@example.com');
        $a = $this->user('a@example.com');
        $b = $this->user('b@example.com');
        $c = $this->conversation([$sender, $a, $b], Conversation::TYPE_GROUP);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Standup at 9'])
            ->assertOk();

        foreach ([$a, $b] as $member) {
            $notifications = $this->notificationsFor($member);
            $this->assertCount(1, $notifications);
            $this->assertSame('message.group', $notifications[0]->type);
            $this->assertSame('Tax team', $notifications[0]->title);
            $this->assertSame($sender->name.': Standup at 9', $notifications[0]->message);
        }
    }

    public function test_opening_the_conversation_marks_its_notifications_read(): void
    {
        $sender = $this->user('sender@example.com');
        $recipient = $this->user('recipient@example.com');
        $c = $this->conversation([$sender, $recipient]);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Ping'])
            ->assertOk();

        $this->actingAs($recipient)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/read")
            ->assertOk();

        $this->assertNotNull($this->notificationsFor($recipient)[0]->read_at);
        $this->actingAs($recipient)->getJson('/portal/notifications/count')->assertJsonPath('unread', 0);
    }

    public function test_a_missed_call_notifies_the_person_who_missed_it(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        // The caller gives up before it is answered.
        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", [
                'type' => 'hangup',
                'media' => 'audio',
                'initiatorId' => $caller->id,
                'answered' => false,
            ])->assertOk();

        $this->assertCount(0, $this->notificationsFor($caller));

        $notifications = $this->notificationsFor($callee);
        $this->assertCount(1, $notifications);
        $this->assertSame('call.missed', $notifications[0]->type);
        $this->assertSame('Missed voice call', $notifications[0]->title);
        $this->assertStringContainsString($caller->name, (string) $notifications[0]->message);
    }

    public function test_an_answered_call_notifies_nobody(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", [
                'type' => 'hangup',
                'media' => 'video',
                'initiatorId' => $caller->id,
                'answered' => true,
            ])->assertOk();

        $this->assertCount(0, $this->notificationsFor($callee));
        $this->assertCount(0, $this->notificationsFor($caller));
    }

    public function test_declining_a_call_notifies_neither_side(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        // The callee saw the call and chose to decline it — nobody needs telling.
        $this->actingAs($callee)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", [
                'type' => 'reject',
                'media' => 'audio',
                'initiatorId' => $caller->id,
            ])->assertOk();

        $this->assertCount(0, $this->notificationsFor($callee));
        $this->assertCount(0, $this->notificationsFor($caller));
    }
}
