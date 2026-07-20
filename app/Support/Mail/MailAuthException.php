<?php

namespace App\Support\Mail;

use RuntimeException;

/**
 * The mailbox needs the user to reconnect — a revoked grant, a changed
 * password, or scopes that were never granted. Distinct from a transient
 * failure because retrying it is pointless; the UI prompts a reconnect.
 */
class MailAuthException extends RuntimeException
{
}
