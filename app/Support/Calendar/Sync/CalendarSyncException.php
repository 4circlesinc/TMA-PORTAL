<?php

namespace App\Support\Calendar\Sync;

/**
 * A sync-level failure. `$cursorExpired` distinguishes the one case the caller
 * must handle specially, the provider's incremental token is no longer valid,
 * so a full re-sync is needed rather than a retry, from every other failure,
 * which is simply recorded and retried later.
 *
 * `$throttled` is the other special case: the provider asked us to slow down
 * (HTTP 429/503). That is not a broken connection, so it must not page the
 * user or park the calendar in error — the job waits and tries again.
 *
 * `$transient` is the provider not answering at all: its gateway gave up
 * (HTTP 500/502/504) or nothing came back in time. Usually gone a minute
 * later, so the synchronizer gives it a few runs before it calls the
 * calendar failed (CalendarSynchronizer::TRANSIENT_RUNS_BEFORE_ERROR).
 */
class CalendarSyncException extends \RuntimeException
{
    public function __construct(
        string $message,
        public bool $cursorExpired = false,
        public bool $throttled = false,
        public int $retryAfter = 20,
        public bool $transient = false,
    ) {
        parent::__construct($message);
    }

    /**
     * A recorded error that came from the provider not answering: the
     * wording transient failures are recorded with, or the bare "(HTTP 502)"
     * that rows recorded before they were told apart still carry.
     */
    public static function looksTransient(string $message): bool
    {
        $m = strtolower($message);

        return str_contains($m, 'not answering')
            || (bool) preg_match('/\(http 50[024]\)/', $m);
    }

    public static function looksThrottled(string $message): bool
    {
        $m = strtolower($message);

        return str_contains($m, 'http 429')
            || str_contains($m, 'too many requests')
            || str_contains($m, 'mailboxconcurrency')
            || str_contains($m, 'applicationthrottled')
            || str_contains($m, 'application is over its')
            || str_contains($m, 'rate-limiting')
            || str_contains($m, 'mailbox is busy');
    }
}
