<?php

namespace App\Support\SharePoint;

/** Graph returned 429/503. `retryAfter` is the seconds it asked us to wait. */
class GraphThrottledException extends GraphException
{
    public function __construct(string $message, public readonly int $retryAfter = 10)
    {
        parent::__construct($message, 429);
    }
}
