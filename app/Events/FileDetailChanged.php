<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * A file's versions, approvals or activity changed.
 *
 * The sibling of {@see FileCommentChanged}, on the same per-file channel and
 * for the same reason: comments and presence were already live, so a viewer
 * would watch a discussion update in real time while the Versions tab beside
 * it sat on a list from whenever it was opened — someone uploads a new version
 * and the person reading the file has no idea until they close and reopen it.
 *
 * Carries the section, not the rows. Who may see which version or approval
 * step differs per reader, so the panel refetches through its own endpoint and
 * keeps those rules where they are enforced. It also means the viewer never
 * reopens: the panel patches in place and the reader's scroll and open menus
 * survive.
 *
 * `section` is one of: versions | approvals | activity.
 */
class FileDetailChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public const VERSIONS = 'versions';

    public const APPROVALS = 'approvals';

    public const ACTIVITY = 'activity';

    public function __construct(
        public string $fileUuid,
        public string $section,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('file.'.$this->fileUuid)];
    }

    public function broadcastAs(): string
    {
        return 'file.detail.changed';
    }

    /** @return array<string, string> */
    public function broadcastWith(): array
    {
        return [
            'fileId' => $this->fileUuid,
            'section' => $this->section,
        ];
    }
}
