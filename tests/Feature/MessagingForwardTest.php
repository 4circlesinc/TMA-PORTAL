<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\MessageAttachment;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Forwarding a message to another conversation.
 *
 * It used to pass on one line of text whatever was forwarded: a photo arrived
 * as "Forwarded: photo.png", with no photo. The files go now, each as a copy
 * of its own, and what is written with them is the forwarder's to change.
 */
class MessagingForwardTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name, string $email): User
    {
        return User::factory()->create([
            'name' => $name,
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Administrator',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    private function direct(User $a, User $b): Conversation
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

    /** A real PNG, small enough that no thumbnail is made of it. */
    private function png(): string
    {
        $image = imagecreatetruecolor(32, 32);
        imagefilledrectangle($image, 0, 0, 32, 32, imagecolorallocate($image, 20, 90, 160));

        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    /** @return array<string, mixed> a sent message carrying one photo */
    private function sendPhoto(User $sender, Conversation $c, ?string $caption = null): array
    {
        $staged = $this->actingAs($sender)
            ->post("/portal/messaging/conversations/{$c->uuid}/attachments", [
                'file' => UploadedFile::fake()->createWithContent('site-visit.png', $this->png()),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('attachment.id');

        return $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", [
                'body' => $caption,
                'attachments' => [$staged],
            ])
            ->assertOk()
            ->json('message');
    }

    /** @param  array<string, mixed>  $extra */
    private function forward(User $by, string $messageId, Conversation $to, array $extra = [])
    {
        return $this->actingAs($by)->postJson(
            "/portal/messaging/messages/{$messageId}/forward",
            ['conversationId' => $to->uuid] + $extra,
        );
    }

    public function test_a_forwarded_photo_arrives_as_a_photo_with_bytes_of_its_own(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $from = $this->direct($ada, $rita);
        $to = $this->direct($ada, $omar);

        $sent = $this->sendPhoto($rita, $from, 'From the site visit');

        $forwarded = $this->forward($ada, $sent['id'], $to)->assertOk()->json('message');

        $this->assertTrue($forwarded['forwarded']);
        $this->assertSame('attachment', $forwarded['type']);
        // As it was, when nothing is said about the caption.
        $this->assertSame('From the site visit', $forwarded['body']);
        $this->assertCount(1, $forwarded['attachments']);
        $this->assertSame('site-visit.png', $forwarded['attachments'][0]['name']);

        $original = MessageAttachment::where('uuid', $sent['attachments'][0]['id'])->firstOrFail();
        $copy = MessageAttachment::where('uuid', $forwarded['attachments'][0]['id'])->firstOrFail();

        // A row of its own, in the conversation it went to, on bytes of its own.
        $this->assertNotSame($original->id, $copy->id);
        $this->assertSame($to->id, $copy->conversation_id);
        $this->assertSame(MessageAttachment::STATUS_READY, $copy->status);
        $this->assertNotSame($original->path, $copy->path);
        $this->assertTrue(Storage::disk($copy->disk)->exists($copy->path));

        // So the original going away takes nothing from the forward.
        Storage::disk($original->disk)->delete($original->path);
        $this->assertTrue(Storage::disk($copy->disk)->exists($copy->path));

        // Omar reads a photo, not a line of text about one, and is told.
        $forOmar = $this->actingAs($omar)
            ->getJson("/portal/messaging/conversations/{$to->uuid}/messages")
            ->json('messages');
        $this->assertCount(1, $forOmar);
        $this->assertTrue($forOmar[0]['forwarded']);
        $this->assertSame('site-visit.png', $forOmar[0]['attachments'][0]['name']);
        $this->assertSame(1, Notification::query()->where('user_id', $omar->id)->count());

        // And the sender's own copy is read, not waiting for them as unread.
        $row = collect($this->actingAs($ada)->getJson('/portal/messaging/conversations')->json('conversations'))
            ->firstWhere('id', $to->uuid);
        $this->assertSame(0, $row['unread']);
    }

    public function test_the_caption_can_be_changed_added_or_taken_off_on_the_way(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $from = $this->direct($ada, $rita);
        $to = $this->direct($ada, $omar);

        $captioned = $this->sendPhoto($rita, $from, 'From the site visit');
        $bare = $this->sendPhoto($rita, $from);

        // Changed.
        $changed = $this->forward($ada, $captioned['id'], $to, ['body' => 'Omar, this is the wall I meant.'])
            ->assertOk()->json('message');
        $this->assertSame('Omar, this is the wall I meant.', $changed['body']);
        $this->assertCount(1, $changed['attachments']);

        // Added to a file that had none.
        $added = $this->forward($ada, $bare['id'], $to, ['body' => 'Second angle.'])->assertOk()->json('message');
        $this->assertSame('Second angle.', $added['body']);

        // Taken off: a file can travel without words.
        $removed = $this->forward($ada, $captioned['id'], $to, ['body' => ''])->assertOk()->json('message');
        $this->assertNull($removed['body']);
        $this->assertCount(1, $removed['attachments']);

        // The original is never touched by any of it.
        $this->assertSame('From the site visit', Message::where('uuid', $captioned['id'])->value('body'));
    }

    public function test_text_is_forwarded_as_written_or_as_rewritten_but_never_empty(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $from = $this->direct($ada, $rita);
        $to = $this->direct($ada, $omar);

        $said = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$from->uuid}/messages", ['body' => 'The filing is due on the 14th.'])
            ->json('message');

        $asWritten = $this->forward($ada, $said['id'], $to)->assertOk()->json('message');
        $this->assertSame('The filing is due on the 14th.', $asWritten['body']);
        $this->assertSame('text', $asWritten['type']);
        $this->assertTrue($asWritten['forwarded']);

        $rewritten = $this->forward($ada, $said['id'], $to, ['body' => 'Rita says the 14th.'])->assertOk()->json('message');
        $this->assertSame('Rita says the 14th.', $rewritten['body']);

        $this->forward($ada, $said['id'], $to, ['body' => '   '])->assertJsonValidationErrors('body');

        // An ordinary message is not marked.
        $this->assertFalse($said['forwarded']);
    }

    public function test_it_goes_only_from_and_to_conversations_the_forwarder_is_in(): void
    {
        $ada = $this->user('Ada Lovelace', 'ada@example.com');
        $rita = $this->user('Rita Officer', 'rita@example.com');
        $omar = $this->user('Omar Officer', 'omar@example.com');
        $zoe = $this->user('Zoe Outsider', 'zoe@example.com');
        $from = $this->direct($ada, $rita);
        $elsewhere = $this->direct($rita, $omar);
        $zoes = $this->direct($zoe, $omar);

        $said = $this->actingAs($rita)
            ->postJson("/portal/messaging/conversations/{$from->uuid}/messages", ['body' => 'Between us.'])
            ->json('message');

        // Zoe cannot forward what she cannot read, however she learnt its id.
        $this->forward($zoe, $said['id'], $zoes)->assertNotFound();

        // Ada can read it, but is not in the conversation she names.
        $this->forward($ada, $said['id'], $elsewhere)->assertNotFound();

        $this->assertSame(1, Message::query()->count());
    }
}
