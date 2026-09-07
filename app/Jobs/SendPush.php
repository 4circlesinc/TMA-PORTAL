<?php

namespace App\Jobs;

use App\Models\DeviceToken;
use App\Support\Notifications\PushTransport;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * One person's devices, one data message each. A token FCM no longer knows
 * is dropped so the next send does not try it again.
 */
class SendPush implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    /** @param  array<string, string>  $data */
    public function __construct(
        public int $userId,
        public array $data,
        public bool $urgent = true,
        public ?int $ttlSeconds = null,
    ) {}

    public function handle(PushTransport $transport): void
    {
        if (! $transport->enabled()) {
            return;
        }

        $tokens = DeviceToken::query()->where('user_id', $this->userId)->get();
        foreach ($tokens as $device) {
            $result = $transport->send($device->token, $this->data, $this->urgent, $this->ttlSeconds);
            if ($result === PushTransport::UNREGISTERED) {
                $device->delete();
            }
        }
    }
}
