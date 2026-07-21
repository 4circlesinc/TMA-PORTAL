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
 * Someone advanced their read marker, which turns the other side's ticks blue.
 *
 * Only dispatched when the reader publishes read receipts - see
 * MessagingController::markRead. A reader with receipts off simply never
 * emits this, so there is nothing for a client to infer from.
 */
class ConversationRead implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Conversation $conversation,
        public User $reader,
        public ?int $lastReadMessageId,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'conversation.read';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->conversation->uuid,
            'readerId' => $this->reader->id,
            'lastReadSeq' => $this->lastReadMessageId,
        ];
    }
}
