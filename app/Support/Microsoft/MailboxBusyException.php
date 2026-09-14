<?php

namespace App\Support\Microsoft;

/**
 * Graph asked us to wait because another call already holds this mailbox.
 * Calendar sync treats this as a throttle, not a broken connection.
 */
class MailboxBusyException extends \RuntimeException
{
    public function __construct(public int $retryAfter = 25)
    {
        parent::__construct('Microsoft mailbox is busy.');
    }
}
