<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\FeedAttachment;
use App\Models\FeedChannel;
use App\Models\MessageAttachment;
use App\Models\User;
use App\Support\Security\Envelope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * What a reader gets back is what was sent.
 *
 * Messages and Feed store their files through the Vault, so their bytes are
 * envelope-encrypted at rest like every library file. These routes read them
 * back on their own, and for a month they handed out the ciphertext: a photo
 * arrived as a broken image, a PDF would not open, a voice note would not
 * play. Each door is pinned here against the original bytes.
 */
class AttachmentBytesTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email): User
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

    private function conversation(User $a, User $b, string $type = Conversation::TYPE_DIRECT): Conversation
    {
        $c = Conversation::create([
            'type' => $type,
            'name' => $type === Conversation::TYPE_GROUP ? 'Closing team' : null,
            'created_by' => $a->id,
            'last_message_at' => now(),
        ]);

        foreach ([$a, $b] as $i => $u) {
            ConversationParticipant::create([
                'conversation_id' => $c->id,
                'user_id' => $u->id,
                'role' => $type === Conversation::TYPE_GROUP && $i === 0
                    ? ConversationParticipant::ROLE_ADMIN
                    : ConversationParticipant::ROLE_MEMBER,
                'joined_at' => now(),
            ]);
        }

        return $c;
    }

    /** A real PNG, small enough that no thumbnail is made of it. */
    private function png(int $edge = 32): string
    {
        $image = imagecreatetruecolor($edge, $edge);
        imagefilledrectangle($image, 0, 0, $edge, $edge, imagecolorallocate($image, 20, 90, 160));

        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    /** A photograph heavy enough to earn a thumbnail. */
    private function photo(): string
    {
        $image = imagecreatetruecolor(1400, 1000);
        for ($i = 0; $i < 9000; $i++) {
            imagefilledrectangle(
                $image,
                random_int(0, 1399), random_int(0, 999), random_int(0, 1399), random_int(0, 999),
                imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)),
            );
        }

        ob_start();
        imagejpeg($image, null, 95);

        return (string) ob_get_clean();
    }

    private function stage(User $sender, Conversation $c, string $name, string $bytes): MessageAttachment
    {
        $uuid = $this->actingAs($sender)
            ->post('/portal/messaging/conversations/'.$c->uuid.'/attachments', [
                'file' => UploadedFile::fake()->createWithContent($name, $bytes),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('attachment.id');

        return MessageAttachment::where('uuid', $uuid)->firstOrFail();
    }

    public function test_a_message_photo_comes_back_as_the_photo_that_was_sent(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);
        $bytes = $this->png();

        $attachment = $this->stage($sender, $c, 'receipt.png', $bytes);

        // Still ciphertext where it is kept; the fix is in the reading.
        $this->assertTrue(Envelope::isWrapped(
            (string) Storage::disk($attachment->disk)->get($attachment->path)
        ));

        $response = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);

        $response->assertOk();
        $this->assertSame($bytes, $this->fileBody($response));
        $this->assertSame('image/png', $response->headers->get('Content-Type'));
        $this->assertStringStartsWith('inline', (string) $response->headers->get('Content-Disposition'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_a_message_document_downloads_as_itself(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);
        $bytes = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";

        $attachment = $this->stage($sender, $c, 'engagement-letter.pdf', $bytes);

        $response = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);

        $response->assertOk();
        $this->assertSame($bytes, $this->fileBody($response));
        // A document is never rendered in the portal's own origin.
        $this->assertStringStartsWith('attachment', (string) $response->headers->get('Content-Disposition'));
    }

    public function test_a_message_thumbnail_is_still_a_picture(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);
        $bytes = $this->photo();

        $attachment = $this->stage($sender, $c, 'site-visit.jpg', $bytes);
        $this->assertNotNull($attachment->thumb_path);

        $thumb = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid.'/thumb');
        $thumb->assertOk();
        $this->assertStringStartsWith("\xFF\xD8", $this->fileBody($thumb));

        $full = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);
        $this->assertSame($bytes, $this->fileBody($full));
    }

    public function test_a_message_photo_kept_in_object_storage_comes_back_whole_and_in_part(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);
        $bytes = $this->png();

        $attachment = $this->stage($sender, $c, 'receipt.png', $bytes);

        // Production keeps these in a bucket, where there is no file on this
        // machine to open in place: the envelope is fetched, then opened.
        config(['filesystems.disks.'.$attachment->disk.'.driver' => 's3']);

        $whole = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);
        $whole->assertOk();
        $this->assertSame($bytes, $this->fileBody($whole));

        // A player seeks, and pdf.js asks for one page, by Range.
        $part = $this->actingAs($sender)->get(
            '/portal/messaging/attachments/'.$attachment->uuid,
            ['Range' => 'bytes=0-7'],
        );
        $part->assertStatus(206);
        $this->assertSame('bytes 0-7/'.strlen($bytes), $part->headers->get('Content-Range'));
    }

    public function test_reopening_a_message_attachment_costs_no_second_copy(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);

        $attachment = $this->stage($sender, $c, 'receipt.png', $this->png());

        $first = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);
        $tag = $first->headers->get('ETag');
        $this->assertNotEmpty($tag);

        $this->actingAs($sender)
            ->get('/portal/messaging/attachments/'.$attachment->uuid, ['If-None-Match' => $tag])
            ->assertStatus(304);
    }

    public function test_a_message_attachment_sent_before_encryption_still_opens(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);
        $bytes = $this->png();
        $disk = config('filesystems.files_disk', 'local');

        Storage::disk($disk)->put('vault/2026/07/old.png', $bytes);

        $attachment = MessageAttachment::create([
            'conversation_id' => $c->id,
            'uploaded_by' => $sender->id,
            'disk' => $disk,
            'path' => 'vault/2026/07/old.png',
            'name' => 'old.png',
            'mime' => 'image/png',
            'size' => strlen($bytes),
            'status' => MessageAttachment::STATUS_STAGED,
        ]);

        $response = $this->actingAs($sender)->get('/portal/messaging/attachments/'.$attachment->uuid);

        $response->assertOk();
        $this->assertSame($bytes, $this->fileBody($response));

        // A name no upload would produce, but another writer might: it must
        // not be able to turn a download into a server error.
        $attachment->forceFill(['name' => 'scans/2026\\old.png'])->save();

        $this->actingAs($sender)
            ->get('/portal/messaging/attachments/'.$attachment->uuid)
            ->assertOk();
    }

    public function test_a_message_attachment_whose_bytes_are_gone_is_a_404(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $c = $this->conversation($sender, $reader);

        $attachment = $this->stage($sender, $c, 'receipt.png', $this->png());
        Storage::disk($attachment->disk)->delete($attachment->path);

        $this->actingAs($sender)
            ->get('/portal/messaging/attachments/'.$attachment->uuid)
            ->assertNotFound();
    }

    public function test_a_message_attachment_stays_closed_to_someone_outside_the_conversation(): void
    {
        $sender = $this->user('sender@example.com');
        $reader = $this->user('reader@example.com');
        $outsider = $this->user('outsider@example.com');
        $c = $this->conversation($sender, $reader);

        $attachment = $this->stage($sender, $c, 'receipt.png', $this->png());

        $this->actingAs($outsider)
            ->get('/portal/messaging/attachments/'.$attachment->uuid)
            ->assertNotFound();
    }

    public function test_a_group_photo_comes_back_as_the_photo_that_was_set(): void
    {
        $owner = $this->user('owner@example.com');
        $member = $this->user('member@example.com');
        $group = $this->conversation($owner, $member, Conversation::TYPE_GROUP);
        $bytes = $this->png(64);

        $this->actingAs($owner)
            ->post('/portal/messaging/groups/'.$group->uuid.'/photo', [
                'photo' => UploadedFile::fake()->createWithContent('team.png', $bytes),
            ], ['Accept' => 'application/json'])
            ->assertOk();

        $response = $this->actingAs($member)->get('/portal/messaging/conversations/'.$group->uuid.'/photo');

        $response->assertOk();
        $this->assertSame($bytes, $this->fileBody($response));
    }

    public function test_a_feed_attachment_and_a_channel_cover_come_back_as_they_were_sent(): void
    {
        $owner = $this->user('owner@example.com');
        $bytes = $this->png();

        $channel = $this->actingAs($owner)
            ->postJson('/portal/feed/channels', [
                'name' => 'Announcements',
                'type' => FeedChannel::TYPE_TEAM,
                'visibility' => FeedChannel::VISIBILITY_ORG,
            ])
            ->assertCreated()
            ->json('channel.id');

        $uuid = $this->actingAs($owner)
            ->post('/portal/feed/channels/'.$channel.'/attachments', [
                'file' => UploadedFile::fake()->createWithContent('notice.png', $bytes),
            ], ['Accept' => 'application/json'])
            ->assertCreated()
            ->json('attachment.id');

        $attachment = FeedAttachment::where('uuid', $uuid)->firstOrFail();
        $this->assertTrue(Envelope::isWrapped(
            (string) Storage::disk($attachment->disk)->get($attachment->path)
        ));

        $response = $this->actingAs($owner)->get('/portal/feed/attachments/'.$uuid);
        $response->assertOk();
        $this->assertSame($bytes, $this->fileBody($response));

        $cover = $this->png(96);
        $this->actingAs($owner)
            ->post('/portal/feed/channels/'.$channel.'/image/cover', [
                'file' => UploadedFile::fake()->createWithContent('cover.png', $cover),
            ], ['Accept' => 'application/json'])
            ->assertOk();

        $served = $this->actingAs($owner)->get('/portal/feed/channels/'.$channel.'/image/cover');
        $served->assertOk();
        $this->assertSame($cover, $this->fileBody($served));
    }
}
