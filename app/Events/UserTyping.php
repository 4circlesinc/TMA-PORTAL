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
 * Somebody started or stopped typing in a conversation.
 *
 * Deliberately not persisted: a typing indicator is only meaningful for the
 * few seconds it is true, and a stale row in the database would outlive its
 * meaning. If the stop event is lost the receiving client expires it on a
 * timer, so the worst case is an indicator that lingers briefly rather than
 * one that sticks forever.
 *
 * Only sent when the typist publishes typing indicators - see
 * MessagingController::typing. Someone with the setting off simply never
 * emits, so there is nothing to infer from the silence.
 */
class UserTyping implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public Conversation $conversation,
        public User $typist,
        public bool $typing,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('conversation.'.$this->conversation->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'messaging.typing';
    }

    public function broadcastWith(): array
    {
        return [
            'conversationId' => $this->conversation->uuid,
            'userId' => $this->typist->id,
            // Groups need a name to say *who* is typing; one-to-one does not,
            // but sending it either way keeps the client from a second lookup.
            'name' => $this->typist->name,
            'typing' => $this->typing,
        ];
    }
}
