<?php

namespace App\Listeners;

use App\Models\DeviceToken;
use Illuminate\Auth\Events\Logout;

/**
 * Signing out on a phone must stop its pushes, and only its own: the token
 * remembers the session that registered it, and that session is what is
 * ending here. Picked up by Laravel's listener discovery like RecordAuthEvent.
 */
class ForgetDeviceTokensOnLogout
{
    public function handle(Logout $event): void
    {
        try {
            $sessionId = session()->getId();
        } catch (\Throwable) {
            return;
        }
        if ($sessionId === '') {
            return;
        }

        DeviceToken::query()->where('session_id', $sessionId)->delete();
    }
}
