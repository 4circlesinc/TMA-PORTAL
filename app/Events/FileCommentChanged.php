<?php

namespace App\Events;

use App\Models\FileComment;
use App\Models\FileItem;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A comment on a file was posted, edited, resolved or removed.
 *
 * Broadcast *Now* rather than queued, for the same reason the Feed and
 * messaging do it: the portal's queue worker is not always running, and a
 * comment that appears minutes late is worse than one that costs the writer's
 * request a few milliseconds.
 *
 * The payload deliberately carries no comment body. What each reader may do
 * with a comment differs — edit, delete, resolve — so the client refetches the
 * thread and patches it in. This event only says *what* changed and *where*,
 * which is what lets §29 hold: the viewer never reloads or reopens.
 *
 * `action` is one of: created | updated | deleted.
 */
class FileCommentChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public FileItem $file,
        public FileComment $comment,
        public string $action,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('file.'.$this->file->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'file.comment.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'fileId' => $this->file->uuid,
            'commentId' => $this->comment->uuid,
            'rootId' => $this->comment->root_id,
            'action' => $this->action,
        ];
    }
}
