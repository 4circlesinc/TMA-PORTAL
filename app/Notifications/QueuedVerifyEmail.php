<?php

namespace App\Notifications;

use App\Support\Mail\Postcards;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Laravel's verify-email mail, moved off the web request and re-skinned to the
 * approved postcard design. The signed URL still comes from the parent, so it
 * matches whatever Fortify/Laravel expects. Sent synchronously inside this
 * already-queued notification.
 */
class QueuedVerifyEmail extends VerifyEmail implements ShouldQueue
{
    use Queueable;

    public function toMail($notifiable)
    {
        return Postcards::verifyEmail(
            $this->verificationUrl($notifiable),
            $notifiable->first_name ?: null,
        )->to($notifiable->getEmailForVerification());
    }
}
