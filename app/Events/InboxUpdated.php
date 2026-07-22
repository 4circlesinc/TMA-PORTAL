<?php

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Something changed in one person's inbox.
 *
 * Clients only subscribe to the conversation they currently have open, so a
 * message arriving anywhere else would not move the unread badge until the
 * next poll. This fills that gap: it goes to the recipient's own fan-out
 * channel, which they subscribe to for the whole session.
 *
 * It carries the new unread total rather than a delta. A delta has to be
 * applied exactly once to stay correct, and a websocket that reconnects can
 * replay or drop one; an absolute count is right no matter how many times it
 * arrives or how many it missed.
 *
 * The same channel carries personal state - pin, archive, mute, read - so a
 * user with the portal open in two tabs sees both agree.
 */
class InboxUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param  array<string, mixed>  $detail */
    public function __construct(
        public User $user,
        public string $reason,
        public int $totalUnread,
        public ?string $conversationUuid = null,
        public array $detail = [],
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('messaging.user.'.$this->user->id)];
    }

    public function broadcastAs(): string
    {
        return 'messaging.inbox';
    }

    public function broadcastWith(): array
    {
        return [
            'reason' => $this->reason,
            'totalUnread' => $this->totalUnread,
            'conversationId' => $this->conversationUuid,
            'detail' => $this->detail,
        ];
    }
}
