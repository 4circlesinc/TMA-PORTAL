<?php

namespace App\Notifications;

use App\Support\Mail\Postcards;
use Illuminate\Auth\Notifications\ResetPassword;

/**
 * Laravel's reset-password mail, re-skinned to the approved postcard design.
 * URL generation stays on the parent so any Fortify customisation
 * (ResetPassword::createUrlUsing) is honoured.
 *
 * Deliberately NOT ShouldQueue — see App\Notifications\PortalVerifyEmail. This
 * is also the "activation" email People → Resend welcome sends to an account
 * that has no password yet, so it is the only way in for that person.
 */
class PortalResetPassword extends ResetPassword
{
    public function toMail($notifiable)
    {
        $url = static::$createUrlCallback
            ? call_user_func(static::$createUrlCallback, $notifiable, $this->token)
            : url(route('password.reset', [
                'token' => $this->token,
                'email' => $notifiable->getEmailForPasswordReset(),
            ], false));

        return Postcards::resetPassword($url, $notifiable->first_name ?: null)
            ->to($notifiable->getEmailForPasswordReset());
    }
}
