<?php

namespace App\Jobs;

use App\Models\ConnectedAccount;
use App\Models\MailSenderPhoto;
use Illuminate\Contracts\Queue\ShouldBeUnique;
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
 *
 * Two properties matter as much as the lookup itself, because getting them
 * wrong starves mail sync rather than merely wasting work:
 *
 *  - It is unique per address while queued, so re-opening the inbox cannot
 *    stack another copy of a lookup that is already waiting.
 *  - It runs on its own low-priority queue, so a mailbox with hundreds of
 *    distinct senders can never push SyncMailbox to the back of the line.
 *
 * Both were missing, and the result was ~4,000 duplicate photo jobs sitting in
 * front of the two sync jobs that actually bring new mail in.
 */
class ResolveSenderPhoto implements ShouldBeUnique, ShouldQueue
{
    use Queueable;

    public int $tries = 2;

    public int $timeout = 30;

    /**
     * Stop counting this job as "already queued" after a few minutes, so a
     * worker that died holding the lock cannot block an address for good.
     */
    public int $uniqueFor = 600;

    public function __construct(
        public ConnectedAccount $account,
        public string $email,
    ) {
        // Never the default queue: photos are cosmetic and unbounded in number,
        // sync is neither. A worker consuming `default` first (or a separate
        // worker on this queue) keeps new mail arriving regardless of how many
        // senders are waiting to be looked up.
        $this->onQueue('mail-photos');
    }

    public function uniqueId(): string
    {
        return mb_strtolower($this->email);
    }

    /** @return array<int, object> */
    public function middleware(): array
    {
        // One in-flight lookup per address at a time; a burst of page views
        // for the same sender should not queue the same Graph call repeatedly.
        return [(new WithoutOverlapping('sender-photo:'.mb_strtolower($this->email)))->dontRelease()->expireAfter(60)];
    }

    public function handle(): void
    {
        MailSenderPhoto::resolve($this->account, $this->email);
    }

    public function failed(\Throwable $e): void
    {
        // A sender with no photo is normal and already handled as a cached
        // miss; reaching here means the lookup itself broke.
        logger()->warning('mail: sender photo lookup failed', [
            'email' => $this->email,
            'error' => $e->getMessage(),
        ]);
    }
}
