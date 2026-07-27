<?php

namespace App\Notifications;

use App\Support\Mail\Postcards;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * Laravel's reset-password mail, moved off the web request and re-skinned to the
 * approved postcard design. URL generation stays on the parent so any Fortify
 * customisation (ResetPassword::createUrlUsing) is honoured. The mailable
 * returned here is sent synchronously inside this already-queued notification.
 */
class QueuedResetPassword extends ResetPassword implements ShouldQueue
{
    use Queueable;

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
