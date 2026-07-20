<?php

namespace App\Support\Mail;

use RuntimeException;

/**
 * The incremental sync cursor is too old to resume from — Gmail drops history
 * after roughly a week, and Graph expires delta tokens. Recoverable, but only
 * by discarding the cursor and doing a full listing.
 */
class MailCursorExpiredException extends RuntimeException
{
}
