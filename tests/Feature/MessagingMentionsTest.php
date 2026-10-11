<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\MessageMention;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * @Name and @all in a group conversation.
 *
 * The message's text is the record: whoever it names is mentioned, whether
 * the name was picked from the composer's list or typed out.
 */
class MessagingMentionsTest extends TestCase
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

    /** @param  array<int, User>  $members */
    private function group(array $members, string $type = Conversation::TYPE_GROUP): Conversation
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

    /** @return array<string, mixed> the message as the sender gets it back */
    private function say(User $sender, Conversation $c, string $body): array
    {
        return $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => $body])
            ->assertOk()
            ->json('message');
    }

    /** @return list<string> */
    private function typesFor(User $user): array
    {
        return Notification::query()->where('user_id', $user->id)->orderBy('id')->pluck('type')->all();
    }

    private function row(User $viewer, Conversation $c): array
    {
        return collect($this->actingAs($viewer)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('id', $c->uuid);
    }

    public function test_naming_a_member_mentions_them_and_only_them(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group([$ada, $rita, $omar]);

        $sent = $this->say($ada, $c, 'Can you file this today, @Rita Officer?');

        $this->assertSame([['id' => $rita->id, 'name' => 'Rita Officer']], $sent['mentions']);
        $this->assertFalse($sent['mentionsAll']);
        // The sender is not the one being addressed.
        $this->assertFalse($sent['mentionsMe']);

        $this->assertSame(['message.mention'], $this->typesFor($rita));
        $this->assertSame(['message.group'], $this->typesFor($omar));
        $this->assertSame([], $this->typesFor($ada));

        $note = Notification::where('user_id', $rita->id)->first();
        $this->assertSame('Tax team', $note->title);
        $this->assertSame('Ada Lovelace mentioned you: Can you file this today, @Rita Officer?', $note->message);
        $this->assertSame('/social/messages?conversation='.$c->uuid, $note->action_url);

        // What each of them sees in the thread and on the list.
        $forRita = $this->actingAs($rita)->getJson("/portal/messaging/conversations/{$c->uuid}/messages")->json('messages.0');
        $forOmar = $this->actingAs($omar)->getJson("/portal/messaging/conversations/{$c->uuid}/messages")->json('messages.0');

        $this->assertTrue($forRita['mentionsMe']);
        $this->assertFalse($forOmar['mentionsMe']);
        $this->assertSame('Rita Officer', $forOmar['mentions'][0]['name']);

        $this->assertTrue($this->row($rita, $c)['mentioned']);
        $this->assertFalse($this->row($omar, $c)['mentioned']);
        $this->assertFalse($this->row($ada, $c)['mentioned']);
    }

    public function test_at_all_addresses_everyone_but_the_sender(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group([$ada, $rita, $omar]);

        $sent = $this->say($ada, $c, '@all the office closes at noon on Friday');

        $this->assertTrue($sent['mentionsAll']);
        $this->assertSame([], $sent['mentions']);
        $this->assertFalse($sent['mentionsMe']);

        foreach ([$rita, $omar] as $colleague) {
            $this->assertSame(['message.mention'], $this->typesFor($colleague));
            $this->assertSame(
                'Ada Lovelace mentioned everyone: @all the office closes at noon on Friday',
                Notification::where('user_id', $colleague->id)->value('message')
            );
            $this->assertTrue($this->row($colleague, $c)['mentioned']);
        }

        $this->assertSame([], $this->typesFor($ada));
        $this->assertFalse($this->row($ada, $c)['mentioned']);
    }

    public function test_the_longest_name_wins_and_a_name_inside_a_word_is_not_a_mention(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $ann = $this->user('Ann', 'ann@example.com');
        $annMarie = $this->user('Ann Marie Joseph', 'annmarie@example.com');
        $allan = $this->user('Allan', 'allan@example.com');
        $c = $this->group([$ada, $ann, $annMarie, $allan]);

        $one = $this->say($ada, $c, 'Over to @Ann Marie Joseph for the figures.');
        $this->assertSame([$annMarie->id], array_column($one['mentions'], 'id'));

        // Typed by hand, in the wrong case, still finds her; the highlight
        // keeps the text as it was written.
        $two = $this->say($ada, $c, 'thanks @ann, and @ann marie joseph');
        $this->assertEqualsCanonicalizing([$ann->id, $annMarie->id], array_column($two['mentions'], 'id'));
        $this->assertContains('ann marie joseph', array_column($two['mentions'], 'name'));

        // An address, and a name that only starts with "all".
        $three = $this->say($ada, $c, 'Write to office@all.example or ask @Allan');
        $this->assertFalse($three['mentionsAll']);
        $this->assertSame([$allan->id], array_column($three['mentions'], 'id'));

        $four = $this->say($ada, $c, 'No one here: ann, @annabel, me@Ann');
        $this->assertSame([], $four['mentions']);
        $this->assertFalse($four['mentionsAll']);
    }

    public function test_only_members_can_be_mentioned_and_nobody_mentions_themselves(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $outsider = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group([$ada, $rita]);

        $sent = $this->say($ada, $c, '@Omar Officer and @Ada Lovelace should see this');

        $this->assertSame([], $sent['mentions']);
        $this->assertSame(0, MessageMention::count());
        $this->assertSame([], $this->typesFor($outsider));
        // Rita still hears there is a message; she was not addressed.
        $this->assertSame(['message.group'], $this->typesFor($rita));
    }

    public function test_a_direct_conversation_has_no_mentions(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group([$ada, $rita], Conversation::TYPE_DIRECT);

        $sent = $this->say($ada, $c, '@Rita Officer @all are you there');

        $this->assertSame([], $sent['mentions']);
        $this->assertFalse($sent['mentionsAll']);
        $this->assertSame(['message.received'], $this->typesFor($rita));

        $this->actingAs($ada)
            ->getJson("/portal/messaging/conversations/{$c->uuid}/mentionable")
            ->assertOk()
            ->assertExactJson(['people' => [], 'everyone' => null]);
    }

    public function test_being_named_reaches_a_muted_member_and_at_all_does_not(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group([$ada, $rita]);

        ConversationParticipant::where('conversation_id', $c->id)
            ->where('user_id', $rita->id)
            ->update(['muted_until' => now()->addDay()]);

        $this->say($ada, $c, 'Morning');
        $this->say($ada, $c, '@all lunch is here');
        $this->assertSame([], $this->typesFor($rita));

        $this->say($ada, $c, '@Rita Officer the client is waiting for you');
        $this->assertSame(['message.mention'], $this->typesFor($rita));
    }

    public function test_reading_the_conversation_settles_the_mention(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group([$ada, $rita]);

        $this->say($ada, $c, 'First');
        $this->say($ada, $c, '@Rita Officer second');

        // The ordinary row and the mention row are two things.
        $this->assertSame(['message.group', 'message.mention'], $this->typesFor($rita));
        $this->assertTrue($this->row($rita, $c)['mentioned']);

        $this->actingAs($rita)->postJson("/portal/messaging/conversations/{$c->uuid}/read")->assertOk();

        $this->assertFalse($this->row($rita, $c)['mentioned']);
        $this->assertSame(0, Notification::where('user_id', $rita->id)->whereNull('read_at')->count());

        // A later message that names nobody does not bring the mark back.
        $this->say($ada, $c, 'Third');
        $row = $this->row($rita, $c);
        $this->assertSame(1, $row['unread']);
        $this->assertFalse($row['mentioned']);
    }

    public function test_an_edit_tells_only_the_people_it_starts_naming(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $c = $this->group([$ada, $rita, $omar]);

        $sent = $this->say($ada, $c, '@Rita Officer please review');
        Notification::query()->delete();

        $edited = $this->actingAs($ada)
            ->patchJson("/portal/messaging/messages/{$sent['id']}", ['body' => '@Rita Officer and @Omar Officer please review'])
            ->assertOk()
            ->json('message');

        $this->assertEqualsCanonicalizing([$rita->id, $omar->id], array_column($edited['mentions'], 'id'));
        $this->assertSame([], $this->typesFor($rita));
        $this->assertSame(['message.mention'], $this->typesFor($omar));

        // Taking a name back out takes the mention with it.
        $again = $this->actingAs($ada)
            ->patchJson("/portal/messaging/messages/{$sent['id']}", ['body' => '@Omar Officer please review'])
            ->assertOk()
            ->json('message');

        $this->assertSame([$omar->id], array_column($again['mentions'], 'id'));
        $this->assertSame(1, MessageMention::count());
    }

    public function test_a_deleted_message_no_longer_marks_anyone(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $c = $this->group([$ada, $rita]);

        $this->say($ada, $c, 'Still here');
        $sent = $this->say($ada, $c, '@Rita Officer wrong chat, sorry');
        $this->assertTrue($this->row($rita, $c)['mentioned']);

        $this->actingAs($ada)->deleteJson("/portal/messaging/messages/{$sent['id']}")->assertOk();

        $this->assertSame(0, MessageMention::count());
        $this->assertFalse($this->row($rita, $c)['mentioned']);

        $deleted = collect($this->actingAs($rita)->getJson("/portal/messaging/conversations/{$c->uuid}/messages")->json('messages'))
            ->firstWhere('id', $sent['id']);
        $this->assertSame([], $deleted['mentions']);
        $this->assertFalse($deleted['mentionsMe']);
    }

    public function test_the_composer_is_given_the_other_members_and_a_stranger_is_given_nothing(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $stranger = $this->user('Sam Stranger', 'sam@example.com');
        $c = $this->group([$ada, $rita, $omar]);

        $this->actingAs($ada)
            ->getJson("/portal/messaging/conversations/{$c->uuid}/mentionable")
            ->assertOk()
            ->assertJsonPath('everyone', 'all')
            ->assertJsonPath('people.0.name', 'Omar Officer')
            ->assertJsonPath('people.1.name', 'Rita Officer')
            ->assertJsonCount(2, 'people');

        // Not a member: the conversation is not confirmed to exist.
        $this->actingAs($stranger)
            ->getJson("/portal/messaging/conversations/{$c->uuid}/mentionable")
            ->assertNotFound();

        // Someone who has left is no longer offered, or mentionable.
        ConversationParticipant::where('conversation_id', $c->id)
            ->where('user_id', $omar->id)
            ->update(['left_at' => now()]);

        $this->actingAs($ada)
            ->getJson("/portal/messaging/conversations/{$c->uuid}/mentionable")
            ->assertJsonCount(1, 'people');

        $sent = $this->say($ada, $c, '@Omar Officer are you still around?');
        $this->assertSame([], $sent['mentions']);
    }
}
