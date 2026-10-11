<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\Notification;
use App\Models\ScheduledMessage;
use App\Models\User;
use App\Support\Messaging\ClientConversations;
use App\Support\Messaging\ScheduledMessages;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Announcements in a group, written for now or for later, and answering a
 * group message privately.
 */
class MessagingAnnouncementsTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name, string $email): User
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

    /** The first member runs the group. */
    private function group(User ...$members): Conversation
    {
        $c = Conversation::create([
            'type' => Conversation::TYPE_GROUP,
            'name' => 'Tax team',
            'created_by' => $members[0]->id,
            'last_message_at' => now(),
        ]);

        foreach ($members as $i => $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $u->id,
                'role' => $i === 0 ? ConversationParticipant::ROLE_ADMIN : ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    private function row(User $viewer, Conversation $c): array
    {
        return collect($this->actingAs($viewer)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('id', $c->uuid);
    }

    private function thread(User $viewer, Conversation $c): array
    {
        return $this->actingAs($viewer)
            ->getJson("/portal/messaging/conversations/{$c->uuid}/messages")
            ->assertOk()
            ->json('messages');
    }

    // ------------------------------------------------------- announcements

    public function test_a_group_admin_posts_an_announcement_and_the_whole_group_is_told(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group($ada, $rita, $omar);

        $sent = $this->actingAs($ada)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", [
                'body' => 'The office is closed on Friday.',
                'announcement' => true,
            ])
            ->assertOk()
            ->json('message');

        $this->assertTrue($sent['announcement']);

        // Everyone hears it as addressed to them, in its own words.
        foreach ([$rita, $omar] as $member) {
            $notice = Notification::query()->where('user_id', $member->id)->sole();
            $this->assertSame('message.mention', $notice->type);
            $this->assertSame('Ada Lovelace announced: The office is closed on Friday.', $notice->message);
        }
        $this->assertSame(0, Notification::query()->where('user_id', $ada->id)->count());

        $this->assertTrue($this->thread($rita, $c)[0]['announcement']);
        $this->assertSame('Announcement: The office is closed on Friday.', $this->row($rita, $c)['preview']);
    }

    public function test_a_member_cannot_post_an_announcement(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group($ada, $rita);

        $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", [
                'body' => 'Not mine to announce.',
                'announcement' => true,
            ])
            ->assertForbidden();

        $this->assertSame(0, Message::query()->count());

        // An ordinary message from the same person is still an ordinary message.
        $plain = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Just saying.'])
            ->assertOk()
            ->json('message');

        $this->assertFalse($plain['announcement']);
    }

    // ---------------------------------------------------------- scheduling

    public function test_an_announcement_is_scheduled_listed_and_posted_when_its_time_comes(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group($ada, $rita);

        $when = now()->addHours(3)->startOfMinute();

        $scheduled = $this->actingAs($ada)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/scheduled", [
                'body' => 'Payroll closes at noon.',
                'sendAt' => $when->toIso8601String(),
            ])
            ->assertCreated()
            ->json('scheduled');

        $this->assertTrue($scheduled['announcement']);
        $this->assertSame($when->toIso8601String(), $scheduled['sendAt']);

        // Waiting: its admins see it, the thread does not have it.
        $this->assertCount(1, $this->actingAs($ada)->getJson("/portal/messaging/conversations/{$c->uuid}/scheduled")->json('scheduled'));
        $this->assertSame([], $this->actingAs($rita)->getJson("/portal/messaging/conversations/{$c->uuid}/scheduled")->json('scheduled'));
        $this->assertSame([], $this->thread($rita, $c));

        // Not before its time.
        $this->artisan('messaging:send-scheduled')->assertSuccessful();
        $this->assertSame(0, Message::query()->count());

        $this->travelTo($when->copy()->addSeconds(20));
        $this->artisan('messaging:send-scheduled')->assertSuccessful();

        $posted = $this->thread($rita, $c);
        $this->assertCount(1, $posted);
        $this->assertSame('Payroll closes at noon.', $posted[0]['body']);
        $this->assertTrue($posted[0]['announcement']);
        $this->assertSame('Ada Lovelace', $posted[0]['sender']['name']);
        $this->assertSame('message.mention', Notification::query()->where('user_id', $rita->id)->sole()->type);

        // Once. A second pass, or two runs that both saw it due, post nothing more.
        $this->artisan('messaging:send-scheduled')->assertSuccessful();
        $this->assertNull(ScheduledMessages::deliver(ScheduledMessage::query()->sole()->id));
        $this->assertSame(1, Message::query()->count());

        $this->assertSame([], $this->actingAs($ada)->getJson("/portal/messaging/conversations/{$c->uuid}/scheduled")->json('scheduled'));
    }

    public function test_scheduling_is_the_admins_alone_and_wants_a_time_ahead(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $zoe = $this->user('Zoe Outsider', 'zoe@example.com');
        $c = $this->group($ada, $rita);
        $url = "/portal/messaging/conversations/{$c->uuid}/scheduled";

        $this->actingAs($rita)
            ->postJson($url, ['body' => 'Hello', 'sendAt' => now()->addHour()->toIso8601String()])
            ->assertForbidden();

        // Not in the group at all: the conversation is not confirmed to exist.
        $this->actingAs($zoe)
            ->postJson($url, ['body' => 'Hello', 'sendAt' => now()->addHour()->toIso8601String()])
            ->assertNotFound();

        $this->actingAs($ada)
            ->postJson($url, ['body' => 'Hello', 'sendAt' => now()->subMinute()->toIso8601String()])
            ->assertJsonValidationErrors('sendAt');

        $this->actingAs($ada)
            ->postJson($url, ['body' => 'Hello', 'sendAt' => now()->addYears(2)->toIso8601String()])
            ->assertJsonValidationErrors('sendAt');

        $this->actingAs($ada)
            ->postJson($url, ['body' => '   ', 'sendAt' => now()->addHour()->toIso8601String()])
            ->assertJsonValidationErrors('body');

        $this->assertSame(0, ScheduledMessage::query()->count());
    }

    public function test_a_scheduled_announcement_can_be_withdrawn_before_it_goes_out(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group($ada, $rita);

        $id = $this->actingAs($ada)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/scheduled", [
                'body' => 'Change of plan.',
                'sendAt' => now()->addHour()->toIso8601String(),
            ])
            ->json('scheduled.id');

        $this->actingAs($rita)->deleteJson("/portal/messaging/scheduled/{$id}")->assertForbidden();
        $this->actingAs($ada)->deleteJson("/portal/messaging/scheduled/{$id}")->assertOk();

        $this->travel(2)->hours();
        $this->artisan('messaging:send-scheduled')->assertSuccessful();

        $this->assertSame(0, Message::query()->count());
    }

    public function test_one_whose_author_lost_the_right_is_not_posted_and_says_why(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group($ada, $rita);

        $this->actingAs($ada)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/scheduled", [
                'body' => 'I will not be an admin by then.',
                'sendAt' => now()->addHour()->toIso8601String(),
            ])
            ->assertCreated();

        // Rita takes over the group and Ada steps down before it is due.
        ConversationParticipant::query()->where('user_id', $rita->id)->update(['role' => ConversationParticipant::ROLE_ADMIN]);
        ConversationParticipant::query()->where('user_id', $ada->id)->update(['role' => ConversationParticipant::ROLE_MEMBER]);

        $this->travel(2)->hours();
        $this->artisan('messaging:send-scheduled')->assertSuccessful();

        $this->assertSame(0, Message::query()->count());

        $listed = $this->actingAs($rita)->getJson("/portal/messaging/conversations/{$c->uuid}/scheduled")->json('scheduled');
        $this->assertCount(1, $listed);
        $this->assertTrue($listed[0]['failed']);
        $this->assertSame('Its author can no longer post announcements here.', $listed[0]['failedReason']);

        // And it is not tried again every minute after that.
        $this->artisan('messaging:send-scheduled')->assertSuccessful();
        $this->assertSame(0, Message::query()->count());
    }

    // ------------------------------------------------------ private reply

    public function test_a_group_message_can_be_answered_privately_to_its_author(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group($ada, $rita, $omar);

        $said = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'I am not able to make it.'])
            ->json('message');

        $direct = ClientConversations::resolveDirect($omar, $rita);

        $reply = $this->actingAs($omar)
            ->postJson("/portal/messaging/conversations/{$direct->uuid}/messages", [
                'body' => 'Is everything all right?',
                'replyTo' => $said['id'],
            ])
            ->assertOk()
            ->json('message');

        $this->assertSame($said['id'], $reply['replyTo']['id']);
        $this->assertSame('Rita Officer', $reply['replyTo']['senderName']);
        $this->assertSame(['id' => $c->uuid, 'name' => 'Tax team'], $reply['replyTo']['from']);

        // Rita reads it the same way, and nobody else in the group can.
        $forRita = $this->thread($rita, $direct);
        $this->assertSame('Tax team', $forRita[0]['replyTo']['from']['name']);
        $this->actingAs($ada)->getJson("/portal/messaging/conversations/{$direct->uuid}/messages")->assertNotFound();

        // A reply inside the group itself names no other conversation.
        $inGroup = $this->actingAs($omar)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Noted.', 'replyTo' => $said['id']])
            ->json('message');
        $this->assertNull($inGroup['replyTo']['from']);
    }

    public function test_a_private_reply_cannot_quote_what_its_sender_or_its_reader_could_not_see(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $zoe = $this->user('Zoe Outsider', 'zoe@example.com');
        $c = $this->group($ada, $rita, $omar);

        $said = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'For the team only.'])
            ->json('message');

        // Zoe is not in the group: knowing a message's id quotes nothing.
        $outside = ClientConversations::resolveDirect($zoe, $rita);
        $this->assertNull(
            $this->actingAs($zoe)
                ->postJson("/portal/messaging/conversations/{$outside->uuid}/messages", ['body' => 'Hello', 'replyTo' => $said['id']])
                ->assertOk()
                ->json('message.replyTo')
        );

        // Omar is in the group, but Ada did not write it: quoting Rita to Ada
        // privately would be passing it on, which is what Forward is for.
        $elsewhere = ClientConversations::resolveDirect($omar, $ada);
        $this->assertNull(
            $this->actingAs($omar)
                ->postJson("/portal/messaging/conversations/{$elsewhere->uuid}/messages", ['body' => 'Hello', 'replyTo' => $said['id']])
                ->assertOk()
                ->json('message.replyTo')
        );
    }
}
