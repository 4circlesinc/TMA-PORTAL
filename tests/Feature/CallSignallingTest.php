<?php

namespace Tests\Feature;

use App\Events\CallSignal;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Support\Messaging\MessagingSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Call signalling: what reaches whom, and what a signal is allowed to be.
 *
 * The headline case is the first one. Call signals used to broadcast on the
 * conversation channel alone, and a client only subscribes to the thread it
 * has open — so an incoming call reached the callee only if they happened to
 * be looking at that exact conversation. Everything else about the calling
 * experience rests on the ring actually arriving.
 */
class CallSignallingTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $email): User
    {
        return User::factory()->create([
            'email' => $email,
            'status' => 'approved',
            'account_type' => 'Employee',
            'email_verified_at' => now(),
            'profile_completed_at' => now(),
            'onboarding_completed_at' => now(),
        ]);
    }

    /** @param  array<int, User>  $members */
    private function conversation(array $members): Conversation
    {
        $c = Conversation::create([
            'type' => Conversation::TYPE_DIRECT,
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

    public function test_a_ring_reaches_the_callees_own_channel_not_only_the_conversation(): void
    {
        Event::fake([CallSignal::class]);

        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => 'ring', 'media' => 'video'])
            ->assertOk();

        Event::assertDispatched(CallSignal::class, function (CallSignal $e) use ($c, $callee) {
            $names = array_map(fn ($ch) => (string) $ch, $e->broadcastOn());

            return in_array('private-conversation.'.$c->uuid, $names, true)
                && in_array('private-messaging.user.'.$callee->id, $names, true);
        });
    }

    public function test_a_signal_never_goes_to_the_sender_channel(): void
    {
        Event::fake([CallSignal::class]);

        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => 'ring'])
            ->assertOk();

        Event::assertDispatched(CallSignal::class, function (CallSignal $e) use ($caller) {
            $names = array_map(fn ($ch) => (string) $ch, $e->broadcastOn());

            return ! in_array('private-messaging.user.'.$caller->id, $names, true);
        });
    }

    public function test_every_signal_is_identifiable_so_a_double_delivery_is_applied_once(): void
    {
        Event::fake([CallSignal::class]);

        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        foreach (['ring', 'offer'] as $type) {
            $this->actingAs($caller)
                ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => $type])
                ->assertOk();
        }

        $ids = [];
        Event::assertDispatched(CallSignal::class, function (CallSignal $e) use (&$ids) {
            $ids[] = $e->signalId;

            return true;
        });

        $this->assertCount(2, $ids);
        $this->assertCount(2, array_unique($ids));
        $this->assertNotEmpty($ids[0]);
    }

    public function test_the_in_call_state_signals_are_accepted(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        foreach (['state', 'upgrade', 'upgrade-accept', 'upgrade-decline', 'downgrade'] as $type) {
            $this->actingAs($caller)
                ->postJson("/portal/messaging/conversations/{$c->uuid}/call", [
                    'type' => $type,
                    'payload' => ['muted' => true, 'cameraOff' => true],
                ])->assertOk();
        }

        // None of them is a call *outcome*, so none may write call history.
        $this->assertSame(0, Message::where('conversation_id', $c->id)
            ->where('type', Message::TYPE_SYSTEM)->count());
    }

    public function test_an_unknown_signal_type_is_refused(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => 'screen-share'])
            ->assertStatus(422);
    }

    public function test_a_non_member_cannot_signal_into_a_call(): void
    {
        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $stranger = $this->user('stranger@example.com');
        $c = $this->conversation([$caller, $callee]);

        // Membership is the authorization boundary: a non-member is told the
        // conversation does not exist, not that they are not allowed in.
        $this->actingAs($stranger)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => 'ring'])
            ->assertNotFound();
    }

    public function test_the_signal_carries_the_callers_name_and_photo(): void
    {
        Event::fake([CallSignal::class]);

        $caller = $this->user('caller@example.com');
        $callee = $this->user('callee@example.com');
        $c = $this->conversation([$caller, $callee]);

        $this->actingAs($caller)
            ->postJson("/portal/messaging/conversations/{$c->uuid}/call", ['type' => 'ring', 'media' => 'video'])
            ->assertOk();

        Event::assertDispatched(CallSignal::class, function (CallSignal $e) use ($caller) {
            $body = $e->broadcastWith();

            return $body['payload']['fromName'] === $caller->name
                && array_key_exists('fromPhoto', $body['payload'])
                && $body['payload']['media'] === 'video';
        });
    }

    public function test_call_display_preference_round_trips_and_rejects_nonsense(): void
    {
        $me = $this->user('me@example.com');

        $this->assertSame('island', MessagingSettings::get($me, 'callDisplay'));

        $this->actingAs($me)
            ->putJson('/portal/messaging/settings', ['callDisplay' => 'compact'])
            ->assertOk()
            ->assertJsonPath('settings.callDisplay', 'compact');

        $this->actingAs($me)
            ->putJson('/portal/messaging/settings', ['callDisplay' => 'picture-in-picture'])
            ->assertOk()
            // An unknown value falls back to the default rather than being
            // stored — the client cannot invent a display mode.
            ->assertJsonPath('settings.callDisplay', 'island');
    }
}
