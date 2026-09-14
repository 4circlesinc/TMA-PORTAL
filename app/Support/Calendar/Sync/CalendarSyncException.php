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
 */
class CalendarSyncException extends \RuntimeException
{
    public function __construct(
        string $message,
        public bool $cursorExpired = false,
        public bool $throttled = false,
        public int $retryAfter = 20,
    ) {
        parent::__construct($message);
    }
}
