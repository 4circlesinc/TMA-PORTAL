<?php

namespace App\Events;

use App\Models\CipApplication;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Something changed on an application's messaging centre (§24).
 *
 * Signal, not payload: channel members have different visibility (staff see
 * internal notes; the provider side does not), so the event must never carry
 * the body. Each tab refetches through the endpoint that already filters.
 */
class CipThreadChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public CipApplication $application,
        public string $action,
    ) {}

    public function broadcastOn(): array
    {
        return [new PrivateChannel('cip.application.'.$this->application->uuid)];
    }

    public function broadcastAs(): string
    {
        return 'cip.thread.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'applicationId' => $this->application->uuid,
            'action' => $this->action,
        ];
    }
}
