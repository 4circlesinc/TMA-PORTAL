<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/** Laravel's reset-password mail, moved off the web request. */
class QueuedResetPassword extends ResetPassword implements ShouldQueue
{
    use Queueable;
}
