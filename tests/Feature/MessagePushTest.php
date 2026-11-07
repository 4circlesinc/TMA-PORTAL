<?php

namespace Tests\Feature;

use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DeviceToken;
use App\Models\Message;
use App\Models\User;
use App\Support\Notifications\MessagePush;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

/**
 * A message on an iPhone the way Messages shows one: the sender's photo with
 * the app's icon in its corner, the person's (or group's) name, the message
 * alone under it, and a Reply box that sends from Notification Center.
 */
class MessagePushTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    private const PHOTO = '0b6e8f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b.jpg';

    protected function setUp(): void
    {
        parent::setUp();

        $ec = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        openssl_pkey_export($ec, $pem);
        config([
            'services.fcm.project_id' => null,
            'services.apns.key_id' => 'APNSKEY123', 'services.apns.team_id' => 'TEAM123456',
            'services.apns.bundle_id' => 'com.tmantoinelaw.portal', 'services.apns.private_key' => $pem,
        ]);
        Http::fake(['api.push.apple.com/*' => Http::response('', 200)]);
    }

    private function user(string $email, array $extra = []): User
    {
        return User::factory()->create($extra + [
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
                'conversation_id' => $c->id, 'user_id' => $u->id,
                'role' => ConversationParticipant::ROLE_MEMBER, 'joined_at' => now(),
            ]);
        }

        return $c;
    }

    /** @return array<string, mixed> the body APNs was sent for the phone */
    private function pushed(): array
    {
        $sent = Http::recorded(fn (HttpRequest $request) => str_contains($request->url(), '/3/device/'.self::PHONE));
        $this->assertNotEmpty($sent, 'a push reached the phone');

        return $sent->last()[0]->data();
    }

    public function test_a_direct_message_shows_the_sender_and_the_message_with_a_reply_box(): void
    {
        $sender = $this->user('bruce@wayne.test', ['name' => 'Bruce Wayne', 'avatar_url' => '/media/avatars/'.self::PHOTO]);
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        $c = $this->conversation([$sender, $recipient]);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'The return is filed'])
            ->assertOk();

        $body = $this->pushed();
        $this->assertSame(['title' => 'Bruce Wayne', 'body' => 'The return is filed'], $body['aps']['alert']);
        $this->assertSame(1, $body['aps']['mutable-content'], 'wakes the extension that adds the photo');
        $this->assertSame('MESSAGE', $body['aps']['category'], 'the Reply box');
        $this->assertSame($c->uuid, $body['aps']['thread-id']);
        $this->assertArrayNotHasKey('notification', $body, 'the full record stays out of the 4 KB payload');

        $msg = json_decode($body['msg'], true);
        $this->assertSame('Bruce Wayne', $msg['name']);
        $this->assertSame((string) $sender->id, $msg['sender']);
        $this->assertArrayNotHasKey('group', $msg);
        $this->assertStringContainsString('/media/avatars/'.self::PHOTO.'/push?expires=', $msg['photo']);
        $this->assertStringContainsString("/push/messages/{$c->uuid}/{$recipient->id}?expires=", $msg['reply']);
        $this->assertSame('/social/messages?conversation='.$c->uuid, $msg['url']);
    }

    public function test_a_group_message_is_titled_with_the_group_and_says_only_the_message(): void
    {
        $sender = $this->user('bruce@wayne.test', ['name' => 'Bruce Wayne']);
        $recipient = $this->user('alfred@wayne.test');
        $third = $this->user('lucius@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        $c = $this->conversation([$sender, $recipient, $third], Conversation::TYPE_GROUP);

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Meeting at noon'])
            ->assertOk();

        $body = $this->pushed();
        $this->assertSame(['title' => 'Tax team', 'body' => 'Meeting at noon'], $body['aps']['alert']);
        $msg = json_decode($body['msg'], true);
        $this->assertSame('Tax team', $msg['group']);
        $this->assertSame('Bruce Wayne', $msg['name'], 'the photo is the person who wrote');
        $this->assertArrayNotHasKey('photo', $msg, 'no photo: the phone draws their initials');
    }

    public function test_other_notifications_keep_their_plain_push(): void
    {
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);

        Notifier::send(['user' => $recipient, 'type' => 'system.sync_completed', 'title' => 'Sync', 'message' => 'Done', 'email' => false]);

        $body = $this->pushed();
        $this->assertArrayNotHasKey('msg', $body);
        $this->assertArrayNotHasKey('category', $body['aps']);
        $this->assertArrayNotHasKey('mutable-content', $body['aps']);
    }

    /** @return array{0: Conversation, 1: User, 2: User} */
    private function replyable(): array
    {
        $sender = $this->user('bruce@wayne.test');
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);

        return [$this->conversation([$sender, $recipient]), $sender, $recipient];
    }

    private function replyUrl(Conversation $c, User $user, int $days = MessagePush::REPLY_DAYS): string
    {
        return URL::temporarySignedRoute('messaging.push-reply', now()->addDays($days), ['conversation' => $c->uuid, 'user' => $user->id]);
    }

    public function test_a_reply_from_notification_center_is_sent_as_the_person_and_reads_the_thread(): void
    {
        [$c, $sender, $recipient] = $this->replyable();

        $this->postJson($this->replyUrl($c, $recipient), ['body' => 'On my way', 'device' => self::PHONE])
            ->assertOk()
            ->assertJsonPath('message.body', 'On my way');

        $message = Message::query()->where('conversation_id', $c->id)->latest('id')->first();
        $this->assertSame('On my way', $message->body);
        $this->assertSame($recipient->id, $message->user_id);

        $participant = ConversationParticipant::query()->where('conversation_id', $c->id)->where('user_id', $recipient->id)->first();
        $this->assertSame($message->id, (int) $participant->last_read_message_id);
    }

    public function test_a_reply_needs_one_of_the_persons_devices(): void
    {
        [$c, , $recipient] = $this->replyable();

        $this->postJson($this->replyUrl($c, $recipient), ['body' => 'Hi', 'device' => str_repeat('f', 64)])->assertForbidden();
        $this->assertSame(0, Message::query()->where('conversation_id', $c->id)->count());
    }

    public function test_a_reply_link_cannot_be_changed_or_used_late(): void
    {
        [$c, $sender, $recipient] = $this->replyable();

        // Pointed at someone else: the signature no longer matches.
        $forged = str_replace("/{$recipient->id}?", "/{$sender->id}?", $this->replyUrl($c, $recipient));
        $this->postJson($forged, ['body' => 'Hi', 'device' => self::PHONE])->assertForbidden();

        $late = $this->replyUrl($c, $recipient);
        $this->travel(MessagePush::REPLY_DAYS + 1)->days();
        $this->postJson($late, ['body' => 'Hi', 'device' => self::PHONE])->assertForbidden();

        $this->assertSame(0, Message::query()->where('conversation_id', $c->id)->count());
    }

    public function test_the_photo_link_works_signed_and_only_signed(): void
    {
        Storage::fake(config('filesystems.avatar_disk', 'local'));
        Storage::disk(config('filesystems.avatar_disk', 'local'))->put('avatars/'.self::PHOTO, 'jpeg-bytes');

        $this->get('/media/avatars/'.self::PHOTO.'/push')->assertForbidden();
        $this->get(URL::temporarySignedRoute('avatar.push', now()->addDay(), ['name' => self::PHOTO]))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');
    }
}
