<?php

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Someone came online or went offline.
 *
 * Broadcast on the conversation channels they belong to rather than to each
 * peer individually: those channels already exist, are already authorized, and
 * are already subscribed by anyone with the thread open - which is exactly who
 * can see the status dot change. Peers looking at the inbox list pick the
 * change up on the next poll, which is soon enough for a list.
 *
 * Only fired on a *transition*. Heartbeats arrive every few seconds and
 * broadcasting each one would be a lot of traffic to say nothing new.
 *
 * Privacy is applied by the sender, not the receiver: a user whose online
 * status is hidden never emits this at all, so a client cannot learn anything
 * from an event that was filtered after the fact.
 */
class PresenceChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param  list<string>  $conversationUuids */
    public function __construct(
        public User $user,
        public bool $online,
        public array $conversationUuids,
        public ?string $lastSeenLabel = null,
    ) {}

    public function broadcastOn(): array
    {
        return array_map(
            fn (string $uuid) => new PrivateChannel('conversation.'.$uuid),
            $this->conversationUuids
        );
    }

    public function broadcastAs(): string
    {
        return 'messaging.presence';
    }

    public function broadcastWith(): array
    {
        return [
            'userId' => $this->user->id,
            'online' => $this->online,
            'lastSeenLabel' => $this->lastSeenLabel,
        ];
    }
}
