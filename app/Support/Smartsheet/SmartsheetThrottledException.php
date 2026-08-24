<?php

namespace App\Support\Smartsheet;

/**
 * Smartsheet's rate limit is 300 requests/minute per token; a 429 arrives
 * with a Retry-After. Like the SharePoint stack, the client throws rather
 * than sleeps, the queue job re-dispatches itself with a delay instead of
 * burning a retry attempt while blocking a worker.
 */
class SmartsheetThrottledException extends SmartsheetException
{
    public function __construct(
        string $message,
        public readonly int $retryAfter = 30,
    ) {
        parent::__construct($message, 429);
    }
}
