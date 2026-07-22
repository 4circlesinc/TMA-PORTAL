<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\User;
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
}
