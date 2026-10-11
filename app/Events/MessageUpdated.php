<?php

namespace App\Events;

use App\Models\Message;
use App\Models\MessageMention;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/** An existing message was edited. Carries the new text; edits are small. */
class MessageUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public Message $message) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->message->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'message.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->message->conversation->uuid,
            'messageId' => $this->message->uuid,
            'seq' => $this->message->id,
            'body' => $this->message->body,
            'editedAt' => $this->message->edited_at?->toIso8601String(),
            // Who the new text names, so the highlight follows the edit on
            // every screen showing it, not only the author's.
            'mentions' => $this->message->mentions
                ->filter(fn (MessageMention $m) => ! $m->isEveryone())
                ->map(fn (MessageMention $m) => ['id' => $m->user_id, 'name' => $m->label])
                ->values()
                ->all(),
            'mentionsAll' => $this->message->mentions->contains(fn (MessageMention $m) => $m->isEveryone()),
        ];
    }
}
