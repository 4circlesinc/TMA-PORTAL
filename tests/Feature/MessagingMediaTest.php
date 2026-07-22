<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Models\UserBlock;
use App\Models\UserWorkStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The pooled media view: everything the user can see across every conversation.
 *
 * The interesting cases are all about what it must *not* show. A view that
 * gathers attachments from every thread at once is exactly where a leak would
 * hide, so membership, leaving, and per-thread clearing are each pinned here.
 */
class MessagingMediaTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email = 'a@example.com'): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** A direct conversation between two users, both active members. */
    private function conversation(User $a, User $b): Conversation
    {
        $c = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
            'created_by' => $a->id,
            'last_message_at' => now(),
        ]);

        foreach ([$a, $b] as $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $u->id,
                'role' => ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    private function attach(
        Conversation $c,
        User $sender,
        string $name,
        string $mime = 'image/png',
        bool $voice = false,
    ): MessageAttachment {
        $m = Message::create([
            'conversation_id' => $c->id,
            'user_id' => $sender->id,
            'type' => Message::TYPE_ATTACHMENT,
        ]);

        return MessageAttachment::create([
            'message_id' => $m->id,
            'conversation_id' => $c->id,
            'uploaded_by' => $sender->id,
            'disk' => 'local',
            'path' => 'messaging/'.$name,
            'name' => $name,
            'mime' => $mime,
            'size' => 1024,
            'is_voice' => $voice,
            'status' => MessageAttachment::STATUS_READY,
        ]);
    }

    public function test_it_pools_media_from_every_conversation_the_user_is_in(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $carol = $this->user('carol@example.com');

        $this->attach($this->conversation($me, $bob), $bob, 'from-bob.png');
        $this->attach($this->conversation($me, $carol), $carol, 'from-carol.png');

        $names = collect(
            $this->actingAs($me)->getJson('/portal/messaging/media')->assertOk()->json('items')
        )->pluck('name')->all();

        $this->assertEqualsCanonicalizing(['from-bob.png', 'from-carol.png'], $names);
    }

    public function test_it_never_shows_media_from_a_conversation_the_user_is_not_in(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $carol = $this->user('carol@example.com');

        // A thread between two other people entirely.
        $this->attach($this->conversation($bob, $carol), $bob, 'private.png');

        $this->actingAs($me)
            ->getJson('/portal/messaging/media')
            ->assertOk()
            ->assertJsonCount(0, 'items');
    }

    /** Leaving a group has to stop its media appearing here too. */
    public function test_leaving_a_conversation_removes_its_media(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        $this->attach($c, $bob, 'shared.png');

        $this->actingAs($me)->getJson('/portal/messaging/media')
            ->assertOk()->assertJsonCount(1, 'items');

        ConversationParticipant::where('conversation_id', $c->id)
            ->where('user_id', $me->id)
            ->update(['left_at' => now()]);

        $this->actingAs($me)->getJson('/portal/messaging/media')
            ->assertOk()->assertJsonCount(0, 'items');
    }

    /**
     * Clearing a chat is one-sided and per-thread. The pooled view has to honour
     * each conversation's own cutoff, or it becomes a way to read back exactly
     * what clearing was supposed to hide.
     */
    public function test_it_respects_each_conversations_own_cleared_point(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $carol = $this->user('carol@example.com');

        $cleared = $this->conversation($me, $bob);
        $old = $this->attach($cleared, $bob, 'before-clear.png');
        $new = $this->attach($cleared, $bob, 'after-clear.png');

        // Kept: a different thread, untouched by the clear.
        $this->attach($this->conversation($me, $carol), $carol, 'other-thread.png');

        ConversationParticipant::where('conversation_id', $cleared->id)
            ->where('user_id', $me->id)
            ->update(['cleared_before_message_id' => $old->message_id]);

        $names = collect(
            $this->actingAs($me)->getJson('/portal/messaging/media')->assertOk()->json('items')
        )->pluck('name')->all();

        $this->assertEqualsCanonicalizing(['after-clear.png', 'other-thread.png'], $names);
        $this->assertNotContains('before-clear.png', $names);
    }

    /** Voice notes belong to their conversation, not to a gallery. */
    public function test_voice_notes_are_excluded(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        $this->attach($c, $bob, 'photo.png');
        $this->attach($c, $bob, 'note.webm', 'video/webm', voice: true);

        $names = collect(
            $this->actingAs($me)->getJson('/portal/messaging/media')->assertOk()->json('items')
        )->pluck('name')->all();

        $this->assertSame(['photo.png'], $names);
    }

    /** Documents are a separate shelf, reachable with the same endpoint. */
    public function test_documents_are_a_separate_shelf(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        $this->attach($c, $bob, 'photo.png');
        $this->attach($c, $bob, 'contract.pdf', 'application/pdf');

        $media = collect($this->actingAs($me)->getJson('/portal/messaging/media')
            ->assertOk()->json('items'))->pluck('name')->all();
        $docs = collect($this->actingAs($me)->getJson('/portal/messaging/media?shelf=documents')
            ->assertOk()->json('items'))->pluck('name')->all();

        $this->assertSame(['photo.png'], $media);
        $this->assertSame(['contract.pdf'], $docs);
    }

    /** Each item says which thread it came from, so a hit can be traced back. */
    public function test_items_carry_their_conversation_name(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');

        $this->attach($this->conversation($me, $bob), $bob, 'photo.png');

        $item = $this->actingAs($me)->getJson('/portal/messaging/media')
            ->assertOk()->json('items.0');

        // A direct thread is named after the other person, from this viewer's
        // side — never after the viewer themselves.
        $this->assertSame($bob->name, $item['conversationName']);
        $this->assertNotNull($item['conversationId']);
        $this->assertSame($bob->name, $item['senderName']);
    }

    /** Staged uploads are not yet sent, so they are nobody's shared media. */
    public function test_staged_uploads_are_excluded(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        $staged = $this->attach($c, $bob, 'half-uploaded.png');
        $staged->update(['status' => MessageAttachment::STATUS_STAGED]);

        $this->actingAs($me)->getJson('/portal/messaging/media')
            ->assertOk()->assertJsonCount(0, 'items');
    }

    // ------------------------------------------------------------- updates

    public function test_updates_lists_colleagues_current_statuses(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');

        UserWorkStatus::create(['user_id' => $bob->id, 'text' => 'Drafting the Mensah affidavit']);

        $body = $this->actingAs($me)->getJson('/portal/messaging/updates')->assertOk();

        $body->assertJsonPath('updates.0.name', $bob->name);
        $body->assertJsonPath('updates.0.text', 'Drafting the Mensah affidavit');
        // Your own status is reported separately, not mixed into the list.
        $body->assertJsonPath('mine', null);
    }

    public function test_your_own_status_is_returned_separately_not_in_the_list(): void
    {
        $me = $this->user();
        UserWorkStatus::create(['user_id' => $me->id, 'text' => 'In court']);

        $this->actingAs($me)->getJson('/portal/messaging/updates')
            ->assertOk()
            ->assertJsonPath('mine.text', 'In court')
            ->assertJsonCount(0, 'updates');
    }

    /** An expired status is invisible the moment it lapses, with no sweep. */
    public function test_expired_statuses_are_hidden(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');

        UserWorkStatus::create([
            'user_id' => $bob->id,
            'text' => 'Back at 3',
            'expires_at' => now()->subMinute(),
        ]);

        $this->actingAs($me)->getJson('/portal/messaging/updates')
            ->assertOk()->assertJsonCount(0, 'updates');
    }

    /** Updates may never show someone the directory would not. */
    public function test_blocked_people_are_excluded(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');

        UserWorkStatus::create(['user_id' => $bob->id, 'text' => 'Visible?']);
        UserBlock::create(['user_id' => $me->id, 'blocked_user_id' => $bob->id]);

        $this->actingAs($me)->getJson('/portal/messaging/updates')
            ->assertOk()->assertJsonCount(0, 'updates');
    }

    public function test_unapproved_accounts_are_excluded(): void
    {
        $me = $this->user();
        $pending = $this->user('pending@example.com');
        $pending->forceFill(['status' => 'pending'])->save();

        UserWorkStatus::create(['user_id' => $pending->id, 'text' => 'Not approved']);

        $this->actingAs($me)->getJson('/portal/messaging/updates')
            ->assertOk()->assertJsonCount(0, 'updates');
    }

    public function test_setting_and_clearing_your_own_status(): void
    {
        $me = $this->user();

        $this->actingAs($me)->putJson('/portal/messaging/updates', ['text' => 'Reviewing contracts'])
            ->assertOk()->assertJsonPath('mine.text', 'Reviewing contracts');

        $this->assertDatabaseHas('user_work_statuses', ['user_id' => $me->id, 'text' => 'Reviewing contracts']);

        // Empty clears outright rather than storing a blank row.
        $this->actingAs($me)->putJson('/portal/messaging/updates', ['text' => ''])
            ->assertOk()->assertJsonPath('mine', null);

        $this->assertDatabaseMissing('user_work_statuses', ['user_id' => $me->id]);
    }

    /** Setting again replaces, so a user can never accumulate statuses. */
    public function test_setting_twice_replaces_rather_than_duplicates(): void
    {
        $me = $this->user();

        $this->actingAs($me)->putJson('/portal/messaging/updates', ['text' => 'First'])->assertOk();
        $this->actingAs($me)->putJson('/portal/messaging/updates', ['text' => 'Second'])->assertOk();

        $this->assertSame(1, UserWorkStatus::where('user_id', $me->id)->count());
        $this->assertSame('Second', UserWorkStatus::where('user_id', $me->id)->value('text'));
    }

    // --------------------------------------------------------------- links

    /** Links live in message bodies, so they get their own shelf. */
    public function test_links_are_pooled_from_message_bodies(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        Message::create([
            'conversation_id' => $c->id,
            'user_id' => $bob->id,
            'type' => Message::TYPE_TEXT,
            'body' => 'Filing portal is at https://cip.gov.lc/forms today',
        ]);

        $items = $this->actingAs($me)->getJson('/portal/messaging/media?shelf=links')
            ->assertOk()->json('items');

        $this->assertCount(1, $items);
        $this->assertSame('https://cip.gov.lc/forms', $items[0]['url']);
        $this->assertSame('cip.gov.lc', $items[0]['domain']);
        $this->assertSame($bob->name, $items[0]['senderName']);
        $this->assertSame($bob->name, $items[0]['conversationName']);
    }

    /** The same membership and clearing rules as the other shelves. */
    public function test_links_respect_membership_and_clearing(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $carol = $this->user('carol@example.com');

        // Someone else's conversation entirely.
        $theirs = $this->conversation($bob, $carol);
        Message::create([
            'conversation_id' => $theirs->id, 'user_id' => $bob->id,
            'type' => Message::TYPE_TEXT, 'body' => 'private https://secret.example.com',
        ]);

        // Mine, but cleared past the first link.
        $mine = $this->conversation($me, $bob);
        $old = Message::create([
            'conversation_id' => $mine->id, 'user_id' => $bob->id,
            'type' => Message::TYPE_TEXT, 'body' => 'old https://before.example.com',
        ]);
        Message::create([
            'conversation_id' => $mine->id, 'user_id' => $bob->id,
            'type' => Message::TYPE_TEXT, 'body' => 'new https://after.example.com',
        ]);

        ConversationParticipant::where('conversation_id', $mine->id)
            ->where('user_id', $me->id)
            ->update(['cleared_before_message_id' => $old->id]);

        $urls = collect($this->actingAs($me)->getJson('/portal/messaging/media?shelf=links')
            ->assertOk()->json('items'))->pluck('url')->all();

        $this->assertSame(['https://after.example.com'], $urls);
    }

    /** A message with no link never reaches the shelf. */
    public function test_plain_messages_are_not_links(): void
    {
        $me = $this->user();
        $bob = $this->user('bob@example.com');
        $c = $this->conversation($me, $bob);

        Message::create([
            'conversation_id' => $c->id, 'user_id' => $bob->id,
            'type' => Message::TYPE_TEXT, 'body' => 'No link in here at all',
        ]);

        $this->actingAs($me)->getJson('/portal/messaging/media?shelf=links')
            ->assertOk()->assertJsonCount(0, 'items');
    }
}
