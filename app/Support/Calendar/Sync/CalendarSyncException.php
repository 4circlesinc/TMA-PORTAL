<?php

namespace App\Support\Calendar\Sync;

/**
 * A sync-level failure. `$cursorExpired` distinguishes the one case the caller
 * must handle specially — the provider's incremental token is no longer valid,
 * so a full re-sync is needed rather than a retry — from every other failure,
 * which is simply recorded and retried later.
 */
class CalendarSyncException extends \RuntimeException
{
    public function __construct(string $message, public bool $cursorExpired = false)
    {
        parent::__construct($message);
    }
}
