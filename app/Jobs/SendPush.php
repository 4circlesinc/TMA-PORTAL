<?php

namespace App\Jobs;

use App\Models\DeviceToken;
use App\Support\Notifications\PushTransport;
use App\Support\Notifications\VoipPushTransport;
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

        $kind = $this->data['kind'] ?? '';
        $tokens = DeviceToken::query()->where('user_id', $this->userId)->get();
        foreach ($tokens as $device) {
            if ($device->isIphone()) {
                // An iPhone cannot be pushed "stop ringing": a VoIP push must
                // always ring, and an ordinary one would be a stray banner. It
                // asks through the ring's callUrl instead.
                if ($kind === 'call-end') {
                    continue;
                }
                // A call to the phone's own call screen, closed app or not.
                if ($kind === 'call' && filled($device->voip_token) && $transport instanceof VoipPushTransport) {
                    $result = $transport->sendVoip(
                        (string) $device->voip_token,
                        $this->data,
                        $this->ttlSeconds,
                        $device->platform === DeviceToken::PLATFORM_IOS_SANDBOX,
                    );
                    if ($result !== PushTransport::UNREGISTERED) {
                        continue;
                    }
                    // Apple no longer knows that VoIP token: forget it and
                    // ring the ordinary way below.
                    $device->forceFill(['voip_token' => null])->save();
                }
            }

            $result = $transport->send($device->token, $this->data, $this->urgent, $this->ttlSeconds);
            if ($result === PushTransport::UNREGISTERED) {
                $device->delete();
            }
        }
    }
}
