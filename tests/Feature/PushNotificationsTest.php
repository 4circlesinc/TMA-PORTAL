<?php

namespace Tests\Feature;

use App\Models\DeviceToken;
use App\Models\User;
use App\Support\Notifications\Notifier;
use App\Support\Notifications\Push;
use App\Support\Notifications\PushTransport;
use Illuminate\Auth\Events\Logout;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * docs/android-app-prompt.md §13: a phone registers its token, hears the
 * same record the websocket carries, only for groups whose desktop banner is
 * on, always for security, and stops hearing anything once it signs out or
 * FCM forgets it.
 */
class PushNotificationsTest extends TestCase
{
    use RefreshDatabase;

    private FakeTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $this->transport = new FakeTransport;
        $this->app->instance(PushTransport::class, $this->transport);
    }

    private function user(string $email = 'ann@example.test'): User
    {
        $user = User::create(['name' => 'Ann', 'email' => $email, 'password' => bcrypt('password12345')]);
        $user->forceFill([
            'email_verified_at' => now(), 'profile_completed_at' => now(),
            'onboarding_completed_at' => now(), 'status' => 'approved',
            'account_type' => 'Administrator',
        ])->save();

        return $user;
    }

    public function test_a_device_registers_its_token_once_and_the_last_sign_in_owns_it(): void
    {
        $ann = $this->user();
        $bob = $this->user('bob@example.test');

        $this->actingAs($ann)->postJson('/me/devices', ['platform' => 'android', 'token' => 'tok-1', 'appVersion' => '0.1.0', 'deviceName' => 'Pixel 8'])
            ->assertCreated()->assertJson(['ok' => true]);
        $this->actingAs($ann)->postJson('/me/devices', ['platform' => 'android', 'token' => 'tok-1'])
            ->assertOk();
        $this->assertSame(1, DeviceToken::query()->count());

        $this->actingAs($bob)->postJson('/me/devices', ['platform' => 'android', 'token' => 'tok-1'])->assertOk();
        $this->assertSame($bob->id, DeviceToken::query()->where('token', 'tok-1')->value('user_id'));

        $this->actingAs($ann)->deleteJson('/me/devices/tok-1')->assertOk();
        $this->assertSame(1, DeviceToken::query()->count(), 'another account cannot drop a device it does not hold');
        $this->actingAs($bob)->deleteJson('/me/devices/tok-1')->assertOk();
        $this->assertSame(0, DeviceToken::query()->count());
    }

    public function test_a_notification_reaches_the_phone_with_the_websocket_record(): void
    {
        $ann = $this->user();
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-1']);

        Notifier::send(['user' => $ann, 'type' => 'message.received', 'title' => 'Chen Wei sent a message', 'message' => 'Hello', 'email' => false]);

        $this->assertCount(1, $this->transport->sent);
        [$token, $data] = $this->transport->sent[0];
        $this->assertSame('tok-1', $token);
        $this->assertSame('notification', $data['kind']);
        $this->assertSame('1', $data['unread']);
        $record = json_decode($data['notification'], true);
        $this->assertSame('Chen Wei sent a message', $record['title']);
        $this->assertSame('message.received', $record['type']);
    }

    public function test_a_group_whose_desktop_banner_is_off_is_not_pushed_but_security_always_is(): void
    {
        $ann = $this->user();
        $ann->forceFill(['preferences' => ['notifications' => [
            'messages' => ['portal' => true, 'desktop' => false],
            'security' => ['portal' => true, 'desktop' => false],
        ]]])->save();
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-1']);

        Notifier::send(['user' => $ann, 'type' => 'message.received', 'title' => 'Quiet', 'email' => false]);
        $this->assertCount(0, $this->transport->sent);

        Notifier::send(['user' => $ann, 'type' => 'security.password_changed', 'title' => 'Password changed', 'email' => false]);
        $this->assertCount(1, $this->transport->sent);
    }

    public function test_a_token_fcm_no_longer_knows_is_dropped(): void
    {
        $ann = $this->user();
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-old']);
        $this->transport->result = PushTransport::UNREGISTERED;

        Notifier::send(['user' => $ann, 'type' => 'message.received', 'title' => 'Hi', 'email' => false]);

        $this->assertDatabaseMissing('device_tokens', ['token' => 'tok-old']);
    }

    public function test_a_ringing_call_pushes_briefly_to_every_recipient(): void
    {
        $ann = $this->user();
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-1']);

        Push::callRing([$ann->id], ['signalId' => 's-1', 'conversationId' => 'c-1', 'fromUserId' => 9, 'type' => 'ring', 'payload' => ['fromName' => 'Bob', 'media' => 'video']]);

        $this->assertCount(1, $this->transport->sent);
        [, $data, $urgent, $ttl] = $this->transport->sent[0];
        $this->assertSame('call', $data['kind']);
        $this->assertTrue($urgent);
        $this->assertSame(30, $ttl);
        $this->assertSame('Bob', json_decode($data['signal'], true)['payload']['fromName']);
    }

    public function test_signing_out_drops_the_tokens_that_session_registered(): void
    {
        $ann = $this->user();
        $this->actingAs($ann)->postJson('/me/devices', ['platform' => 'android', 'token' => 'tok-phone'])->assertCreated();
        $sessionId = DeviceToken::query()->where('token', 'tok-phone')->value('session_id');
        $this->assertNotEmpty($sessionId);
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-tablet', 'session_id' => 'another-session']);

        session()->setId($sessionId);
        session()->start();
        event(new Logout('web', $ann));

        $this->assertDatabaseMissing('device_tokens', ['token' => 'tok-phone']);
        $this->assertDatabaseHas('device_tokens', ['token' => 'tok-tablet']);
    }

    public function test_nothing_is_queued_when_fcm_is_not_configured(): void
    {
        $this->transport->enabled = false;
        $ann = $this->user();
        DeviceToken::create(['user_id' => $ann->id, 'token' => 'tok-1']);

        Notifier::send(['user' => $ann, 'type' => 'message.received', 'title' => 'Hi', 'email' => false]);

        $this->assertCount(0, $this->transport->sent);
    }
}

class FakeTransport implements PushTransport
{
    public bool $enabled = true;

    public string $result = self::OK;

    /** @var array<int, array{0:string,1:array,2:bool,3:?int}> */
    public array $sent = [];

    public function enabled(): bool
    {
        return $this->enabled;
    }

    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null): string
    {
        $this->sent[] = [$token, $data, $urgent, $ttlSeconds];

        return $this->result;
    }
}
