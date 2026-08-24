<?php

namespace App\Notifications;

use App\Support\Mail\Postcards;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\URL;

/**
 * Laravel's verify-email mail, re-skinned to the approved postcard design.
 *
 * The link uses our unsigned verify route so opening it on another device
 * (or while signed out) still confirms the address.
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

    protected function verificationUrl($notifiable)
    {
        return URL::temporarySignedRoute(
            'verification.verify.unsigned',
            Carbon::now()->addMinutes((int) Config::get('auth.verification.expire', 60)),
            [
                'id' => $notifiable->getKey(),
                'hash' => sha1($notifiable->getEmailForVerification()),
            ]
        );
    }
}
