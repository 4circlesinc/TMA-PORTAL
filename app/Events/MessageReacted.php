<?php

namespace App\Events;

use App\Models\Message;
use App\Models\MessageReaction;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A message's reactions changed.
 *
 * Carries the whole grouped summary rather than a delta. Reactions are small,
 * and a delta would have to be applied in order to stay correct — two people
 * reacting at once would otherwise leave clients disagreeing about the counts.
 */
class MessageReacted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->message->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'message.reacted';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->message->conversation->uuid,
            'messageId' => $this->message->uuid,
            'seq' => $this->message->id,
            // Grouped by emoji, with who used it — the same shape the bubble
            // renders, minus the viewer-specific "mine" flag which each client
            // works out for itself.
            'reactions' => $this->message->reactions
                ->groupBy('emoji')
                ->map(fn ($group, $emoji) => [
                    'emoji' => $emoji,
                    'count' => $group->count(),
                    'users' => $group->map(fn (MessageReaction $r) => [
                        'id' => $r->user_id,
                        'name' => $r->user?->name ?? 'Someone',
                    ])->values(),
                ])
                ->values(),
        ];
    }
}
