<?php

namespace App\Events;

use App\Models\FileItem;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Somebody opened or left a file.
 *
 * Carries no roster: who each viewer may see differs, so the client refetches
 * the list. This only says "the set changed", which is what keeps §29 true —
 * nothing reloads and the reader's place is never lost.
 */
class FilePresenceChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public FileItem $file, public string $action) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('file.'.$this->file->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'file.presence.changed';
    }

    public function broadcastWith(): array
    {
        return ['fileId' => $this->file->uuid, 'action' => $this->action];
    }
}
