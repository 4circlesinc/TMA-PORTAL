<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A fresh portal notification for one recipient (§24). It rides the recipient's
 * own private channel — already authorised in routes/channels.php — so the
 * bell badge, the header popup, and the right sidebar can update live without
 * refetching (§25). It carries the absolute unread count alongside the item so
 * a reconnecting socket that replays or drops the event still lands on the
 * right number.
 */
class PortalNotificationCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param  array<string, mixed>  $notification */
    public function __construct(
        public int $userId,
        public array $notification,
        public int $unread,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('App.Models.User.'.$this->userId)];
    }

    public function broadcastAs(): string
    {
        return 'notification.created';
    }

    public function broadcastWith(): array
    {
        return [
            'notification' => $this->notification,
            'unread' => $this->unread,
        ];
    }
}
