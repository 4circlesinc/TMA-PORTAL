<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A new message reached a conversation.
 *
 * Broadcast *Now* rather than queued: the portal's queue worker is not always
 * running, and a message that arrives minutes late is worse than one that
 * costs the sender's request a few milliseconds.
 *
 * The payload deliberately carries no rendered message body. Each recipient's
 * view of a message differs (their own read state, what they may edit), so the
 * client fetches the message itself; this event only says "something landed".
 */
class MessageSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->message->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'message.sent';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->message->conversation->uuid,
            'messageId' => $this->message->uuid,
            'seq' => $this->message->id,
            'senderId' => $this->message->user_id,
            'sentAt' => $this->message->created_at->toIso8601String(),
        ];
    }
}
