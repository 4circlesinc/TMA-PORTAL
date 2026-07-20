<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSenderPhoto;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;

/**
 * Looks up one sender's photo from the mail provider's directory and caches
 * the result (hit or miss).
 *
 * This is the *only* place that calls the provider for a photo. It must never
 * happen inline in a web request: an inbox page can reference dozens of
 * distinct senders at once, and blocking a response - or an <img> load - on a
 * live Graph round trip per sender is what took the mailbox down the first
 * time this shipped. The UI shows initials until this job has run once.
 */
class ResolveSenderPhoto implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 30;

    public function __construct(
        public ConnectedAccount $account,
        public string $email,
    ) {}

    /** @return array<int, object> */
    public function middleware(): array
    {
        // One in-flight lookup per address at a time; a burst of page views
        // for the same sender should not queue the same Graph call repeatedly.
        return [(new WithoutOverlapping('sender-photo:'.mb_strtolower($this->email)))->dontRelease()];
    }

    public function handle(): void
    {
        MailSenderPhoto::resolve($this->account, $this->email);
    }
}
