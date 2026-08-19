<?php

namespace App\Events;

use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * A user's resolved availability status changed.
 *
 * Broadcast on the staff channel so directories and the header pick it up, and
 * on the user's own channel so every open tab stays in sync. Payload carries
 * only the public status — never coordinates or addresses.
 */
class UserStatusChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /** @param  array<string, mixed>  $status */
    public function __construct(
        public User $user,
        public array $status,
    ) {}

    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('portal.staff'),
            new PrivateChannel('App.Models.User.'.$this->user->id),
        ];
    }

    public function broadcastAs(): string
    {
        return 'presence.status';
    }

    public function broadcastWith(): array
    {
        return [
            'userId' => $this->user->id,
            'status' => $this->status['status'] ?? null,
            'label' => $this->status['label'] ?? null,
            'source' => $this->status['source'] ?? null,
            'message' => $this->status['message'] ?? null,
            'icon' => $this->status['icon'] ?? null,
            'expiresAt' => isset($this->status['expiresAt']) && $this->status['expiresAt']
                ? $this->status['expiresAt']->toIso8601String()
                : null,
        ];
    }
}
