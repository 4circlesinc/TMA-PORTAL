<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Something happened to a post in a channel (§22).
 *
 * Broadcast *Now* rather than queued, for the same reason messaging does it:
 * the portal's queue worker is not always running, and a feed that updates
 * minutes late is worse than one that costs the writer's request a few
 * milliseconds.
 *
 * The payload carries no rendered content on purpose. Each reader's view of a
 * post differs — their own reaction, whether they may edit or pin it — so the
 * client refetches just the affected post and patches it into place. This
 * event only says *what* changed and *where*, which is what lets §22 hold:
 * nothing reloads the whole feed.
 *
 * `action` is one of: created | updated | deleted | commented | reacted | voted.
 */
class FeedPostChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public string $channelUuid,
        public string $action,
        public string $postUuid,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('feed.channel.'.$this->channelUuid)];
    }

    public function broadcastAs(): string
    {
        return 'feed.post.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'channelId' => $this->channelUuid,
            'action' => $this->action,
            'postId' => $this->postUuid,
        ];
    }
}
