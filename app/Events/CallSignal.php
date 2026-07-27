<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Str;

/**
 * WebRTC signalling for a voice/video call in a conversation.
 *
 * Carries ring / offer / answer / ice / hangup payloads plus the in-call state
 * changes (camera and microphone, upgrade to video, downgrade to voice). Media
 * itself never goes through the server — only the handshake does.
 *
 * **It broadcasts on two kinds of channel, on purpose.** The conversation
 * channel is what an open thread listens to, but a client only subscribes to
 * the conversation it currently has open — so a ring sent there alone reaches
 * nobody unless the callee happened to be looking at that exact thread. Each
 * recipient's own `messaging.user.{id}` channel is the one they are always on,
 * which is what makes an incoming call arrive at all.
 *
 * Delivery on both channels means a client can see the same signal twice;
 * `signalId` is what lets it apply each one once (a replayed offer would
 * otherwise renegotiate the peer connection for no reason).
 */
class CallSignal implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** Identity of this signal, so a client that hears it twice acts once. */
    public string $signalId;

    /**
     * @param  array<int, int>  $recipientIds  the call's other participants
     */
    public function __construct(
        public string $conversationUuid,
        public int $fromUserId,
        public string $type,
        public array $payload = [],
        public array $recipientIds = [],
    ) {
        $this->signalId = (string) Str::uuid();
    }

    public function broadcastOn(): array
    {
        $channels = [new PrivateChannel('conversation.'.$this->conversationUuid)];

        foreach ($this->recipientIds as $id) {
            $channels[] = new PrivateChannel('messaging.user.'.$id);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'call.signal';
    }

    public function broadcastWith(): array
    {
        return [
            'signalId' => $this->signalId,
            'conversationId' => $this->conversationUuid,
            'fromUserId' => $this->fromUserId,
            'type' => $this->type,
            'payload' => $this->payload,
        ];
    }
}
