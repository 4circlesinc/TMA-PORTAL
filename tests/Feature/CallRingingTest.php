<?php

namespace Tests\Feature;

use App\Events\CallSignal;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DeviceToken;
use App\Models\Message;
use App\Models\User;
use App\Support\Messaging\LiveCalls;
use App\Support\Notifications\PushTransport;
use App\Support\Notifications\VoipPushTransport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

/**
 * A call rings a phone the way a phone call does, app open or closed.
 *
 * An iPhone is rung by a VoIP push (its own call screen); every phone gets a
 * signed link to ask whether it should still be ringing and to decline from
 * the lock screen; Android is pushed the moment the call stops ringing; and
 * an app that opens for the call finds the ring it missed.
 */
class CallRingingTest extends TestCase
{
    use RefreshDatabase;

    private CallFakeTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        $this->transport = new CallFakeTransport;
        $this->app->instance(PushTransport::class, $this->transport);
    }

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

    private function signal(User $from, Conversation $c, string $type, array $extra = [])
    {
        return $this->actingAs($from)->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => $type] + $extra);
    }

    /** @return array{0: User, 1: User, 2: Conversation, 3: string} caller, callee, conversation, signalId */
    private function ringing(): array
    {
        $ann = $this->user('Ann', 'ann@example.test');
        $bob = $this->user('Bob', 'bob@example.test');
        $c = $this->direct($ann, $bob);
        DeviceToken::create(['user_id' => $bob->id, 'platform' => 'android', 'token' => 'bob-android']);
        DeviceToken::create(['user_id' => $bob->id, 'platform' => 'ios', 'token' => 'bob-iphone', 'voip_token' => 'bob-voip']);

        $this->signal($ann, $c, 'ring', ['media' => 'video'])->assertOk();
        $signalId = json_decode($this->transport->sent[0][1]['signal'], true)['signalId'];

        return [$ann, $bob, $c, $signalId];
    }

    public function test_an_iphone_rings_through_voip_and_android_through_its_ordinary_push(): void
    {
        [, $bob, , $signalId] = $this->ringing();

        $this->assertSame(['bob-android'], array_column($this->transport->sent, 0));
        $this->assertCount(1, $this->transport->voip);
        [$token, $data, $ttl, $sandbox] = $this->transport->voip[0];
        $this->assertSame('bob-voip', $token);
        $this->assertSame('call', $data['kind']);
        $this->assertSame(45, $ttl);
        $this->assertFalse($sandbox);
        $this->assertStringContainsString("/push/calls/{$signalId}/{$bob->id}", $data['callUrl']);
        $this->assertStringContainsString('signature=', $data['callUrl']);
        $this->assertTrue(LiveCalls::isRinging(LiveCalls::find($signalId)));
    }

    public function test_an_iphone_without_a_voip_token_still_gets_the_ordinary_call_push(): void
    {
        $ann = $this->user('Ann', 'ann@example.test');
        $bob = $this->user('Bob', 'bob@example.test');
        $c = $this->direct($ann, $bob);
        DeviceToken::create(['user_id' => $bob->id, 'platform' => 'ios', 'token' => 'old-app']);

        $this->signal($ann, $c, 'ring')->assertOk();

        $this->assertSame(['old-app'], array_column($this->transport->sent, 0));
        $this->assertCount(0, $this->transport->voip);
    }

    public function test_a_voip_token_apple_forgot_is_dropped_and_the_call_rings_the_ordinary_way(): void
    {
        $this->transport->voipResult = PushTransport::UNREGISTERED;
        [, $bob] = $this->ringing();

        $this->assertNull(DeviceToken::query()->where('token', 'bob-iphone')->value('voip_token'));
        $this->assertContains('bob-iphone', array_column($this->transport->sent, 0));
        $this->assertSame($bob->id, DeviceToken::query()->where('token', 'bob-iphone')->value('user_id'));
    }

    public function test_answering_stops_every_android_phone_it_rang_and_the_answerers_other_devices_hear_it(): void
    {
        [, $bob, $c, $signalId] = $this->ringing();
        $this->transport->sent = [];
        Event::fake([CallSignal::class]);

        $this->signal($bob, $c, 'accept', ['media' => 'video'])->assertOk();

        $ends = array_values(array_filter($this->transport->sent, fn ($s) => $s[1]['kind'] === 'call-end'));
        $this->assertSame(['bob-android'], array_column($ends, 0), 'the iPhone asks instead of being pushed');
        $this->assertSame('answered', $ends[0][1]['outcome']);
        $this->assertSame((string) $bob->id, $ends[0][1]['by']);
        $this->assertSame($signalId, $ends[0][1]['signalId']);
        Event::assertDispatched(CallSignal::class, fn (CallSignal $e) => $e->type === 'accept' && in_array($bob->id, $e->recipientIds, true));
        $this->assertSame('answered', LiveCalls::find($signalId)['outcome']);

        // A hangup during the call itself is not a second "stop ringing".
        $this->transport->sent = [];
        $this->signal($bob, $c, 'hangup', ['answered' => true])->assertOk();
        $this->assertCount(0, array_filter($this->transport->sent, fn ($s) => $s[1]['kind'] === 'call-end'));
    }

    public function test_the_caller_giving_up_is_a_missed_call(): void
    {
        [$ann, , $c, $signalId] = $this->ringing();

        $this->signal($ann, $c, 'hangup', ['answered' => false])->assertOk();

        $this->assertSame('missed', LiveCalls::find($signalId)['outcome']);
    }

    public function test_an_app_opened_for_the_call_finds_the_ring_it_missed(): void
    {
        [$ann, $bob, $c, $signalId] = $this->ringing();
        $stranger = $this->user('Cy', 'cy@example.test');

        $this->actingAs($bob)->getJson("/portal/messaging/calls/live/{$signalId}")
            ->assertOk()
            ->assertJson(['live' => true, 'outcome' => null, 'signal' => ['signalId' => $signalId, 'conversationId' => $c->uuid, 'type' => 'ring', 'payload' => ['fromName' => 'Ann', 'media' => 'video']]]);
        $this->actingAs($stranger)->getJson("/portal/messaging/calls/live/{$signalId}")->assertNotFound();
        $this->actingAs($ann)->getJson("/portal/messaging/calls/live/{$signalId}")->assertNotFound();

        $this->signal($ann, $c, 'hangup')->assertOk();
        $this->actingAs($bob)->getJson("/portal/messaging/calls/live/{$signalId}")
            ->assertOk()->assertJson(['live' => false, 'outcome' => 'missed']);
    }

    public function test_a_phone_asks_through_its_signed_link_whether_it_should_still_ring(): void
    {
        [, $bob, $c] = $this->ringing();
        $url = $this->transport->voip[0][1]['callUrl'];

        $this->postJson($url, ['device' => 'bob-voip', 'action' => 'state'])
            ->assertOk()->assertJson(['ringing' => true, 'outcome' => null]);
        $this->postJson($url, ['device' => 'bob-android', 'action' => 'state'])->assertOk();
        $this->postJson($url, ['device' => 'someone-else', 'action' => 'state'])->assertForbidden();
        $this->postJson(strtok($url, '?'), ['device' => 'bob-voip', 'action' => 'state'])->assertForbidden();

        $this->signal($bob, $c, 'accept')->assertOk();
        $this->postJson($url, ['device' => 'bob-voip', 'action' => 'state'])
            ->assertOk()->assertJson(['ringing' => false, 'outcome' => 'answered', 'answeredHere' => true]);
    }

    public function test_declining_from_the_lock_screen_rejects_the_call_without_the_app(): void
    {
        [$ann, $bob, $c] = $this->ringing();
        $url = $this->transport->voip[0][1]['callUrl'];
        Event::fake([CallSignal::class]);

        $this->postJson($url, ['device' => 'bob-iphone', 'action' => 'decline'])
            ->assertOk()->assertJson(['ringing' => false, 'outcome' => 'declined']);

        Event::assertDispatched(CallSignal::class, fn (CallSignal $e) => $e->type === 'reject'
            && $e->fromUserId === $bob->id
            && in_array($ann->id, $e->recipientIds, true));
        $line = Message::query()->where('conversation_id', $c->id)->where('type', Message::TYPE_SYSTEM)->latest('id')->first();
        $this->assertSame('call_missed', $line->system_event['event']);
        $this->assertSame($ann->id, $line->system_event['initiatorId']);

        // A second tap after it is settled changes nothing.
        $this->postJson($url, ['device' => 'bob-iphone', 'action' => 'decline'])
            ->assertOk()->assertJson(['ringing' => false, 'outcome' => 'declined']);
        $this->assertSame(1, Message::query()->where('conversation_id', $c->id)->where('type', Message::TYPE_SYSTEM)->count());
    }

    public function test_a_call_long_gone_is_not_ringing(): void
    {
        $bob = $this->user('Bob', 'bob@example.test');
        DeviceToken::create(['user_id' => $bob->id, 'platform' => 'android', 'token' => 'bob-android']);
        $url = URL::temporarySignedRoute('messaging.push-call', now()->addMinutes(5), ['signal' => 'no-such-call', 'user' => $bob->id]);

        $this->postJson($url, ['device' => 'bob-android', 'action' => 'state'])
            ->assertOk()->assertJson(['ringing' => false, 'outcome' => 'ended']);
    }

    public function test_an_iphone_registers_its_voip_token_and_it_follows_the_phone(): void
    {
        $ann = $this->user('Ann', 'ann@example.test');
        $bob = $this->user('Bob', 'bob@example.test');

        $this->actingAs($ann)->postJson('/me/devices', ['platform' => 'ios', 'token' => 'apns-1', 'voipToken' => 'voip-1'])->assertCreated();
        $this->assertSame('voip-1', DeviceToken::query()->where('token', 'apns-1')->value('voip_token'));

        // The same phone after a reinstall: a new ordinary token, the same VoIP one.
        $this->actingAs($bob)->postJson('/me/devices', ['platform' => 'ios', 'token' => 'apns-2', 'voipToken' => 'voip-1'])->assertCreated();
        $this->assertNull(DeviceToken::query()->where('token', 'apns-1')->value('voip_token'));
        $this->assertSame('voip-1', DeviceToken::query()->where('token', 'apns-2')->value('voip_token'));

        // Registering again without one keeps the one it has.
        $this->actingAs($bob)->postJson('/me/devices', ['platform' => 'ios', 'token' => 'apns-2'])->assertOk();
        $this->assertSame('voip-1', DeviceToken::query()->where('token', 'apns-2')->value('voip_token'));
    }
}

class CallFakeTransport implements PushTransport, VoipPushTransport
{
    /** @var array<int, array{0:string,1:array,2:bool,3:?int}> */
    public array $sent = [];

    /** @var array<int, array{0:string,1:array,2:?int,3:bool}> */
    public array $voip = [];

    public string $voipResult = self::OK;

    public function enabled(): bool
    {
        return true;
    }

    public function send(string $token, array $data, bool $urgent = true, ?int $ttlSeconds = null): string
    {
        $this->sent[] = [$token, $data, $urgent, $ttlSeconds];

        return self::OK;
    }

    public function sendVoip(string $voipToken, array $data, ?int $ttlSeconds = null, bool $sandbox = false): string
    {
        $this->voip[] = [$voipToken, $data, $ttlSeconds, $sandbox];

        return $this->voipResult;
    }
}
