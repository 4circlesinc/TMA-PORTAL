<?php

namespace App\Notifications;

use App\Support\Mail\Postcards;
use Illuminate\Auth\Notifications\VerifyEmail;

/**
 * Laravel's verify-email mail, re-skinned to the approved postcard design. The
 * signed URL still comes from the parent, so it matches whatever
 * Fortify/Laravel expects.
 *
 * Deliberately NOT ShouldQueue: this is sent while somebody is sitting on the
 * "check your email" screen, and a queued copy sends nothing at all unless a
 * worker happens to be running. Same reasoning as
 * App\Support\Invitations\Invitations.
 */
class PortalVerifyEmail extends VerifyEmail
{
    public function toMail($notifiable)
    {
        return Postcards::verifyEmail(
            $this->verificationUrl($notifiable),
            $notifiable->first_name ?: null,
        )->to($notifiable->getEmailForVerification());
    }
}
