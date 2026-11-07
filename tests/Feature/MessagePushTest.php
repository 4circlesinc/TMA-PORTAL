<?php

namespace Tests\Feature;

use App\Jobs\SyncMailbox;
use App\Models\ConnectedAccount;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DeviceToken;
use App\Models\MailMessage;
use App\Models\MailSenderPhoto;
use App\Models\Message;
use App\Models\User;
use App\Support\Notifications\MessagePush;
use App\Support\Notifications\Notifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
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

    public function test_a_group_message_says_who_then_the_group_then_the_message(): void
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
        $this->assertSame(['title' => 'Bruce Wayne', 'subtitle' => 'Tax team', 'body' => 'Meeting at noon'], $body['aps']['alert']);
        $msg = json_decode($body['msg'], true);
        $this->assertSame('Tax team', $msg['group']);
        $this->assertSame('Bruce Wayne', $msg['title']);
        $this->assertSame('Tax team', $msg['subtitle']);
        $this->assertArrayNotHasKey('groupPhoto', $msg, 'a group without a photo');
        $this->assertArrayNotHasKey('photo', $msg, 'nor a photo of its sender: initials');
    }

    public function test_a_group_with_a_photo_sends_it_signed_and_serves_it_only_signed(): void
    {
        $sender = $this->user('bruce@wayne.test', ['name' => 'Bruce Wayne']);
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        $c = $this->conversation([$sender, $recipient, $this->user('lucius@wayne.test')], Conversation::TYPE_GROUP);
        ConversationParticipant::query()->where('conversation_id', $c->id)->where('user_id', $sender->id)
            ->update(['role' => ConversationParticipant::ROLE_ADMIN]);
        $this->actingAs($sender)
            ->post("/portal/messaging/groups/{$c->uuid}/photo", ['photo' => UploadedFile::fake()->image('team.png', 64, 64)], ['Accept' => 'application/json'])
            ->assertOk();

        $this->actingAs($sender)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/messages", ['body' => 'Meeting at noon'])
            ->assertOk();

        $msg = json_decode($this->pushed()['msg'], true);
        $this->assertStringContainsString("/media/groups/{$c->uuid}/push?expires=", $msg['groupPhoto']);

        // What a member of the group gets from the photo's own route.
        $asMember = $this->actingAs($recipient)->get("/portal/messaging/conversations/{$c->uuid}/photo")->status();

        auth()->logout();
        $this->get("/media/groups/{$c->uuid}/push")->assertForbidden();
        $this->assertSame($asMember, $this->get($msg['groupPhoto'])->status(), 'signed, it serves what a member sees');
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

    public function test_an_email_reads_like_a_message_the_sender_then_the_subject_and_its_start(): void
    {
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        // The mailbox has a photo of Dana cached.
        $hash = MailSenderPhoto::hashFor('dana@example.com');
        MailSenderPhoto::create(['hash' => $hash, 'email' => 'dana@example.com', 'has_photo' => true, 'source' => 'directory', 'mime' => 'image/jpeg', 'checked_at' => now()]);

        Notifier::send([
            'user' => $recipient,
            'type' => 'email.received',
            'title' => 'Dana Reed sent you an email',
            'message' => 'Quarterly review',
            'action_url' => '/email?message=m-1',
            'metadata' => [
                'from_email' => 'dana@example.com', 'from_name' => 'Dana Reed', 'message_uuid' => 'm-1',
                'subject' => 'Quarterly review', 'snippet' => 'The numbers are in and they look good.',
            ],
        ]);

        $body = $this->pushed();
        $this->assertSame(['title' => 'Dana Reed', 'subtitle' => 'Quarterly review', 'body' => 'The numbers are in and they look good.'], $body['aps']['alert']);
        $this->assertSame('MESSAGE', $body['aps']['category'], 'a Reply box');
        $this->assertSame('email:dana@example.com', $body['aps']['thread-id'], 'stacked by sender');

        $msg = json_decode($body['msg'], true);
        $this->assertSame('email', $msg['kind']);
        $this->assertSame('Quarterly review', $msg['subtitle']);
        $this->assertSame('m-1', $msg['message']);
        $this->assertSame('Dana Reed', $msg['name']);
        $this->assertArrayNotHasKey('group', $msg);
        $this->assertStringContainsString('/portal/mail/sender-photo/'.$hash.'/push?expires=', $msg['photo']);
        $this->assertStringContainsString("/push/mail/m-1/{$recipient->id}?expires=", $msg['reply']);
        $this->assertSame('/email?message=m-1', $msg['url']);
    }

    public function test_a_batch_of_emails_stays_a_plain_notification(): void
    {
        $recipient = $this->user('alfred@wayne.test');
        DeviceToken::create(['user_id' => $recipient->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);

        Notifier::send([
            'user' => $recipient, 'type' => 'email.received', 'title' => '5 new emails', 'message' => 'From Dana, Pat…',
            'metadata' => ['from_email' => 'dana@example.com', 'from_name' => 'Dana', 'message_uuid' => 'm-1'],
        ]);

        $this->assertArrayNotHasKey('msg', $this->pushed());
    }

    /** @return array{0: User, 1: MailMessage} */
    private function mailbox(): array
    {
        $user = $this->user('alfred@wayne.test', ['account_type' => 'Administrator', 'preferences' => ['mail' => [
            'signatures' => [
                ['id' => 'sig-a', 'name' => 'Short', 'html' => '<p>A.</p>'],
                ['id' => 'sig-b', 'name' => 'Full', 'html' => '<p>Alfred Pennyworth<br>Wayne Manor</p>'],
            ],
            'activeSignatureId' => 'sig-b',
        ]]]);
        DeviceToken::create(['user_id' => $user->id, 'platform' => DeviceToken::PLATFORM_IOS, 'token' => self::PHONE]);
        $account = ConnectedAccount::create([
            'user_id' => $user->id, 'provider' => 'google', 'provider_id' => 'g-'.$user->id,
            'email' => 'alfred@wayne.test', 'name' => 'Alfred', 'token' => 'refresh-token',
            'scopes' => ['https://www.googleapis.com/auth/gmail.modify'], 'sync_email' => true,
        ]);
        $original = MailMessage::create([
            'uuid' => (string) Str::uuid(), 'user_id' => $user->id, 'connected_account_id' => $account->id,
            'remote_id' => 'gmail-1', 'thread_id' => 'thread-1', 'folder' => 'inbox',
            'subject' => 'Quarterly review', 'from_name' => 'Dana Reed', 'from_email' => 'dana@example.com',
            'reply_to' => 'Dana Assistant <assist@example.com>',
            'to' => [['name' => 'Alfred', 'email' => 'alfred@wayne.test']], 'is_read' => false, 'sent_at' => now()->subHour(),
        ]);

        return [$user, $original];
    }

    private function mailReplyUrl(MailMessage $m, User $user): string
    {
        return URL::temporarySignedRoute('mail.push-reply', now()->addDays(MessagePush::REPLY_DAYS), ['message' => $m->uuid, 'user' => $user->id]);
    }

    public function test_an_email_reply_from_notification_center_goes_back_in_its_thread_signed_off(): void
    {
        [$user, $original] = $this->mailbox();
        Queue::fake([SyncMailbox::class]);
        Http::fake([
            'oauth2.googleapis.com/*' => Http::response(['access_token' => 'access-token', 'expires_in' => 3600]),
            'gmail.googleapis.com/gmail/v1/users/me/messages/send' => Http::response(['id' => 'sent-123']),
            'gmail.googleapis.com/gmail/v1/users/me/messages/gmail-1*' => Http::response([
                'id' => 'gmail-1', 'threadId' => 'thread-1',
                'payload' => ['headers' => [['name' => 'Message-ID', 'value' => '<CAE123@mail.gmail.com>']]],
            ]),
        ]);

        $this->postJson($this->mailReplyUrl($original, $user), ['body' => "Thanks Dana.\nSee you Monday.", 'device' => self::PHONE])
            ->assertOk()
            ->assertJsonPath('sent', true);

        Http::assertSent(function ($request) {
            if (! str_contains($request->url(), '/messages/send')) {
                return false;
            }
            $this->assertSame('thread-1', $request['threadId']);
            $raw = base64_decode(strtr($request['raw'], '-_', '+/'), true);
            $this->assertStringContainsString('To: assist@example.com', $raw, 'to whoever the email asks replies to go to');
            $this->assertStringContainsString('Subject: Re: Quarterly review', $raw);
            $this->assertStringContainsString('In-Reply-To: <CAE123@mail.gmail.com>', $raw);

            $html = '';
            if (preg_match('#Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)#', $raw, $m)) {
                $html = (string) base64_decode(preg_replace('/\s+/', '', $m[1]));
            }
            $this->assertStringContainsString('<div>Thanks Dana.</div><div>See you Monday.</div>', $html);
            $this->assertStringContainsString('Alfred Pennyworth<br>Wayne Manor', $html, 'the chosen signature');
            $this->assertStringNotContainsString('<p>A.</p>', $html);

            return true;
        });
    }

    public function test_an_email_reply_needs_one_of_the_persons_devices(): void
    {
        [$user, $original] = $this->mailbox();
        Http::fake();

        $this->postJson($this->mailReplyUrl($original, $user), ['body' => 'Hi', 'device' => str_repeat('f', 64)])->assertForbidden();
        Http::assertNothingSent();
    }
}
