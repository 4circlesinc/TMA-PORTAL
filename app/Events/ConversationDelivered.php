<?php

namespace App\Events;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Someone's client acknowledged receiving messages, turning the sender's
 * single tick into two.
 *
 * Unlike ConversationRead this is not gated on a privacy setting: delivery
 * says a device received the message, not that a person looked at it, and
 * hiding it would leave senders staring at one tick forever.
 */
class ConversationDelivered implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Conversation $conversation,
        public User $recipient,
        public ?int $lastDeliveredMessageId,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'conversation.delivered';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->conversation->uuid,
            'recipientId' => $this->recipient->id,
            'lastDeliveredSeq' => $this->lastDeliveredMessageId,
        ];
    }
}
