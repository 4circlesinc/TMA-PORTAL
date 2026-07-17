<?php

namespace App\Notifications;

use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/** Laravel's verify-email mail, moved off the web request. */
class QueuedVerifyEmail extends VerifyEmail implements ShouldQueue
{
    use Queueable;
}
